// Power of 9 UI: the HUD meter + Telegram-style in-game feed, the IN-GAME HOT LIST section on the
// Hot List page, and the daily / weekly / all-time boards on RANKS. Server data only (/api/pulse,
// room 'pulse' / 'p9' messages); nothing here can add to a count.
(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const P=window.BTPower9;
const api=p=>((window.BT_CONFIG&&BT_CONFIG.serverUrl)||"").replace(/\/$/,"")+p;
let live={meter:0,max:P?P.P9.METER_MAX:99,boost:null},boostUntil=0,boostSeen=0,boostPending=null,feed=[],hotWin="h1",hotTimer=null;

function ago(t){const s=Math.max(0,(Date.now()-t)/1000);return s<45?"now":s<3600?Math.round(s/60)+"m":s<86400?Math.round(s/3600)+"h":Math.round(s/86400)+"d"}
function initial(who){const w=String(who||"?").replace(/^@/,"");return (w[0]||"?").toUpperCase()}
function line(it){return P?P.feedText(it):""}
function bubble(it,full){
  const sys=it.kind==="boost";
  return `<div class="tg-msg ${sys?"sys":""} k-${esc(it.kind)}">${sys?"":`<span class="tg-av">${esc(initial(it.who))}</span>`}
    <div class="tg-b">${sys?"":`<b class="tg-who">${esc(it.who)}</b>`}<span class="tg-t">${esc(sys?line(it):line(it).slice(String(it.who||"").length+1))}</span>${full?`<i class="tg-time">${ago(it.t)}</i>`:""}</div></div>`;
}
function squares(n,max){const on=Math.floor(Math.min(1,n/max)*9);let s="";for(let i=0;i<9;i++)s+=`<i class="${i<on?"on":""}"></i>`;return s}

// ---------- HUD ----------
function mountHud(){
  const hud=$("#hud");if(!hud||$("#p9Box"))return;
  const box=document.createElement("div");box.id="p9Box";box.className="p9-box";
  box.innerHTML=`<div class="p9-meter" title="Server-wide Power of 9 meter: every gem anyone digs fills it. Full = a ${P?Math.round(P.P9.BOOST_MS/1000):99}s boost for everyone online."><b>⚡ POWER OF 9</b><span class="p9-sq" id="p9Sq"></span><output id="p9Out">0/99</output></div>
    <div class="p9-boost hidden" id="p9Boost"></div><div class="p9-feed" id="p9Feed"></div>`;
  hud.appendChild(box);renderHud();
}
function renderHud(){
  const sq=$("#p9Sq");if(!sq)return;
  sq.innerHTML=squares(live.meter,live.max);$("#p9Out").textContent=live.meter+"/"+live.max;
  const left=boostUntil-Date.now(),b=$("#p9Boost");
  if(left>0){b.classList.remove("hidden");b.textContent="⚡ POWER OF 9 BOOST · +9 XP / GEM · "+Math.ceil(left/1000)+"s"}else b.classList.add("hidden");
  $("#p9Box").classList.toggle("boosting",left>0);
}
function showFeed(items){
  const el=$("#p9Feed");if(!el)return;
  for(const it of items){const d=document.createElement("div");d.innerHTML=bubble(it,false);const n=d.firstElementChild;el.appendChild(n);setTimeout(()=>n.remove(),12000)}
  while(el.children.length>3)el.firstElementChild.remove();
}
function onPulse(d){
  if(!d||typeof d.meter!=="number")return;
  live={...live,...d};
  if(d.boost&&d.boost.until){const skew=Date.now()-(d.now||Date.now());boostUntil=d.boost.until+skew;
    if(typeof Game!=="undefined"&&Game.setBoost)Game.setBoost(boostUntil);
    if(d.boost.id!==boostSeen&&boostUntil>Date.now())boostPending={id:d.boost.id,start:d.boost.start+skew,who:(d.lastCharge||[]).map(c=>c.name)};
    checkBoost()}
  const fresh=(d.feed||[]).filter(f=>!feed.some(g=>g.seq===f.seq));
  feed=feed.concat(fresh).slice(-30);
  showFeed(fresh.slice(-3));renderHud();
}
// A full meter fires the boost for everyone online: big banner when it starts (a boost that fills
// during a boost queues after it).
function checkBoost(){
  const b=boostPending;if(!b||Date.now()<b.start)return;
  boostPending=null;boostSeen=b.id;
  if(typeof Game!=="undefined"&&Game.p9Moment)Game.p9Moment("boost");
  bigBanner("⚡ POWER OF 9 BOOST ⚡",`+${P?P.P9.BOOST_BONUS_XP:9} XP PER GEM · x${P?P.P9.BOOST_GEM_X:1.09} GEMS · ${P?Math.round(P.P9.BOOST_MS/1000):99}s FOR EVERYONE ONLINE`,b.who&&b.who.length?"CHARGED BY "+b.who.slice(0,5).join(" · "):"");
}
function bigBanner(title,sub,foot){
  const hud=$("#hud");if(!hud||hud.classList.contains("hidden"))return;
  let el=$("#p9Big");if(!el){el=document.createElement("div");el.id="p9Big";el.className="p9-big";hud.appendChild(el)}
  el.innerHTML=`<b>${esc(title)}</b><span>${esc(sub)}</span>${foot?`<i>${esc(foot)}</i>`:""}`;
  el.classList.remove("show");void el.offsetWidth;el.classList.add("show");
  clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("show"),4800);
}
function onP9(d){
  if(!d||!d.kind)return;
  if(typeof Game!=="undefined"&&Game.p9Moment)Game.p9Moment(d.kind,d);
  const msg=d.kind==="streak"?"9-STREAK · +9 TOWARD THE POWER OF 9 METER":d.kind==="manifest"?`MANIFESTING ${d.depth} M · +9 POWER OF 9`:d.kind==="perk"?(d.label||"POWER OF 9 PERK"):"";
  const h=$("#hint");if(msg&&h){h.textContent=msg;h.classList.remove("hidden");setTimeout(()=>h.classList.add("hidden"),3500)}
  if(d.kind==="perk")applyPerk(d.level);
}
function applyPerk(level){
  if(!P||typeof Game==="undefined"||!Game.setPerk)return;
  const lv=level||((typeof RPG!=="undefined"&&RPG.getProfile&&RPG.getProfile())||{}).level||1;
  Game.setPerk(P.perkFor(lv).digSpeed);
}
setInterval(()=>{renderHud();applyPerk();checkBoost()},1000);

// ---------- Hot List page: IN-GAME HOT LIST ----------
function hotSection(){return `<section class="ig-hot" id="igHot"><p class="note">Loading the in-game hot list…</p></section>`}
async function loadPulse(){const r=await fetch(api("/api/pulse"),{cache:"no-store"});if(!r.ok)throw new Error("pulse "+r.status);return r.json()}
function renderHot(st){
  const el=$("#igHot");if(!el)return;
  const rows=(st.hot&&st.hot[hotWin])||[];const top=rows.length?rows[0].n:1;
  const label=k=>k.startsWith("$")?`<b class="ig-tk">${esc(k)}</b>`:`<b class="ig-kind">${esc(k)}</b>`;
  const boostLeft=st.boost?Math.max(0,st.boost.until-st.now):0;
  el.innerHTML=`
    <div class="ig-head"><h3 class="dotmatrix">IN-GAME HOT LIST</h3><span class="sub">MOST COLLECTED IN THE TRENCH · SERVER-VERIFIED PICKUPS</span></div>
    <div class="ig-cols">
      <div class="ig-board">
        <div class="lb-tabs ig-tabs">${[["h1","1H"],["h24","24H"],["all","ALL-TIME"]].map(([k,l])=>`<button data-igwin="${k}" class="${k===hotWin?"on":""}">${l}</button>`).join("")}</div>
        ${rows.length?`<ol class="ig-list">${rows.map((r,i)=>`<li><span class="ig-rank">#${i+1}</span>${label(r.key)}<span class="ig-bar"><span style="width:${Math.max(4,r.n/top*100).toFixed(0)}%"></span></span><output>${r.n}</output></li>`).join("")}</ol>`
          :`<p class="note">Nothing dug up in this window yet. Power gems in a coin's seam count for that coin.</p>`}
        <div class="ig-meter"><b>⚡ POWER OF 9 METER</b><span class="p9-sq big">${squares(st.meter,st.max)}</span><output>${st.meter}/${st.max}</output>
          <p class="sub">${boostLeft>0?`BOOST LIVE · ${Math.ceil(boostLeft/1000)}s LEFT · +9 XP PER GEM FOR EVERYONE ONLINE`:`Every gem anyone digs fills it. Full = a ${Math.round(P.P9.BOOST_MS/1000)}s POWER OF 9 boost for everyone online.`}</p>
          ${(st.lastCharge||[]).length?`<p class="sub">LAST CHARGE: ${st.lastCharge.map(c=>esc(c.name)+" "+c.p).join(" · ")}</p>`:""}</div>
      </div>
      <div class="tg-feed"><div class="tg-top"><span class="tg-dot"></span><b>TRENCH FEED</b><span class="sub">live</span></div>
        <div class="tg-list">${(st.feed||[]).length?(st.feed||[]).slice(0,15).map(it=>bubble(it,true)).join(""):`<p class="note">Quiet down there. Start digging to post here.</p>`}</div></div>
    </div>`;
  el.querySelectorAll("[data-igwin]").forEach(b=>b.onclick=()=>{hotWin=b.dataset.igwin;renderHot(st)});
}
async function mountHot(){
  clearInterval(hotTimer);
  const tick=async()=>{if(!$("#igHot")){clearInterval(hotTimer);return}try{renderHot(await loadPulse())}catch(e){const el=$("#igHot");if(el)el.innerHTML=`<p class="note">In-game hot list unavailable right now.</p>`}};
  await tick();hotTimer=setInterval(tick,10000);
}

// ---------- RANKS ----------
async function loadBoard(metric,period){
  const r=await fetch(api(`/api/pulse/leaders?metric=${metric}&period=${period}`),{cache:"no-store"});
  if(!r.ok)throw new Error("leaders "+r.status);return r.json();
}
const VAL={depth:r=>r.depth+"M",gems:r=>r.gems+" GEMS",boss:r=>r.boss+(r.boss===1?" BOSS":" BOSSES"),p9:r=>r.p9+" P9"};

window.BTPulse={mountHud,onPulse,onP9,hotSection,mountHot,loadBoard,VAL,get live(){return live},get feed(){return feed}};
if(typeof Multiplayer!=="undefined"){Multiplayer.onPulse(onPulse);Multiplayer.onP9(onP9)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mountHud);else mountHud();
})();
