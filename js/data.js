// Data layer: loads data/calls.json (the single source of truth) and renders panels.
(function(){
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtUsd=n=>n==null?"—":n>=1e9?"$"+(n/1e9).toFixed(2)+"B":n>=1e6?"$"+(n/1e6).toFixed(2)+"M":n>=1e3?"$"+(n/1e3).toFixed(1)+"K":"$"+n.toFixed(0);
const fmtX=m=>m==null?"—":m>=100?m.toFixed(0)+"x":m>=10?m.toFixed(1)+"x":m.toFixed(2)+"x";
const fmtDate=s=>s?new Date(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:innerWidth<560?undefined:"numeric",timeZone:"UTC"}).toUpperCase():"—";
const xUrl=h=>"https://x.com/"+encodeURIComponent(String(h).replace(/^@/,""));
const tgUrl=h=>"https://t.me/"+encodeURIComponent(String(h).replace(/^@/,""));

const BT={data:null,state:{callsSort:"date",callerFilter:null}};
// Live data from the Power of 9 bot API (bot/). Falls back to data/calls.json (EXAMPLE DATA) while the live board is empty.
async function getJson(u){const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw new Error(u+" "+r.status);return r.json()}
BT.fromApi=function(hot,calls,callers,base){
  const coins={},people={};
  const person=p=>{if(!p)return null;if(!people[p.id])people[p.id]={id:p.id,alias:p.name||p.telegram_handle||"trencher",x_handle:p.x_handle||null,telegram_handle:p.telegram_handle||null};return p.id};
  (callers.items||[]).forEach(person);
  const coinId=c=>{if(!coins[c.ca])coins[c.ca]={id:c.ca,ticker:c.symbol||"?",name:c.name||"",chain:"base",contract:c.ca,dexscreener_url:c.pair_url||null,image:c.image||null};return c.ca};
  const watchlist=(hot.items||[]).map(h=>({coin_id:coinId(h),status:h.status,tagN:h.tags,
    tags:(h.taggers||[]).map(t=>({telegram_handle:t.telegram_handle||t.name,tagged_at:t.tagged_at})),
    x_post:h.x_post?{url:h.x_post.url,comments:h.x_post.replies||0,retweets:h.x_post.reposts||0,likes:h.x_post.likes||0,checked_at:h.x_post.checked_at}:null,
    caller_id:person(h.caller),first_tagged_at:h.first_tagged_at,game_round:h.status==="pinned"?{id:"round-"+h.ca}:null,ath_x:h.ath_x,cur_x:h.cur_x}));
  const callRows=(calls.items||[]).map(c=>({id:c.ca,coin_id:coinId(c),caller_id:person(c.caller),called_at:c.powered_at,
    call_price_usd:c.call_price_usd,call_mcap_usd:c.call_mcap_usd,ath_mcap_usd:c.ath_mcap_usd,current_mcap_usd:c.mcap_usd,
    ath_x:c.ath_x,cur_x:c.cur_x,status:c.status,x_post_url:c.x_post?c.x_post.url:null,telegram_msg_url:c.telegram_msg_url}));
  return {meta:{...base.meta,example_data:false,live:true,updated_at:new Date().toISOString(),hit_multiple:calls.hit_multiple||base.meta.hit_multiple},
    links:base.links,coins:Object.values(coins),callers:Object.values(people),watchlist,calls:callRows};
};
BT.load=async function(){
  const api=(window.BT_CONFIG&&BT_CONFIG.botUrl)||window.BT_BOT_URL;
  const base=await getJson("data/calls.json");
  base.links=Object.assign({},base.links,(window.BT_CONFIG&&BT_CONFIG.links)?{x:BT_CONFIG.links.x,telegram:BT_CONFIG.links.telegramChannel,telegram_group:BT_CONFIG.links.telegramGroup}:{});
  let d=base;BT.liveStatus="example";
  if(api){
    try{
      const [hot,calls,callers]=await Promise.all(["hot","calls","callers"].map(k=>getJson(api.replace(/\/$/,"")+"/api/"+k)));
      if((hot.items||[]).length||(calls.items||[]).length){d=BT.fromApi(hot,calls,callers,base);BT.liveStatus="live"}
      else BT.liveStatus="empty";
    }catch(e){console.warn("bot API unavailable, showing example data",e);BT.liveStatus="offline"}
  }
  d.coinById=Object.fromEntries(d.coins.map(c=>[c.id,c]));
  d.callerById=Object.fromEntries(d.callers.map(c=>[c.id,c]));
  const hitX=d.meta.hit_multiple||2;
  d.calls.forEach(c=>{
    if(c.ath_x==null&&c.ath_mcap_usd&&c.call_mcap_usd)c.ath_x=c.ath_mcap_usd/c.call_mcap_usd;
    if(c.cur_x==null&&c.current_mcap_usd&&c.call_mcap_usd)c.cur_x=c.current_mcap_usd/c.call_mcap_usd;
    c.hit=(c.ath_x||0)>=hitX});
  d.callerStats=d.callers.map(u=>{
    const cs=d.calls.filter(c=>c.caller_id===u.id);
    const hits=cs.filter(c=>c.hit).length;
    const best=cs.reduce((a,c)=>Math.max(a,c.ath_x||0),0);
    const live=d.watchlist.filter(w=>w.caller_id===u.id&&w.status==="tagging").length;
    return {...u,calls:cs.length,hits,hit_rate:cs.length?hits/cs.length:0,best,live};
  }).sort((a,b)=>b.best-a.best||b.hit_rate-a.hit_rate||b.calls-a.calls);
  BT.data=d;return d;
};
BT.hot=function(){
  const d=BT.data,T=d.meta.thresholds;
  const order={pinned:0,powered:1,tagging:2};
  return d.watchlist.map(w=>{
    const c=d.coinById[w.coin_id]||{ticker:"?",name:"?"};const p=w.x_post||{};
    const prog=Math.min(1,(w.tagN!=null?w.tagN:w.tags.length)/T.tags)*.5+(p.comments!=null?(Math.min(1,p.comments/T.comments)+Math.min(1,p.retweets/T.retweets)+Math.min(1,p.likes/T.likes))/6:0);
    const tagN=w.tagN!=null?w.tagN:w.tags.length;
    return {...w,coin:c,caller:d.callerById[w.caller_id],tagN,com:p.comments||0,rt:p.retweets||0,lk:p.likes||0,prog};
  }).sort((a,b)=>order[a.status]-order[b.status]||b.prog-a.prog);
};
function meter(label,n,max){
  let sq="";for(let i=0;i<max;i++)sq+=`<i class="${i<n?"on":""}"></i>`;
  return `<div class="meter"><label>${label}</label><span class="sq ${n>=max?"full":""}">${sq}</span><output>${Math.min(n,max)}/${max}</output></div>`;
}
const exampleText=`<p class="note"><b>EXAMPLE DATA</b> Every ticker, contract, number and handle below is fake placeholder data for this prototype, not real coins or real people. Not financial advice.</p>`;
const liveNote=()=>{const d=BT.data;
  if(d&&d.meta.live)return `<p class="note live"><b>● LIVE</b> from the Telegram bot <a href="https://t.me/Powerof9BaseBot" target="_blank" rel="noopener">@Powerof9BaseBot</a>. Tag a Base coin in the <a href="${esc(d.links.telegram_group||d.links.telegram)}" target="_blank" rel="noopener">group</a> with <code>/tag 0x…</code>. Prices refresh every 10 min. Not financial advice.</p>`;
  const why=BT.liveStatus==="empty"?`The live board is empty so far: be the first to <code>/tag</code> a Base coin in the <a href="${esc(d.links.telegram_group||d.links.telegram)}" target="_blank" rel="noopener">Telegram group</a>.`:BT.liveStatus==="offline"?"The live bot API is unreachable right now.":"";
  return exampleText+(why?`<p class="note">${why}</p>`:"")};
const handle=u=>u?(u.x_handle||u.telegram_handle||u.alias||"—"):"—";
const callerLink=u=>u?`<a href="#" data-caller="${esc(u.id)}">${esc(handle(u))}</a>`:"—";
const tgLink=h=>h?`<a href="${tgUrl(h)}" target="_blank" rel="noopener">${esc(h)}</a>`:"—";
const xLink=h=>h?`<a href="${xUrl(h)}" target="_blank" rel="noopener">${esc(h)}</a>`:"—";
const shortCa=a=>a?a.slice(0,6)+"…"+a.slice(-4):"";

BT.render=function(name){
  const d=BT.data;if(!d)return `<p>Loading…</p>`;
  const T=d.meta.thresholds;
  if(name==="hot"){
    const cards=BT.hot().map(h=>`
      <div class="card ${h.status}">
        <span class="st ${h.status}">${h.status==="pinned"?"📌 PINNED":h.status==="powered"?"⚡ POWERED UP":"TAGGING"}</span>
        <div class="tk">$${esc(h.coin.ticker)}</div>
        <div class="nm">${esc(h.coin.name)} · BASE${BT.data.meta.live?` · <a href="${esc(h.coin.dexscreener_url||"https://dexscreener.com/base/"+h.coin.contract)}" target="_blank" rel="noopener" title="${esc(h.coin.contract)}">${esc(shortCa(h.coin.contract))}</a>`:""}</div>
        <div class="tagbig"><b>${Math.min(h.tagN,T.tags)}/${T.tags}</b> TAGS<span class="pbar"><span style="width:${Math.min(100,h.tagN/T.tags*100).toFixed(0)}%"></span></span></div>
        ${meter("TAGS",h.tagN,T.tags)}
        ${meter("COMMENTS",h.com,T.comments)}
        ${meter("RETWEETS",h.rt,T.retweets)}
        ${meter("LIKES",h.lk,T.likes)}
        <div class="by">First tag: ${callerLink(h.caller)} · X ${xLink(h.caller?.x_handle)} · TG ${tgLink(h.caller?.telegram_handle)}${h.ath_x!=null&&h.status!=="tagging"?` · <span class="x ${h.ath_x>=9?"moon":h.ath_x>=1?"up":"down"}">ATH ${fmtX(h.ath_x)}</span>`:""}</div>
        <div class="acts2">${h.x_post?`<a href="${esc(h.x_post.url)}" target="_blank" rel="noopener">X POST ↗</a>`:""}<a href="#" data-play="${esc(h.coin.ticker)}">⛏ DIG FOR IT</a>${h.game_round?`<span class="x moon">GAME ROUND LIVE</span>`:""}</div>
      </div>`).join("");
    return `${liveNote()}<p class="note">9 tags on Telegram powers a coin up. When its X post hits ${T.comments} comments, ${T.retweets} retweets and ${T.likes} likes, it gets pinned and spawns a game round. Hot list coins are buried as diamond seams in the trench.</p><div class="hotgrid">${cards}</div>`;
  }
  if(name==="calls"){
    let rows=d.calls.slice();const f=BT.state.callerFilter;
    if(f)rows=rows.filter(c=>c.caller_id===f);
    const s=BT.state.callsSort;
    rows.sort((a,b)=>s==="ath"?(b.ath_x||0)-(a.ath_x||0):s==="cur"?(b.cur_x||0)-(a.cur_x||0):new Date(b.called_at)-new Date(a.called_at));
    const cls=m=>m==null?"":m>=9?"moon":m>=1?"up":"down";
    const fu=f&&d.callerById[f];
    return `${liveNote()}${fu?`<div class="filterchip">CALLER: ${esc(fu.x_handle)} <button data-clearfilter>✕</button></div>`:""}
    <div class="tblwrap"><table class="tbl calls"><thead><tr>
      <th data-sort="date">DATE ${s==="date"?"▼":""}</th><th>COIN</th><th>CALLED BY</th><th class="num">CALL MCAP</th><th class="num">ATH MCAP</th><th class="num" data-sort="ath">ATH ${s==="ath"?"▼":""}</th><th class="num" data-sort="cur">NOW ${s==="cur"?"▼":""}</th><th>LINKS</th>
    </tr></thead><tbody>${rows.map(c=>{const co=d.coinById[c.coin_id],u=d.callerById[c.caller_id];return `<tr>
      <td>${fmtDate(c.called_at)}</td><td><b>$${esc(co.ticker)}</b>${c.status==="pinned"?" 📌":""}</td><td>${callerLink(u)}${u&&u.telegram_handle&&u.x_handle?` <span class="sub">${tgLink(u.telegram_handle)}</span>`:""}</td>
      <td class="num">${fmtUsd(c.call_mcap_usd)}</td><td class="num">${fmtUsd(c.ath_mcap_usd)}</td>
      <td class="num"><span class="x ${cls(c.ath_x)}">${fmtX(c.ath_x)}</span></td><td class="num"><span class="x ${cls(c.cur_x)}">${fmtX(c.cur_x)}</span></td>
      <td>${c.x_post_url?`<a href="${esc(c.x_post_url)}" target="_blank" rel="noopener">X</a>`:"X —"} · ${c.telegram_msg_url?`<a href="${esc(c.telegram_msg_url)}" target="_blank" rel="noopener">TG</a>`:"TG —"}${co.dexscreener_url?` · <a href="${esc(co.dexscreener_url)}" target="_blank" rel="noopener">CHART</a>`:""}</td></tr>`}).join("")}</tbody></table></div>
    <p class="note" style="margin-top:12px">ATH = best multiple reached after the call (ATH mcap ÷ call mcap). NOW = current mcap ÷ call mcap. A call counts as a hit at ${d.meta.hit_multiple}x+.</p>`;
  }
  if(name==="callers"){
    return `${liveNote()}<div class="tblwrap"><table class="tbl callers"><thead><tr><th>#</th><th>CALLER</th><th>X</th><th>TELEGRAM</th><th class="num">CALLS</th><th>HIT %</th><th class="num">BEST</th><th class="num">LIVE TAGS</th></tr></thead><tbody>
    ${d.callerStats.map((u,i)=>`<tr><td class="rank">${i+1}</td><td><a href="#" data-caller="${esc(u.id)}">${esc(u.alias)}</a></td>
      <td>${xLink(u.x_handle)}</td>
      <td>${tgLink(u.telegram_handle)}</td>
      <td class="num">${u.calls}</td><td><span class="bar"><span style="width:${(u.hit_rate*100).toFixed(0)}%"></span></span>${(u.hit_rate*100).toFixed(0)}%</td>
      <td class="num"><span class="x ${u.best>=9?"moon":"up"}">${u.calls?fmtX(u.best):"—"}</span></td><td class="num">${u.live}</td></tr>`).join("")}
    </tbody></table></div><p class="note" style="margin-top:12px">Click a caller to see their calls. Callers are linked by the Telegram bot: tag a coin in the group and your Telegram handle is credited; send <code>/linkx @you</code> to the bot to add your X.</p>`;
  }
  if(name==="about"){
    return `<div class="steps">
      <div class="step"><span class="n dotmatrix">01</span><h3>TAG IT ON TELEGRAM</h3><p>Spot a Base meme in the trenches? Send <code>/tag 0x…</code> in the Telegram group. The first tagger is credited as the caller.</p></div>
      <div class="step"><span class="n dotmatrix">09</span><h3>9 TAGS = POWERED UP</h3><p>When 9 different members tag the same coin, it powers up and goes on the HOT LIST.</p></div>
      <div class="step"><span class="n dotmatrix">X</span><h3>BULL POST ON X</h3><p>The X account posts the meme. The trench rallies behind it.</p></div>
      <div class="step"><span class="n dotmatrix">589</span><h3>5 · 8 · 9 = PINNED</h3><p>5 comments, 8 retweets, 9 likes and it's pinned, plus a game round gets dug for it.</p></div>
    </div>
    <div class="thr"><div><b>9</b>TAGS</div><div><b>5</b>COMMENTS</div><div><b>8</b>RETWEETS</div><div><b>9</b>LIKES</div></div>
    <p>We're an anonymous meme crew from the Base trenches. One life, it's worth an attempt. Keep digging; the diamonds are just ahead. Every call gets logged on this site with who called it and how it ran, so you can see who's actually got it.</p>
    <div class="links"><a href="${esc(d.links.x)}" target="_blank" rel="noopener">FOLLOW ON X ↗</a><a href="${esc(d.links.telegram)}" target="_blank" rel="noopener">TELEGRAM CHANNEL ↗</a><a href="${esc(d.links.telegram_group||d.links.telegram)}" target="_blank" rel="noopener">JOIN THE VOTE GROUP ↗</a><a href="https://t.me/Powerof9BaseBot" target="_blank" rel="noopener">@POWEROF9BASEBOT ↗</a><a class="ghost" href="#play" data-nav="play">⛏ PLAY</a></div>
    <p class="fine">X: @PowerOf9Base · Telegram: @powerof9base. Nothing on this site is financial advice. Memes are volatile; most go to zero. Never risk more than you can lose.</p>`;
  }
  return "";
};
BT.tickerHTML=function(){
  const d=BT.data;if(!d)return "";
  const hot=BT.hot().map(h=>`<span>$${esc(h.coin.ticker)} <em>${h.status==="pinned"?"PINNED":h.status==="powered"?"POWERED":h.tagN+"/9 TAGS"}</em></span>`).join("");
  const best=d.calls.slice().sort((a,b)=>(b.ath_x||0)-(a.ath_x||0)).slice(0,4).map(c=>`<span>$${esc(d.coinById[c.coin_id].ticker)} ATH <em>${fmtX(c.ath_x)}</em> by ${esc(handle(d.callerById[c.caller_id]))}</span>`).join("");
  return `<span><em>${d.meta.live?"● LIVE":"EXAMPLE DATA"}</em></span><span>POWER OF 9</span>${hot}<span>MANIFESTING 589x</span>${best}`;
};
BT.fmtX=fmtX;
window.BT=BT;
})();
