// Wiring: loader, navigation, panels, HUD, touch controls, mini-app + haptics.
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const TITLES={hot:"HOT LIST",calls:"PREVIOUS CALLS",callers:"CALLERS",about:"HOW IT WORKS"};
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
  $("#overStats").innerHTML=`MULTIPLIER <b>x${s.mult.toFixed(2)}</b><br>DEPTH ${s.depth}M · GEMS ${s.gems} · POWER ${s.powerGems}<br>BEST x${(+s.best).toFixed(2)} · GOAL 589x`;
  $("#over").classList.remove("hidden");
  lastStats=s;
}
Game.init($("#game"),{onHud,onHit,onOver,onHint:t=>hint(t),onOpen:id=>openPanel(id)});

function start(){
  $("#title").classList.add("hidden");$("#over").classList.add("hidden");$("#hud").classList.remove("hidden");
  if(touch)$("#touch").classList.remove("hidden");
  Game.start();
  if(!touch)hint("SPACE TO DIG · ARROWS TO MOVE · ↓+SPACE DIGS DOWN",4500);else hint("⛏ DIG · ▼+⛏ DIGS DOWN",4000);
}
$("#startBtn").onclick=start;
addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(TITLES[h])openPanel(h);else if(!h&&current)closePanel()});$("#retryBtn").onclick=start;
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

// panels
function openPanel(id){
  if(!TITLES[id])return;
  if(!current){wasPlaying=Game.mode==="play";Game.pause(true)}
  current=id;$("#panelTitle").textContent=TITLES[id];
  $("#panelBody").innerHTML=BT.render(id);$("#panelBody").scrollTop=0;
  $(".example").style.display=id==="about"?"none":"";
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
});

// touch controls
$$("#touch button").forEach(b=>{
  const k=b.dataset.k;
  const on=e=>{e.preventDefault();Sfx.unlock();b.classList.add("down");Game.setKey(k,true);Haptics.selection()};
  const off=e=>{e.preventDefault();b.classList.remove("down");Game.setKey(k,false)};
  b.addEventListener("pointerdown",on);b.addEventListener("pointerup",off);b.addEventListener("pointercancel",off);b.addEventListener("pointerleave",off);
});

// data
BT.load().then(()=>{
  Game.setHotList(BT.hot().map(h=>({ticker:h.coin.ticker,status:h.status})));
  $("#tickerInner").innerHTML=BT.tickerHTML()+BT.tickerHTML();
}).catch(err=>{console.error(err);$("#tickerInner").textContent="COULD NOT LOAD data/calls.json (serve over http, not file://)"}).finally(()=>{
  clearInterval(lt);$("#loadfill").style.width="100%";
  setTimeout(()=>{
    $("#loader").classList.add("done");
    // Signal mini-app host that we're ready
    MiniApp.ready();
    // Show username greeting if available
    const username=MiniApp.getUsername();
    if(username)$("#greeting").textContent="WELCOME "+username.toUpperCase();
    const h=location.hash.slice(1);if(TITLES[h])openPanel(h);else if(h==="play")start();
  },450);
});
})();
