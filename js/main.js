// Wiring: loader, navigation, panels, HUD, touch controls, mini-app + haptics + RPG + multiplayer.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const TITLES={hot:"HOT LIST",calls:"CALLS",callers:"CALLERS",about:"ABOUT",inventory:"GEAR",leaderboard:"RANKS"};
let current=null,wasPlaying=false,lastStats=null;
const touch=matchMedia("(pointer:coarse)").matches||"ontouchstart" in window;

// Initialize mini-app SDK early
MiniApp.init();

// loader + pickaxes
Pickaxe.attach($("#loaderAxe"),{res:96,fps:10,always:true});
Pickaxe.attach($("#heroAxe"),{res:110,fps:10});
let lp=0;const lt=setInterval(()=>{lp=Math.min(90,lp+15);$("#loadfill").style.width=lp+"%"},120);

// HUD
const livesEl=$("#lives");for(let i=0;i<9;i++)livesEl.appendChild(document.createElement("i"));
function onHud(h){
  [...livesEl.children].forEach((el,i)=>el.classList.toggle("off",i>=h.lives));
  const m=$("#mult"),txt="x"+(h.mult>=100?h.mult.toFixed(0):h.mult.toFixed(2));
  if(m.textContent!==txt){m.textContent=txt;m.classList.remove("pop");void m.offsetWidth;m.classList.add("pop")}
  $("#depth").textContent="DEPTH "+h.depth+"M";
  $("#goalfill").style.width=(h.goal*100).toFixed(1)+"%";
  // Update online count
  if(typeof Multiplayer!=='undefined'){
    $("#onlineCount").textContent=Multiplayer.playerCount;
  }
}
function onHit(){
  [...livesEl.children].forEach(el=>{el.classList.remove("hit");void el.offsetWidth;el.classList.add("hit")});
  Haptics.impact('heavy');
  Haptics.notification('error');
}
let hintTimer=null;
function hint(t,ms){const h=$("#hint");if(!t){if(!hintTimer)h.classList.add("hidden");return}h.textContent=t;h.classList.remove("hidden");
  if(ms){clearTimeout(hintTimer);hintTimer=setTimeout(()=>{hintTimer=null;h.classList.add("hidden")},ms)}}
function onOver(s){
  clearTimeout(hintTimer);hintTimer=null;$("#hint").classList.add("hidden");
  $("#hud").classList.add("hidden");$("#touch").classList.add("hidden");
  const profile=RPG.getProfile();
  const lvl=profile?` · LEVEL ${profile.level}`:'';
  $("#overStats").innerHTML=`MULTIPLIER <b>x${s.mult.toFixed(2)}</b><br>DEPTH ${s.depth}M · GEMS ${s.gems} · DIGS ${s.digs||0}${lvl}<br>BEST x${(+s.best).toFixed(2)} · GOAL 589x`;
  $("#over").classList.remove("hidden");
  lastStats=s;
}
Game.init($("#game"),{onHud,onHit,onOver,onHint:t=>hint(t),onOpen:id=>openPanel(id)});

function start(){
  $("#title").classList.add("hidden");$("#over").classList.add("hidden");$("#hud").classList.remove("hidden");
  if(touch)$("#touch").classList.remove("hidden");
  Game.start();
  updateRpgHud();
  if(!touch)hint("SPACE TO DIG · ARROWS TO MOVE · ↓+SPACE DIGS DOWN",4500);else hint("⛏ DIG · ▼+⛏ DIGS DOWN",4000);
}
$("#startBtn").onclick=start;
addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(TITLES[h])openPanel(h);else if(!h&&current)closePanel()});
$("#retryBtn").onclick=start;
addEventListener("keydown",e=>{
  if(current){if(e.code==="Escape")closePanel();return}
  if((e.code==="Space"||e.code==="Enter")&&(Game.mode==="title"&&!$("#title").classList.contains("hidden")||Game.mode==="over")){e.preventDefault();start()}
  if(e.code==="KeyM")toggleMute();
});

// mute
function toggleMute(){const m=Sfx.toggle();$("#muteBtn").textContent=m?"SND OFF":"SND ON";Haptics.selection()}
$("#muteBtn").textContent=Sfx.muted?"SND OFF":"SND ON";$("#muteBtn").onclick=toggleMute;

// haptics toggle
function toggleHaptics(){const h=Haptics.toggle();$("#hapticBtn").textContent=h?"VIB ON":"VIB OFF"}
$("#hapticBtn").textContent=Haptics.enabled?"VIB ON":"VIB OFF";$("#hapticBtn").onclick=toggleHaptics;

// menu
$("#menuBtn").onclick=()=>{$("#menu").classList.toggle("open");Haptics.selection()};

// share button
$("#shareBtn").onclick=()=>{if(lastStats)MiniApp.shareScore(lastStats.mult,lastStats.depth);Haptics.selection()};

// RPG HUD update
function updateRpgHud(){
  const profile=RPG.getProfile();
  if(!profile)return;
  const {level,xpInLevel,xpForNext}=BT_CONFIG.levelFromXp(profile.xp);
  $("#level").textContent=`LV ${level}`;
  $("#xpfill").style.width=((xpInLevel/xpForNext)*100).toFixed(1)+"%";
}

// Level up handler
RPG.onLevelUp((newLevel,oldLevel)=>{
  Game._debug.showBanner(`LEVEL ${newLevel}!`);
  updateRpgHud();
});

// Gear drop handler
RPG.onGearDrop((gear)=>{
  const rarity=RPG.GEAR_RARITIES[gear.rarity].toUpperCase();
  Game._debug.showBanner(`${rarity} ${gear.name.toUpperCase()}!`);
  hint(`Found ${gear.name}! Check GEAR menu.`,4000);
});

// Multiplayer status handler
Multiplayer.onStatus((status)=>{
  const badge=$("#offlineBadge");
  if(status==='connected'){
    badge.classList.add("hidden");
  }else if(status==='offline'||status==='disconnected'){
    badge.classList.remove("hidden");
  }
});

// panels
function openPanel(id){
  if(!TITLES[id])return;
  if(!current){wasPlaying=Game.mode==="play";Game.pause(true)}
  current=id;$("#panelTitle").textContent=TITLES[id];
  
  // Render appropriate content
  if(id==='inventory'){
    $("#panelBody").innerHTML=renderInventory();
  }else if(id==='leaderboard'){
    $("#panelBody").innerHTML='<p class="note">Loading...</p>';
    renderLeaderboard();
  }else{
    $("#panelBody").innerHTML=BT.render(id);
  }
  
  $("#panelBody").scrollTop=0;
  $(".example").style.display=(id==="about"||id==="inventory"||id==="leaderboard")?"none":"";
  $$(".paneltabs button,#menu a").forEach(b=>b.classList.toggle("on",b.dataset.nav===id));
  $("#panelWrap").classList.remove("hidden");$("#menu").classList.remove("open");
  if(location.hash!=="#"+id)history.replaceState(null,"","#"+id);
  Sfx.play("ui");
  Haptics.selection();
}
function closePanel(){
  current=null;$("#panelWrap").classList.add("hidden");Game.pause(false);
  $$("#menu a").forEach(b=>b.classList.remove("on"));
  history.replaceState(null,"",location.pathname+location.search);
}
$("#closePanel").onclick=closePanel;
$("#panelWrap").addEventListener("click",e=>{if(e.target.id==="panelWrap")closePanel()});

// Inventory rendering
function renderInventory(){
  const profile=RPG.getProfile();
  if(!profile)return '<p class="note">No profile loaded</p>';
  
  const {level,xpInLevel,xpForNext}=BT_CONFIG.levelFromXp(profile.xp);
  const pfpHtml=profile.pfp?`<img src="${escHtml(profile.pfp)}" alt="">`:'';
  
  let html=`
    <div class="profile-card">
      <div class="profile-pfp">${pfpHtml}</div>
      <div class="profile-info">
        <div class="profile-name">${escHtml(profile.name)}</div>
        <div class="profile-level">Level ${level} · ${profile.xp} XP (${xpInLevel}/${xpForNext})</div>
        <div class="profile-stats">
          <div><b>BEST DEPTH</b>${profile.best_depth}M</div>
          <div><b>DIAMONDS</b>${profile.total_diamonds}</div>
          <div><b>DIGS</b>${profile.total_digs}</div>
          <div><b>DEATHS</b>${profile.deaths}</div>
        </div>
      </div>
    </div>
    <h3 class="dotmatrix" style="font-size:12px;margin:12px 0">EQUIPPED</h3>
    <div class="equip-slots">
  `;
  
  for(const type of ['pickaxe','helmet','boots','charm']){
    const gear=RPG.getEquippedGear(type);
    const color=gear?RPG.RARITY_COLORS[gear.rarity]:'#aaa';
    html+=`<div class="slot" data-slot="${type}">
      <div class="label">${type.toUpperCase()}</div>
      ${gear?`<div class="equipped-name" style="color:${color}">${gear.name}</div>`:'<div class="empty">NONE</div>'}
    </div>`;
  }
  
  html+=`</div><h3 class="dotmatrix" style="font-size:12px;margin:12px 0">INVENTORY (${profile.inventory.length})</h3>`;
  
  if(profile.inventory.length===0){
    html+='<p class="note">No gear yet. Dig deeper to find loot!</p>';
  }else{
    html+='<div class="gear-grid">';
    for(const gear of profile.inventory){
      const equipped=profile.equipped[gear.type]===gear.id;
      const rarity=RPG.GEAR_RARITIES[gear.rarity];
      const statKey=Object.keys(gear).find(k=>['digSpeed','protection','moveSpeed','luck'].includes(k));
      const statVal=gear[statKey];
      const statLabel={digSpeed:'DIG',protection:'PROT',moveSpeed:'SPD',luck:'LUCK'}[statKey];
      html+=`<div class="gear-item ${equipped?'equipped':''}" data-gear="${gear.id}">
        <div class="rarity rarity-${rarity}"></div>
        <div class="type">${gear.type}</div>
        <div class="name" style="color:${RPG.RARITY_COLORS[gear.rarity]}">${gear.name}</div>
        <div class="stat">${statLabel}: ${statVal}${statKey==='protection'?'':statKey==='digSpeed'||statKey==='moveSpeed'||statKey==='luck'?'x':''}</div>
        <div class="desc">${gear.desc||''}</div>
        ${equipped?'<div style="font-family:PS2P;font-size:8px;color:var(--g);margin-top:4px">EQUIPPED</div>':''}
      </div>`;
    }
    html+='</div>';
  }
  
  return html;
}

async function renderLeaderboard(){
  const profile=RPG.getProfile();
  let lbType='xp';
  
  async function load(type){
    lbType=type;
    const data=await RPG.fetchLeaderboard(type);
    let html=`
      <div class="lb-tabs">
        <button data-lb="xp" class="${type==='xp'?'on':''}">BY XP</button>
        <button data-lb="depth" class="${type==='depth'?'on':''}">BY DEPTH</button>
      </div>
    `;
    
    if(data.length===0){
      html+='<p class="note">No rankings yet. Be the first!</p>';
    }else{
      html+='<div class="lb-list">';
      data.forEach((row,i)=>{
        const rank=i+1;
        const rankClass=rank===1?'gold':rank===2?'silver':rank===3?'bronze':'';
        const isMe=profile&&row.id===profile.id;
        const pfpHtml=row.pfp?`<img src="${escHtml(row.pfp)}" alt="">`:'';
        const value=type==='depth'?`${row.best_depth}M`:`${row.xp} XP`;
        html+=`<div class="lb-row ${rank<=3?'top3':''} ${isMe?'equipped':''}">
          <div class="lb-rank ${rankClass}">#${rank}</div>
          <div class="lb-pfp">${pfpHtml}</div>
          <div class="lb-name">${escHtml(row.name||'Trencher')}</div>
          <div class="lb-value">${value}</div>
        </div>`;
      });
      html+='</div>';
    }
    
    $("#panelBody").innerHTML=html;
    $$("[data-lb]").forEach(btn=>btn.onclick=()=>load(btn.dataset.lb));
  }
  
  await load('xp');
}

function escHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

document.addEventListener("click",e=>{
  const n=e.target.closest("[data-nav]");
  if(n){e.preventDefault();const id=n.dataset.nav;
    if(id==="play"){closePanel();$("#menu").classList.remove("open");if(Game.mode!=="play")start();return}
    openPanel(id);return}
  const c=e.target.closest("[data-caller]");
  if(c){e.preventDefault();BT.state.callerFilter=c.dataset.caller;openPanel("calls");return}
  if(e.target.closest("[data-clearfilter]")){BT.state.callerFilter=null;openPanel("calls");return}
  const s=e.target.closest("th[data-sort]");
  if(s){BT.state.callsSort=s.dataset.sort;openPanel("calls");return}
  const p=e.target.closest("[data-play]");
  if(p){e.preventDefault();closePanel();start();const d=Game.findTicker(p.dataset.play);
    setTimeout(()=>hint(d!=null?`$${p.dataset.play} SEAM BURIED AT ${d}M. DIG DOWN!`:"KEEP DIGGING",5000),300)}
  // Gear equip
  const gear=e.target.closest("[data-gear]");
  if(gear){
    RPG.equipGear(gear.dataset.gear);
    Haptics.selection();
    Sfx.play("gem",0);
    openPanel("inventory");
  }
  // Unequip slot
  const slot=e.target.closest("[data-slot]");
  if(slot){
    RPG.unequipGear(slot.dataset.slot);
    Haptics.selection();
    openPanel("inventory");
  }
});

// touch controls
$$("#touch button").forEach(b=>{
  const k=b.dataset.k;
  const on=e=>{e.preventDefault();Sfx.unlock();b.classList.add("down");Game.setKey(k,true);Haptics.selection()};
  const off=e=>{e.preventDefault();b.classList.remove("down");Game.setKey(k,false)};
  b.addEventListener("pointerdown",on);b.addEventListener("pointerup",off);b.addEventListener("pointercancel",off);b.addEventListener("pointerleave",off);
});

// data + RPG init
Promise.all([
  BT.load().catch(err=>{console.error(err);$("#tickerInner").textContent="DATA ERROR"}),
  RPG.loadProfile().catch(err=>console.warn('Profile load failed:',err))
]).then(()=>{
  Game.setHotList(BT.hot().map(h=>({ticker:h.coin.ticker,status:h.status})));
  $("#tickerInner").innerHTML=BT.tickerHTML()+BT.tickerHTML();
  
  // Connect to multiplayer
  const profile=RPG.getProfile();
  if(profile){
    Multiplayer.connect(profile);
  }
}).finally(()=>{
  clearInterval(lt);$("#loadfill").style.width="100%";
  setTimeout(()=>{
    $("#loader").classList.add("done");
    // Signal mini-app host that we're ready
    MiniApp.ready();
    // Show username greeting if available
    const username=MiniApp.getUsername();
    const profile=RPG.getProfile();
    if(username){
      $("#greeting").textContent="WELCOME "+username.toUpperCase();
    }else if(profile&&profile.name){
      $("#greeting").textContent="WELCOME "+profile.name.toUpperCase();
    }
    updateRpgHud();
    const h=location.hash.slice(1);if(TITLES[h])openPanel(h);else if(h==="play")start();
  },450);
});

// Periodic RPG HUD update (+ online count, which onHud only refreshes when lives/mult/depth change)
setInterval(()=>{updateRpgHud();$("#onlineCount").textContent=Multiplayer.playerCount},1000);
})();
