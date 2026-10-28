// Wiring: loader, navigation, panels, HUD, touch controls, mini-app + haptics + RPG + multiplayer.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const TITLES={hot:"HOT LIST",calls:"CALLS",callers:"CALLERS",about:"ABOUT",inventory:"GEAR",skills:"SKILLS",leaderboard:"RANKS",campaign:"CAMPAIGN",events:"EVENTS",squad:"SQUAD",world:"WORLD MAP",elevator:"ELEVATOR"};
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
  const lc=$("#lvlChip");
  if(lc){lc.classList.toggle("hidden",!h.levelsOn);if(h.levelsOn)lc.textContent="L"+h.level+(h.theme?" · "+h.theme.toUpperCase():"")}
  // Update online count
  if(typeof Multiplayer!=='undefined'){
    paintOnline();
  }
}
// "3 ONLINE" for humans; recruits (server bots) shown separately and never added in.
function paintOnline(n){
  const humans=n!=null?n:Multiplayer.playerCount;
  $("#onlineCount").textContent=humans;
  const r=Multiplayer.connected?Multiplayer.recruitCount:0,el=$("#recruitCount");
  if(el){el.textContent=r?`+ ${r} BOT${r>1?'S':''}`:"";el.classList.toggle("hidden",!r)}
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
  $("#checkpointBtn").classList.add("hidden");$("#overSave").classList.add("hidden");
  lastStats=s;
  if(typeof BTSave!=='undefined')BTSave.onDeath();
}
function onLevelEnter(L,theme,down){
  if(!down||L<2)return;
  Haptics.notification('success');
  if(typeof BTSave!=='undefined'&&RPG.isLoggedIn())setTimeout(()=>BTSave.saveNow({quiet:true}),1500);
  hint(`LEVEL ${L}: ${theme?theme.campaign.toUpperCase()+" CAMPAIGN · ":""}DARKER, HARDER, NEW CRAWLERS`,6000);
}
Game.init($("#game"),{onHud,onHit,onOver,onLevelEnter,onHint:t=>hint(t),onOpen:id=>openPanel(id),
  onElevator:()=>openPanel('elevator'),onCallout:t=>hint(t,3800),onTeleport:()=>paintTp(),
  onBoss:e=>{if(e.state==='spawn')Haptics.notification('warning');else if(e.state==='dead'){Haptics.notification('success');hint(e.id==='punk'?'GG! '+e.name+' CHALLENGE COMPLETE · +3 LIVES · BOSS XP':e.name+' FELLED · +3 LIVES · BOSS XP',4000)}}});

async function start(){
  $("#title").classList.add("hidden");$("#over").classList.add("hidden");$("#hud").classList.remove("hidden");
  if(touch)$("#touch").classList.remove("hidden");
  // Wait briefly for multiplayer seed so first run is shared (up to 1.5s)
  if(Multiplayer.connected&&Multiplayer.worldSeed==null){
    const deadline=Date.now()+1500;
    while(Date.now()<deadline&&Multiplayer.worldSeed==null)await new Promise(r=>setTimeout(r,50));
  }
  Game.start();
  updateRpgHud();
  if(!touch)hint("SPACE TO DIG · ARROWS TO MOVE · ↓+SPACE DIGS DOWN",4500);else hint("⛏ DIG · ▼+⛏ DIGS DOWN",4000);
}
$("#startBtn").onclick=start;
// Save game: CONTINUE on the title, CHECKPOINT after a death on level 2+, SAVE in the HUD.
async function continueGame(){
  if(typeof BTSave==='undefined'||!BTSave.save)return start();
  $("#title").classList.add("hidden");$("#over").classList.add("hidden");$("#hud").classList.remove("hidden");
  if(touch)$("#touch").classList.remove("hidden");
  BTSave.continueRun();updateRpgHud();
  hint("WELCOME BACK · "+BTSave.describe(BTSave.save),4000);
}
$("#continueBtn").onclick=continueGame;
$("#checkpointBtn").onclick=continueGame;
$("#saveBtn").onclick=e=>{e.stopPropagation();Haptics.selection();if(typeof BTSave!=='undefined')BTSave.saveNow()};
function paintContinue(sv){
  const b=$("#continueBtn");if(!b)return;
  b.classList.toggle("hidden",!sv);
  if(sv)b.textContent="▶ CONTINUE · "+BTSave.describe(sv);
  $("#startBtn").textContent=sv?"▶ NEW RUN":"▶ START DIGGING";
}
if(typeof BTSave!=='undefined'){
  BTSave.init();
  BTSave.on((ev,data)=>{
    if(ev==='save'){paintContinue(data);return}
    if(ev==='login'){toast("Log in to save your run. It saves as soon as you're in.",4500);return}
    if(ev==='error'){
      const m={no_run:"Start a run first",login_required:"Log in to save",too_soon:"Saved a moment ago",offline:"Save failed: server unreachable",levels_locked:"Deeper levels are not open yet"};
      toast(m[data]||"Save failed ("+data+")");return}
    if(ev==='saved'){
      const sv=data.save;paintContinue(sv);
      if(Game.mode==="over"){
        if(sv&&sv.checkpoint){$("#checkpointBtn").classList.remove("hidden");$("#checkpointBtn").textContent="▶ CHECKPOINT · LV "+sv.level;
          $("#overSave").innerHTML="Your account keeps a checkpoint at the top of <b>level "+sv.level+"</b>.";$("#overSave").classList.remove("hidden")}
        return}
      if(!data.quiet){const btn=$("#saveBtn");btn.classList.remove("ok");void btn.offsetWidth;btn.classList.add("ok");
        toast("SAVED · "+BTSave.describe(sv)+(data.clamped&&data.clamped.length?" · some unverified stats were trimmed":""))}
    }
  });
}
addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(TITLES[h])openPanel(h);else if(!h&&current)closePanel()});
$("#retryBtn").onclick=start;
addEventListener("keydown",e=>{
  if(current){if(e.code==="Escape"||(e.code==="KeyG"&&current==="world"))closePanel();return}
  if(e.code==="KeyG"&&!(e.target&&/^(INPUT|TEXTAREA)$/.test(e.target.tagName))){e.preventDefault();openPanel("world");return}
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
  const bb=$("#buildBtn");if(bb)bb.classList.toggle("hidden",!(Game.skillFx&&Game.skillFx.fortifyCooldown));
  const {level,xpInLevel,xpForNext}=BT_CONFIG.levelFromXp(profile.xp);
  $("#level").textContent=`LV ${level}`;
  $("#xpfill").style.width=((xpInLevel/xpForNext)*100).toFixed(1)+"%";
  const handle=profile.x_handle||'';
  const wallet=profile.wallet?shortWallet(profile.wallet):'';
  const idEl=$("#identity");
  if(idEl){
    idEl.innerHTML=(handle?`<span class="id-x">${escHtml(handle)}</span>`:'')+(wallet?`<span class="id-w">${escHtml(wallet)}</span>`:'');
    idEl.classList.toggle('hidden',!handle&&!wallet);
  }
}
function shortWallet(a){return a&&a.length>10?a.slice(0,6)+'…'+a.slice(-4):a||'';}

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

// Chat input + emotes with cooldown and chat log
let lastChatSent=0;
const CHAT_RATE_LIMIT=2000; // respect server 2s limit
const chatLogLines=[];
const MAX_CHAT_LOG=5;

function addChatLog(name,text,own=false,bot=false){
  chatLogLines.push({name,text,own,bot,time:Date.now()});
  if(chatLogLines.length>MAX_CHAT_LOG)chatLogLines.shift();
  renderChatLog();
}

function renderChatLog(){
  const log=$("#chatLog");
  log.innerHTML=chatLogLines.map(l=>`<div class="chat-log-line ${l.own?'own':''} ${l.bot?'bot':''}">${l.bot?'<span class="bot-tag">BOT</span>':''}<span class="chat-name">${escHtml(l.name)}:</span> <span class="chat-msg">${escHtml(l.text)}</span></div>`).join('');
}

function applyCooldown(){
  $$(".chat-emotes button").forEach(btn=>btn.classList.add("cooldown"));
  $("#chatSend").classList.add("cooldown");
  setTimeout(()=>{
    $$(".chat-emotes button").forEach(btn=>btn.classList.remove("cooldown"));
    $("#chatSend").classList.remove("cooldown");
  },CHAT_RATE_LIMIT);
}

function sendChat(text){
  if(!text||!text.trim())return;
  const now=Date.now();
  if(now-lastChatSent<CHAT_RATE_LIMIT){hint("Wait before sending again",1500);return}
  if(!Multiplayer.connected){hint("Offline - can't send chat",1500);return}
  const msg=text.trim();
  Multiplayer.sendChat(msg);
  Game.setOwnChat(msg);
  addChatLog('YOU',msg,true);
  lastChatSent=now;
  applyCooldown();
  Haptics.selection();
  $("#chatInput").value="";
}
$("#chatSend").onclick=()=>sendChat($("#chatInput").value);
$("#chatInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();sendChat($("#chatInput").value)}};
$$(".chat-emotes button").forEach(btn=>{
  btn.onclick=()=>sendChat(btn.dataset.emote);
});

// Listen for incoming chat from others
Multiplayer.onChat((playerId,name,text,bot)=>{
  addChatLog(name||'TRENCHER',text,false,bot);
});

// panels
function openPanel(id){
  if(!TITLES[id])return;
  if(!current){wasPlaying=Game.mode==="play";Game.pause(true)}
  current=id;$("#panelTitle").textContent=TITLES[id];
  
  // Render appropriate content
  if(id==='inventory'){
    $("#panelBody").innerHTML=renderInventory();
  }else if(id==='skills'){
    $("#panelBody").innerHTML=typeof BTSkillTree!=='undefined'?BTSkillTree.render():'<p class="note">Skills loading…</p>';
  }else if(id==='leaderboard'){
    $("#panelBody").innerHTML='<p class="note">Loading...</p>';
    renderLeaderboard();
  }else if(id==='campaign'){
    $("#panelBody").innerHTML=typeof Campaign!=='undefined'?Campaign.renderMap():'<p class="note">Campaign loading…</p>';
  }else if(id==='events'){
    $("#panelBody").innerHTML=typeof BTEvents!=='undefined'?BTEvents.render():'<p class="note">Loading events…</p>';
    if(typeof BTEvents!=='undefined')BTEvents.refresh();
  }else if(id==='squad'){
    $("#panelBody").innerHTML='<p class="note">Loading squad…</p>';
    renderSquad();
  }else if(id==='world'){
    $("#panelBody").innerHTML=typeof WorldMap!=='undefined'?WorldMap.render():'<p class="note">Map loading…</p>';
    if(typeof WorldMap!=='undefined')WorldMap.mount();
  }else if(id==='elevator'){
    $("#panelBody").innerHTML=renderElevator(null);
    loadElevatorStops();
  }else{
    $("#panelBody").innerHTML=BT.render(id);
    // Hot List page: the in-game hot list (most collected in the trench) sits above the Telegram list.
    if(id==='hot'&&typeof BTPulse!=='undefined'){$("#panelBody").insertAdjacentHTML('afterbegin',BTPulse.hotSection());BTPulse.mountHot()}
  }
  
  if(id!=='world'&&typeof WorldMap!=='undefined')WorldMap.unmount();
  $("#panelBody").scrollTop=0;
  // Pink EXAMPLE DATA badge only on data panels (hot/calls/callers) that really fell back to data/calls.json.
  const dataPanel=id==="hot"||id==="calls"||id==="callers";
  const live=!!(BT.data&&BT.data.meta&&BT.data.meta.live);
  $(".example").style.display=dataPanel&&!live?"":"none";
  $$(".paneltabs button,#menu a").forEach(b=>b.classList.toggle("on",b.dataset.nav===id));
  $("#panelWrap").classList.remove("hidden");$("#menu").classList.remove("open");
  if(location.hash!=="#"+id)history.replaceState(null,"","#"+id);
  Sfx.play("ui");
  Haptics.selection();
}
function closePanel(){
  if(typeof WorldMap!=='undefined')WorldMap.unmount();
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
        <div class="profile-ids">${profile.x_handle?escHtml(profile.x_handle):''}${profile.wallet?' · '+escHtml(shortWallet(profile.wallet)):''}${(profile.titles||[]).length?' · '+escHtml((profile.titles||[]).join(' · ')):''}</div>
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
  // XP / LEVEL / SQUADS come from Profiles (all-time). DEPTH, GEMS, BOSSES and POWER 9 also have
  // DAILY / WEEKLY boards from the Pulse (server-validated pickups only; guests never ranked).
  const PULSE_M={depth:'depth',gems:'gems',boss:'boss',p9:'p9'};
  const NOTE={gems:'Diamonds, power gems and relics the server credited to you.',boss:'Bosses you landed the killing blow on.',p9:'Power of 9 points: every gem you dig fills the server-wide meter (9-streaks, 589 m and boss kills count extra). Fill it together for a boost for everyone online.',depth:'Deepest verified dig.'};
  let lbType='xp',lbPeriod='day';
  const row=(r,i,value)=>{
    const rank=i+1,rankClass=rank===1?'gold':rank===2?'silver':rank===3?'bronze':'';
    const isMe=profile&&r.id&&r.id===profile.id;
    const pfpHtml=r.pfp?`<img src="${escHtml(r.pfp)}" alt="">`:'';
    const extra=r.x_handle?` <span class="sub">${escHtml(r.x_handle)}</span>`:'';
    return `<div class="lb-row ${rank<=3?'top3':''} ${isMe?'equipped':''} ${r.anon?'anon':''}">
      <div class="lb-rank ${rankClass}">#${rank}</div>
      <div class="lb-pfp">${pfpHtml}</div>
      <div class="lb-name">${escHtml(r.name||r.code||'Trencher')}${extra}</div>
      <div class="lb-value">${value}</div>
    </div>`;
  };
  async function load(type,period){
    lbType=type;if(period)lbPeriod=period;
    const pulse=PULSE_M[type]&&typeof BTPulse!=='undefined'&&!(type==='depth'&&lbPeriod==='all');
    let rows=[],err=false;
    try{
      if(pulse)rows=(await BTPulse.loadBoard(PULSE_M[type],lbPeriod)).rows||[];
      else rows=await RPG.fetchLeaderboard(type);
    }catch(e){err=true}
    let html=`
      <div class="lb-tabs">
        <button data-lb="xp" class="${type==='xp'?'on':''}">XP</button>
        <button data-lb="depth" class="${type==='depth'?'on':''}">DEPTH</button>
        <button data-lb="gems" class="${type==='gems'?'on':''}">GEMS</button>
        <button data-lb="boss" class="${type==='boss'?'on':''}">BOSSES</button>
        <button data-lb="p9" class="${type==='p9'?'on':''}">⚡ POWER 9</button>
        ${typeof BTSave!=='undefined'&&BTSave.config.levelsUnlocked?`<button data-lb="level" class="${type==='level'?'on':''}">LEVEL</button>`:''}
        <button data-lb="squad" class="${type==='squad'?'on':''}">SQUADS</button>
      </div>`;
    if(PULSE_M[type])html+=`<div class="lb-tabs lb-period">${[['day','DAILY'],['week','WEEKLY'],['all','ALL-TIME']].map(([k,l])=>`<button data-lbp="${k}" class="${lbPeriod===k?'on':''}">${l}</button>`).join('')}</div><p class="note">${NOTE[type]} Guests aren't ranked: log in to get on the board.</p>`;
    if(err)html+='<p class="note">Rankings unavailable right now.</p>';
    else if(rows.length===0)html+=`<p class="note">No rankings ${PULSE_M[type]&&lbPeriod!=='all'?(lbPeriod==='day'?'today':'this week'):''} yet. Be the first!</p>`;
    else{
      html+='<div class="lb-list">';
      rows.forEach((r,i)=>{
        const value=pulse?BTPulse.VAL[type](r):type==='depth'?`${r.best_depth}M`:type==='level'?`L${r.max_level||1} · ${r.best_depth}M`:type==='squad'?`${r.xp} SXP`:`${r.xp} XP`;
        html+=row(r,i,value);
      });
      html+='</div>';
    }
    $("#panelBody").innerHTML=html;
    $$("[data-lb]").forEach(btn=>btn.onclick=()=>load(btn.dataset.lb));
    $$("[data-lbp]").forEach(btn=>btn.onclick=()=>load(lbType,btn.dataset.lbp));
  }
  await load('xp');
}

function escHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

async function squadAuthHeaders(){
  const token=await RPG.getAuthToken();
  const profile=RPG.getProfile();
  const h={'Content-Type':'application/json'};
  if(token)h.Authorization='Bearer '+token;
  else if(profile&&String(profile.id).startsWith('guest:'))h['X-Guest-Secret']=RPG.getGuestSecret();
  return h;
}

async function renderSquad(){
  const profile=RPG.getProfile();
  const base=BT_CONFIG.serverUrl.replace(/\/$/,'');
  let mine=null;
  try{
    const q=new URLSearchParams();
    if(profile&&profile.id&&!profile.fid&&!(String(profile.id).startsWith('did:privy:')))q.set('profileId',profile.id);
    const headers=await squadAuthHeaders();
    const r=await fetch(base+'/api/squads/me'+(q.toString()?'?'+q:''),{headers});
    mine=await r.json();
  }catch(e){}
  const sq=mine&&mine.squad;
  let html='<p class="note">Squads of up to 9. Share a code, share an objective, share XP. Leaderboard is on RANKS → SQUADS.</p>';
  if(!sq){
    html+=`<div class="squad-forms">
      <form id="squadCreate" class="login-form"><input name="name" maxlength="24" placeholder="SQUAD NAME" required><input name="objective" maxlength="80" placeholder="OBJECTIVE (dig 90)" ><button>CREATE</button></form>
      <form id="squadJoin" class="login-form"><input name="code" maxlength="8" placeholder="CODE" required><button>JOIN</button></form>
    </div>`;
  }else{
    const members=(sq.members||[]).map(m=>`<li><b>${escHtml(m.name)}</b> LV ${m.level}${m.x_handle?' '+escHtml(m.x_handle):''}</li>`).join('');
    const pct=sq.objective_target?Math.min(100,100*sq.objective_progress/sq.objective_target):0;
    html+=`<div class="squad-card">
      <h3 class="dotmatrix">${escHtml(sq.name)}</h3>
      <div class="squad-code">CODE ${escHtml(sq.code)}</div>
      <p>${escHtml(sq.objective||'')} · ${sq.objective_progress||0}/${sq.objective_target||0}</p>
      <div class="xpbar wide"><span style="width:${pct}%"></span></div>
      <div>SQUAD XP ${sq.xp||0} · ${ (sq.members||[]).length }/9</div>
      <ol class="squad-members">${members}</ol>
      <button type="button" id="squadLeave">LEAVE SQUAD</button>
    </div>`;
  }
  $("#panelBody").innerHTML=html;
  const create=$("#squadCreate");
  if(create)create.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(create);
    const r=await fetch(base+'/api/squads',{method:'POST',headers:await squadAuthHeaders(),body:JSON.stringify({name:fd.get('name'),objective:fd.get('objective'),profileId:profile&&profile.id})}).catch(()=>null);
    const d=r?await r.json().catch(()=>({})):{error:'offline'};
    if(!r||!r.ok||d.success===false)hint(String(d.error||'squad error').toUpperCase());
    renderSquad();
  };
  const join=$("#squadJoin");
  if(join)join.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(join);
    const r=await fetch(base+'/api/squads/join',{method:'POST',headers:await squadAuthHeaders(),body:JSON.stringify({code:fd.get('code'),profileId:profile&&profile.id})}).catch(()=>null);
    const d=r?await r.json().catch(()=>({})):{error:'offline'};
    if(!r||!r.ok||d.success===false)hint(String(d.error||'squad error').toUpperCase());
    renderSquad();
  };
  const leave=$("#squadLeave");
  if(leave)leave.onclick=async()=>{
    await fetch(base+'/api/squads/leave',{method:'POST',headers:await squadAuthHeaders(),body:JSON.stringify({profileId:profile&&profile.id})});
    renderSquad();
  };
}

function renderRoster(list){
  const el=$("#rosterPanel");
  if(!el)return;
  const rows=list||[];
  const r=Multiplayer.connected?Multiplayer.recruitCount:0;
  const head=`<div class="roster-head">${rows.length} TRENCHER${rows.length===1?'':'S'}${r?` <span class="bot-tag">+ ${r} RECRUIT BOT${r>1?'S':''}</span>`:''}</div>`;
  el.innerHTML=head+(rows.length?rows.map(p=>`<div class="roster-row ${p.status||''}">
    <span class="dot ${p.status==='idle'?'idle':'on'}"></span>
    <b>${escHtml(p.name||'Trencher')}</b>
    <span>LV ${p.level||1}</span>
    <span>${escHtml(p.xHandle||'')}</span>
    <span class="st">${p.status==='idle'?'IDLE':'ACTIVE'}</span>
  </div>`).join(''):'<div class="roster-row">Nobody else in the trench.</div>');
}

async function refreshPresence(){
  try{
    const r=await fetch(BT_CONFIG.serverUrl.replace(/\/$/,'')+'/presence',{cache:'no-store'});
    const d=await r.json();
    const n=d.online||0;
    const home=$("#homeOnline");
    if(home)home.textContent=n?`${n} IN THE TRENCH`:'TRENCH QUIET';
    if(!Multiplayer.connected)$("#onlineCount").textContent=n;
  }catch(e){}
}

document.addEventListener("click",e=>{
  const n=e.target.closest("[data-nav]");
  if(n){e.preventDefault();const id=n.dataset.nav;
    if(id==="play"){closePanel();$("#menu").classList.remove("open");if(Game.mode!=="play")start();return}
    openPanel(id);return}
  if(current==="skills"&&typeof BTSkillTree!=='undefined'&&e.target.closest("[data-learn],[data-skreset]")){
    BTSkillTree.onClick(e,()=>{if(current==="skills")openPanel("skills")});return}
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
  if(typeof BTSave!=='undefined'){
    BTSave.loadConfig().then(()=>{if(current==='campaign')openPanel('campaign')});
    BTSave.fetchSave().then(sv=>{if(sv&&sv.sector)Multiplayer.setRoom(sv.sector)}).finally(()=>{if(profile)Multiplayer.connect(profile)});
  }else if(profile){
    Multiplayer.connect(profile);
  }
  if(typeof BTEvents!=='undefined')BTEvents.start();
  refreshPresence();
  setInterval(refreshPresence,15000);
}).finally(()=>{
  clearInterval(lt);$("#loadfill").style.width="100%";
  setTimeout(()=>{
    $("#loader").classList.add("done");
    // Signal mini-app host that we're ready
    MiniApp.ready();
    // Show username greeting if available
    const tgU=(typeof BTTelegram!=='undefined'&&BTTelegram.user())||null;
    const username=MiniApp.getUsername()||(tgU&&(tgU.username||tgU.first_name))||null;
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
setInterval(()=>{updateRpgHud();if(Multiplayer.connected)paintOnline()},1000);

// Privy account chip (hidden when BT_PRIVY_APP_ID is empty). Guest → "GUEST · SIGN IN"; signed in → avatar, name, method, wallet.
function toast(text,ms){
  let t=$("#toast");
  if(!t){t=document.createElement("div");t.id="toast";t.className="toast";t.setAttribute("role","status");t.setAttribute("aria-live","polite");document.body.appendChild(t)}
  t.textContent=text;t.classList.remove("hidden");t.classList.add("show");
  clearTimeout(toast._t);toast._t=setTimeout(()=>{t.classList.remove("show")},ms||3200);
}
function renderAccountChip(snap){
  const b=$("#loginBtn");if(!b)return;
  if(!snap||!snap.did){
    b.classList.remove("acct-chip","signed-in");b.classList.add("guest-chip");
    b.innerHTML='<span class="chip-guest">GUEST</span><span class="chip-cta">SIGN IN</span>';
    b.setAttribute("aria-label","Guest. Sign in");b.title="Playing as guest. Sign in to keep your XP";
    return;
  }
  const ic=BTPrivy.methodIcon(snap.method)||"✓",label=BTPrivy.methodLabel(snap.method)||"Privy";
  const name=snap.displayName||"Trencher";
  const av=snap.avatar?`<img src="${escHtml(snap.avatar)}" alt="" referrerpolicy="no-referrer">`:`<i>${escHtml(name.replace(/^@/,"").slice(0,1).toUpperCase())}</i>`;
  b.classList.remove("guest-chip");b.classList.add("acct-chip","signed-in");
  b.innerHTML=`<span class="chip-av">${av}</span><span class="chip-name">${escHtml(name)}</span><span class="chip-m" title="${escHtml(label)}">${escHtml(ic)}</span>${snap.wallet?`<span class="chip-w">${escHtml(shortWallet(snap.wallet))}</span>`:""}`;
  b.setAttribute("aria-label",`Signed in as ${name} with ${label}. Open account`);b.title=`Signed in as ${name} · ${label}`;
}
if(typeof BTPrivy!=='undefined'&&BTPrivy.enabled()){
  $("#loginBtn").classList.remove("hidden");
  renderAccountChip(null);
  $("#loginBtn").onclick=()=>{BTPrivy.show();Haptics.selection()};
  BTPrivy.onChange(async snap=>{
    renderAccountChip(snap);
    if(snap.event==="login"&&snap.did)toast(`Logged in as ${snap.displayName||"Trencher"} · ${BTPrivy.methodLabel(snap.method)||"Privy"}`);
    else if(snap.event==="link"&&snap.did)toast("Account linked");
    else if(snap.event==="logout"){toast("Logged out · playing as Guest");setTimeout(()=>location.reload(),1200);return}
    const profile=RPG.getProfile();
    if(snap.did&&profile){
      profile.id=snap.did;
      if(snap.xHandle)profile.x_handle=snap.xHandle;
      if(snap.wallet)profile.wallet=snap.wallet;
      await RPG.saveToServer();
      if(RPG.maybeMigrate)await RPG.maybeMigrate(snap);
      Multiplayer.disconnect();
      Multiplayer.connect(RPG.getProfile());
      updateRpgHud();
      if(typeof BTSave!=='undefined')BTSave.afterLogin();
    }
    updateRpgHud();
  });
}

// Live roster
if($("#rosterBtn")){
  $("#rosterBtn").classList.remove("hidden");
  $("#rosterBtn").onclick=()=>{$("#rosterPanel").classList.toggle("hidden");Haptics.selection()};
}
Multiplayer.onRoster(list=>renderRoster(list));

// ---------- teleport + elevator ----------
// ⇧ SURFACE: teleport back to the trench (T key), 90 s cooldown. The LIFT at the east end of the
// trench rides to the top of any level you have reached (stops come from your saved profile; with
// levels locked it is level 1 shaft stops only). From the title / game-over screen a ride starts a
// fresh run at the stop (server writes it as your save).
function paintTp(){const b=$("#tpBtn");if(!b)return;const cd=Game.teleportCooldown;b.classList.toggle("cool",cd>0);b.textContent=cd>0?"⇧ "+cd+"S":"⇧ SURFACE"}
setInterval(()=>{if(Game.mode==="play")paintTp()},500);
$("#tpBtn").onclick=e=>{e.stopPropagation();Haptics.selection();const r=Game.teleportTop();
  if(r.ok)hint("TELEPORTED · WALK EAST TO THE LIFT TO RIDE DOWN",3500);else if(r.error==="cooldown")hint("TELEPORT RECHARGING · "+r.cooldown+"S",1500);else if(r.error==="surface")hint("ALREADY AT THE SURFACE",1200);paintTp()};
let elevStops=null,elevBusy=false;
function elevMerge(a,b){const m=new Map();for(const s of [...(a||[]),...(b||[])])if(!m.has(s.depth))m.set(s.depth,s);return [...m.values()].sort((x,y)=>x.depth-y.depth)}
async function loadElevatorStops(){
  let server=null;
  if(RPG.isLoggedIn()){try{const token=await RPG.getAuthToken();
    if(token){const r=await fetch(BT_CONFIG.serverUrl+'/api/elevator',{headers:{Authorization:'Bearer '+token}});const j=await r.json().catch(()=>null);if(j&&Array.isArray(j.stops))server=j.stops}}catch(e){}}
  const local=Game.mode==="play"?Game.elevatorStops():[{level:1,depth:0,label:"SURFACE"}];
  elevStops=elevMerge(server,local);
  if(current==='elevator')$("#panelBody").innerHTML=renderElevator(elevStops);
}
function renderElevator(stops){
  const inRun=Game.mode==="play",atLift=inRun&&Game.nearElevator(),locked=!(typeof BTSave!=='undefined'&&BTSave.config.levelsUnlocked);
  if(!stops)return '<p class="note">Calling the lift…</p>';
  const can=!inRun||atLift;
  let h='<div class="elev">';
  h+='<p class="note">'+(inRun?(atLift?'Pick a stop. You keep your lives, gems and multiplier; depth bonuses pick up below the stop.':'Walk to the <b>LIFT</b> at the east end of the trench to ride. Deep down? Use <b>⇧ SURFACE</b> (T) to teleport up first.')
    :(RPG.isLoggedIn()?'Start a fresh run at any stop you have reached.':'Log in to ride to the levels you have reached. Guests start at the surface.'))+'</p>';
  h+='<div class="elev-stops">';
  for(const s of stops){const lv=locked?'':'<i>LV '+s.level+'</i>';
    h+='<button type="button" class="elev-stop" data-elev="'+(s.depth|0)+'"'+(can?'':' disabled')+'><b>'+escHtml(s.label)+'</b>'+lv+'<span>'+(s.depth|0)+'M</span></button>'}
  h+='</div>';
  if(locked)h+='<p class="note small">Levels 2+ are still sealed, so the shaft only runs through level 1 for now.</p>';
  return h+'</div>';
}
$("#panelBody").addEventListener("click",async e=>{
  const b=e.target.closest&&e.target.closest("[data-elev]");if(!b||b.disabled||elevBusy)return;
  const depth=+b.dataset.elev;Haptics.selection();
  if(Game.mode==="play"){if(!Game.nearElevator())return;closePanel();Game.rideElevator(depth);
    if(typeof BTSave!=='undefined'&&RPG.isLoggedIn())setTimeout(()=>BTSave.saveNow({quiet:true,http:true}),600);return}
  if(depth===0||!RPG.isLoggedIn()){closePanel();start();return}
  elevBusy=true;b.textContent='RIDING…';
  try{const token=await RPG.getAuthToken();
    const r=await fetch(BT_CONFIG.serverUrl+'/api/elevator',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({depth,sector:Multiplayer.room})});
    const j=await r.json().catch(()=>null);
    if(j&&j.ok&&j.save){closePanel();$("#title").classList.add("hidden");$("#over").classList.add("hidden");$("#hud").classList.remove("hidden");
      if(touch)$("#touch").classList.remove("hidden");Game.startFrom(j.save);updateRpgHud();if(typeof BTSave!=='undefined')BTSave.fetchSave();hint("ELEVATOR · "+j.stop.label,3500)}
    else hint("LIFT JAMMED · "+((j&&j.error)||'offline').toUpperCase(),2500);
  }catch(err){hint("LIFT OFFLINE",2000)}
  elevBusy=false;
});
$$("#elevBtn,#overElevBtn").forEach(b=>b.onclick=()=>{Haptics.selection();openPanel('elevator')});
})();
