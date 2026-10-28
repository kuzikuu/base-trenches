// Data layer: loads data/calls.json (the single source of truth) and renders panels.
(function(){
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtUsd=n=>n==null?"—":n>=1e9?"$"+(n/1e9).toFixed(2)+"B":n>=1e6?"$"+(n/1e6).toFixed(2)+"M":n>=1e3?"$"+(n/1e3).toFixed(1)+"K":"$"+n.toFixed(0);
const fmtX=m=>m==null?"—":m>=100?m.toFixed(0)+"x":m>=10?m.toFixed(1)+"x":m.toFixed(2)+"x";
const fmtDate=s=>s?new Date(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:innerWidth<560?undefined:"numeric",timeZone:"UTC"}).toUpperCase():"—";
const xUrl=h=>"https://x.com/"+encodeURIComponent(String(h).replace(/^@/,""));
const tgUrl=h=>"https://t.me/"+encodeURIComponent(String(h).replace(/^@/,""));

const BT={data:null,state:{callsSort:"date",callerFilter:null}};
BT.load=async function(){
  const r=await fetch("data/calls.json",{cache:"no-store"});
  const d=await r.json();
  d.coinById=Object.fromEntries(d.coins.map(c=>[c.id,c]));
  d.callerById=Object.fromEntries(d.callers.map(c=>[c.id,c]));
  const hitX=d.meta.hit_multiple||2;
  d.calls.forEach(c=>{c.ath_x=c.ath_mcap_usd/c.call_mcap_usd;c.cur_x=c.current_mcap_usd/c.call_mcap_usd;c.hit=c.ath_x>=hitX});
  d.callerStats=d.callers.map(u=>{
    const cs=d.calls.filter(c=>c.caller_id===u.id);
    const hits=cs.filter(c=>c.hit).length;
    const best=cs.reduce((a,c)=>Math.max(a,c.ath_x),0);
    const live=d.watchlist.filter(w=>w.caller_id===u.id).length;
    return {...u,calls:cs.length,hits,hit_rate:cs.length?hits/cs.length:0,best,live,score:best*Math.max(.1,cs.length?hits/cs.length:0)};
  }).sort((a,b)=>b.best-a.best||b.hit_rate-a.hit_rate);
  BT.data=d;return d;
};
BT.hot=function(){
  const d=BT.data,T=d.meta.thresholds;
  const order={pinned:0,powered:1,tagging:2};
  return d.watchlist.map(w=>{
    const c=d.coinById[w.coin_id]||{ticker:"?",name:"?"};const p=w.x_post||{};
    const prog=Math.min(1,w.tags.length/T.tags)*.5+(p.comments!=null?(Math.min(1,p.comments/T.comments)+Math.min(1,p.retweets/T.retweets)+Math.min(1,p.likes/T.likes))/6:0);
    return {...w,coin:c,caller:d.callerById[w.caller_id],tagN:w.tags.length,com:p.comments||0,rt:p.retweets||0,lk:p.likes||0,prog};
  }).sort((a,b)=>order[a.status]-order[b.status]||b.prog-a.prog);
};
function meter(label,n,max){
  let sq="";for(let i=0;i<max;i++)sq+=`<i class="${i<n?"on":""}"></i>`;
  return `<div class="meter"><label>${label}</label><span class="sq ${n>=max?"full":""}">${sq}</span><output>${Math.min(n,max)}/${max}</output></div>`;
}
const exampleNote=`<p class="note"><b>EXAMPLE DATA</b> Every ticker, contract, number and handle below is fake placeholder data for this prototype, not real coins or real people. Not financial advice.</p>`;
const callerLink=u=>u?`<a href="#" data-caller="${esc(u.id)}">${esc(u.x_handle)}</a>`:"—";

BT.render=function(name){
  const d=BT.data;if(!d)return `<p>Loading…</p>`;
  const T=d.meta.thresholds;
  if(name==="hot"){
    const cards=BT.hot().map(h=>`
      <div class="card ${h.status}">
        <span class="st ${h.status}">${h.status==="pinned"?"📌 PINNED":h.status==="powered"?"⚡ POWERED UP":"TAGGING"}</span>
        <div class="tk">$${esc(h.coin.ticker)}</div>
        <div class="nm">${esc(h.coin.name)} · BASE</div>
        ${meter("TAGS",h.tagN,T.tags)}
        ${meter("COMMENTS",h.com,T.comments)}
        ${meter("RETWEETS",h.rt,T.retweets)}
        ${meter("LIKES",h.lk,T.likes)}
        <div class="by">First tag: ${callerLink(h.caller)} · TG ${esc(h.caller?.telegram_handle||"—")}</div>
        <div class="acts2">${h.x_post?`<a href="${esc(h.x_post.url)}" target="_blank" rel="noopener">X POST ↗</a>`:""}<a href="#" data-play="${esc(h.coin.ticker)}">⛏ DIG FOR IT</a>${h.game_round?`<span class="x moon">GAME ROUND LIVE</span>`:""}</div>
      </div>`).join("");
    return `${exampleNote}<p class="note">9 tags on Telegram powers a coin up. When its X post hits ${T.comments} comments, ${T.retweets} retweets and ${T.likes} likes, it gets pinned and spawns a game round. Hot list coins are buried as diamond seams in the trench.</p><div class="hotgrid">${cards}</div>`;
  }
  if(name==="calls"){
    let rows=d.calls.slice();const f=BT.state.callerFilter;
    if(f)rows=rows.filter(c=>c.caller_id===f);
    const s=BT.state.callsSort;
    rows.sort((a,b)=>s==="ath"?b.ath_x-a.ath_x:s==="cur"?b.cur_x-a.cur_x:new Date(b.called_at)-new Date(a.called_at));
    const cls=m=>m>=9?"moon":m>=1?"up":"down";
    const fu=f&&d.callerById[f];
    return `${exampleNote}${fu?`<div class="filterchip">CALLER: ${esc(fu.x_handle)} <button data-clearfilter>✕</button></div>`:""}
    <div class="tblwrap"><table class="tbl calls"><thead><tr>
      <th data-sort="date">DATE ${s==="date"?"▼":""}</th><th>COIN</th><th>CALLED BY</th><th class="num">CALL MCAP</th><th class="num">ATH MCAP</th><th class="num" data-sort="ath">ATH ${s==="ath"?"▼":""}</th><th class="num" data-sort="cur">NOW ${s==="cur"?"▼":""}</th><th>LINKS</th>
    </tr></thead><tbody>${rows.map(c=>{const co=d.coinById[c.coin_id],u=d.callerById[c.caller_id];return `<tr>
      <td>${fmtDate(c.called_at)}</td><td><b>$${esc(co.ticker)}</b></td><td>${callerLink(u)}</td>
      <td class="num">${fmtUsd(c.call_mcap_usd)}</td><td class="num">${fmtUsd(c.ath_mcap_usd)}</td>
      <td class="num"><span class="x ${cls(c.ath_x)}">${fmtX(c.ath_x)}</span></td><td class="num"><span class="x ${cls(c.cur_x)}">${fmtX(c.cur_x)}</span></td>
      <td><a href="${esc(c.x_post_url)}" target="_blank" rel="noopener">X</a> · <a href="${esc(c.telegram_msg_url)}" target="_blank" rel="noopener">TG</a></td></tr>`}).join("")}</tbody></table></div>
    <p class="note" style="margin-top:12px">ATH = best multiple reached after the call (ATH mcap ÷ call mcap). NOW = current mcap ÷ call mcap. A call counts as a hit at ${d.meta.hit_multiple}x+.</p>`;
  }
  if(name==="callers"){
    return `${exampleNote}<div class="tblwrap"><table class="tbl callers"><thead><tr><th>#</th><th>CALLER</th><th>X</th><th>TELEGRAM</th><th class="num">CALLS</th><th>HIT %</th><th class="num">BEST</th><th class="num">LIVE TAGS</th></tr></thead><tbody>
    ${d.callerStats.map((u,i)=>`<tr><td class="rank">${i+1}</td><td><a href="#" data-caller="${esc(u.id)}">${esc(u.alias)}</a></td>
      <td><a href="${xUrl(u.x_handle)}" target="_blank" rel="noopener">${esc(u.x_handle)}</a></td>
      <td><a href="${tgUrl(u.telegram_handle)}" target="_blank" rel="noopener">${esc(u.telegram_handle)}</a></td>
      <td class="num">${u.calls}</td><td><span class="bar"><span style="width:${(u.hit_rate*100).toFixed(0)}%"></span></span>${(u.hit_rate*100).toFixed(0)}%</td>
      <td class="num"><span class="x ${u.best>=9?"moon":"up"}">${u.calls?fmtX(u.best):"—"}</span></td><td class="num">${u.live}</td></tr>`).join("")}
    </tbody></table></div><p class="note" style="margin-top:12px">Click a caller to see their calls. Callers are linked by the Telegram bot: tag a coin in the group, and your X + Telegram handles get credited.</p>`;
  }
  if(name==="about"){
    return `<div class="steps">
      <div class="step"><span class="n dotmatrix">01</span><h3>TAG IT ON TELEGRAM</h3><p>Spot a Base meme in the trenches? Tag it in the group with the bot. Your handle is credited as the caller.</p></div>
      <div class="step"><span class="n dotmatrix">09</span><h3>9 TAGS = POWERED UP</h3><p>When 9 different members tag the same coin, it powers up and goes on the HOT LIST.</p></div>
      <div class="step"><span class="n dotmatrix">X</span><h3>BULL POST ON X</h3><p>The X account posts the meme. The trench rallies behind it.</p></div>
      <div class="step"><span class="n dotmatrix">589</span><h3>5 · 8 · 9 = PINNED</h3><p>5 comments, 8 retweets, 9 likes and it's pinned, plus a game round gets dug for it.</p></div>
    </div>
    <div class="thr"><div><b>9</b>TAGS</div><div><b>5</b>COMMENTS</div><div><b>8</b>RETWEETS</div><div><b>9</b>LIKES</div></div>
    <p>We're an anonymous meme crew from the Base trenches. One life, it's worth an attempt. Keep digging; the diamonds are just ahead. Every call gets logged on this site with who called it and how it ran, so you can see who's actually got it.</p>
    <div class="links"><a href="${esc(d.links.x)}" target="_blank" rel="noopener">FOLLOW ON X ↗</a><a href="${esc(d.links.telegram)}" target="_blank" rel="noopener">JOIN THE TELEGRAM ↗</a><a class="ghost" href="#play" data-nav="play">⛏ PLAY</a></div>
    <p class="fine">Links are placeholders until the accounts go live. Nothing on this site is financial advice. Memes are volatile; most go to zero. Never risk more than you can lose.</p>`;
  }
  return "";
};
BT.tickerHTML=function(){
  const d=BT.data;if(!d)return "";
  const hot=BT.hot().map(h=>`<span>$${esc(h.coin.ticker)} <em>${h.status==="pinned"?"PINNED":h.status==="powered"?"POWERED":h.tagN+"/9 TAGS"}</em></span>`).join("");
  const best=d.calls.slice().sort((a,b)=>b.ath_x-a.ath_x).slice(0,4).map(c=>`<span>$${esc(d.coinById[c.coin_id].ticker)} ATH <em>${fmtX(c.ath_x)}</em> by ${esc(d.callerById[c.caller_id].x_handle)}</span>`).join("");
  return `<span><em>EXAMPLE DATA</em></span><span>POWER OF 9</span>${hot}<span>MANIFESTING 589x</span>${best}`;
};
BT.fmtX=fmtX;
window.BT=BT;
})();
