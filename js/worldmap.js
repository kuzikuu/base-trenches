// World map: dot-matrix globe-at-a-glance of who is in the trench right now.
// Counts come from /presence: humans only, aggregated by country / continent from
// Cloudflare's coarse request.cf data at connect time. No IPs, no cities, no per-player
// location. Recruit bots are listed separately and never placed on the map.
(function(){
"use strict";
// 120x50 equirectangular land mask (lat 83..-57) rasterised from Natural Earth 110m land
// (public domain), plus country centroids. One hex string per row, 1 bit per cell.
const WD={"W":120,"H":50,"lat0":83,"lat1":-57,"rows":["0000000bfffffe0000000010000000","0000000ffffffc00d000001c000000","00000f1fc7fff8000001203fc03800","00003ebb807ff800000211fffe1000","03f8d7d9f83ff0001e023fffffff86","87ffffff9e3fc0007f9fffffffffff","6fffffff9e3e0e00ff7fffffffffff","07fffff8301c0003dfffffffffffff","0387fff83e000003cffffffffffe60","0300fffe3f0000319fffffffffc0c0","00007fffbf800053ffffffffffe080","00007fffff80003ffffffffffff000","00003ffffe40001fffffffffffe000","00003ffffe00001ffdf7ffffffc000","00003ffff8000078fd37ffffff3000","00001fffe000007017fbfffff62000","00001fffe000006e97fffffff22000","00000fffc000007f00fffffff1c000","000007ff8000007ffffffffff80000","000003f0800000fffff7fffff80000","000002f0000001fffff9fffff00000","00000070400003ffff7f1fffe80000","00000072200003fffffe0f9e800000","0000003e000003ffffbe0f1f080000","00000007000003fffff8060f880000","00000001180001ffffe80603000000","000000003f0001fffff80200040000","000000003fc000fffff00004000000","000000003fe00001fff0000e600000","000000007ff00001ffc00004e00000","000000007ffe0001ffc0000268e000","000000007fff0000ff800000007a00","000000007fff8000ff800000883800","000000003fff0000ffc00000000000","000000003ffe0000ffc00000019000","000000001ffe0000ff98000007d800","000000000ffe0000ff1800000ff800","000000000ffc00007f3000003ffc00","000000000ff000007f1000003ffe00","000000000ff000007e0000003ffe00","000000000fe000003c0000003ffe00","000000000fc00000380000003c7e00","000000000f80000000000000003c00","000000001f80000000000000001002","000000001e00000000000000000c04","000000001c00000000000000000008","000000001c00000000000000000000","000000001800000000000000000000","000000001800000000000000000000","000000000c00000000000000000000"],"cc":{"AD":[42.5,1.6],"AE":[23.4,53.8],"AF":[33.9,67.7],"AG":[17.1,-61.8],"AI":[18.2,-63.1],"AL":[41.2,20.2],"AM":[40.1,45.0],"AN":[12.2,-69.1],"AO":[-11.2,17.9],"AQ":[-75.3,-0.1],"AR":[-38.4,-63.6],"AS":[-14.3,-170.1],"AT":[47.5,14.6],"AU":[-25.3,133.8],"AW":[12.5,-70.0],"AZ":[40.1,47.6],"BA":[43.9,17.7],"BB":[13.2,-59.5],"BD":[23.7,90.4],"BE":[50.5,4.5],"BF":[12.2,-1.6],"BG":[42.7,25.5],"BH":[25.9,50.6],"BI":[-3.4,29.9],"BJ":[9.3,2.3],"BM":[32.3,-64.8],"BN":[4.5,114.7],"BO":[-16.3,-63.6],"BR":[-14.2,-51.9],"BS":[25.0,-77.4],"BT":[27.5,90.4],"BV":[-54.4,3.4],"BW":[-22.3,24.7],"BY":[53.7,28.0],"BZ":[17.2,-88.5],"CA":[56.1,-106.3],"CC":[-12.2,96.9],"CD":[-4.0,21.8],"CF":[6.6,20.9],"CG":[-0.2,15.8],"CH":[46.8,8.2],"CI":[7.5,-5.5],"CK":[-21.2,-159.8],"CL":[-35.7,-71.5],"CM":[7.4,12.4],"CN":[35.9,104.2],"CO":[4.6,-74.3],"CR":[9.7,-83.8],"CU":[21.5,-77.8],"CV":[16.0,-24.0],"CX":[-10.4,105.7],"CY":[35.1,33.4],"CZ":[49.8,15.5],"DE":[51.2,10.5],"DJ":[11.8,42.6],"DK":[56.3,9.5],"DM":[15.4,-61.4],"DO":[18.7,-70.2],"DZ":[28.0,1.7],"EC":[-1.8,-78.2],"EE":[58.6,25.0],"EG":[26.8,30.8],"EH":[24.2,-12.9],"ER":[15.2,39.8],"ES":[40.5,-3.7],"ET":[9.1,40.5],"FI":[61.9,25.7],"FJ":[-16.6,179.4],"FK":[-51.8,-59.5],"FM":[7.4,150.6],"FO":[61.9,-6.9],"FR":[46.2,2.2],"GA":[-0.8,11.6],"GB":[55.4,-3.4],"GD":[12.3,-61.6],"GE":[42.3,43.4],"GF":[3.9,-53.1],"GG":[49.5,-2.6],"GH":[7.9,-1.0],"GI":[36.1,-5.3],"GL":[71.7,-42.6],"GM":[13.4,-15.3],"GN":[9.9,-9.7],"GP":[17.0,-62.1],"GQ":[1.7,10.3],"GR":[39.1,21.8],"GS":[-54.4,-36.6],"GT":[15.8,-90.2],"GU":[13.4,144.8],"GW":[11.8,-15.2],"GY":[4.9,-58.9],"GZ":[31.4,34.3],"HK":[22.4,114.1],"HM":[-53.1,73.5],"HN":[15.2,-86.2],"HR":[45.1,15.2],"HT":[19.0,-72.3],"HU":[47.2,19.5],"ID":[-0.8,113.9],"IE":[53.4,-8.2],"IL":[31.0,34.9],"IM":[54.2,-4.5],"IN":[20.6,79.0],"IO":[-6.3,71.9],"IQ":[33.2,43.7],"IR":[32.4,53.7],"IS":[65.0,-19.0],"IT":[41.9,12.6],"JE":[49.2,-2.1],"JM":[18.1,-77.3],"JO":[30.6,36.2],"JP":[36.2,138.3],"KE":[-0.0,37.9],"KG":[41.2,74.8],"KH":[12.6,105.0],"KI":[-3.4,-168.7],"KM":[-11.9,43.9],"KN":[17.4,-62.8],"KP":[40.3,127.5],"KR":[35.9,127.8],"KW":[29.3,47.5],"KY":[19.5,-80.6],"KZ":[48.0,66.9],"LA":[19.9,102.5],"LB":[33.9,35.9],"LC":[13.9,-61.0],"LI":[47.2,9.6],"LK":[7.9,80.8],"LR":[6.4,-9.4],"LS":[-29.6,28.2],"LT":[55.2,23.9],"LU":[49.8,6.1],"LV":[56.9,24.6],"LY":[26.3,17.2],"MA":[31.8,-7.1],"MC":[43.8,7.4],"MD":[47.4,28.4],"ME":[42.7,19.4],"MG":[-18.8,46.9],"MH":[7.1,171.2],"MK":[41.6,21.7],"ML":[17.6,-4.0],"MM":[21.9,96.0],"MN":[46.9,103.8],"MO":[22.2,113.5],"MP":[17.3,145.4],"MQ":[14.6,-61.0],"MR":[21.0,-10.9],"MS":[16.7,-62.2],"MT":[35.9,14.4],"MU":[-20.3,57.6],"MV":[3.2,73.2],"MW":[-13.3,34.3],"MX":[23.6,-102.6],"MY":[4.2,102.0],"MZ":[-18.7,35.5],"NA":[-23.0,18.5],"NC":[-20.9,165.6],"NE":[17.6,8.1],"NF":[-29.0,168.0],"NG":[9.1,8.7],"NI":[12.9,-85.2],"NL":[52.1,5.3],"NO":[60.5,8.5],"NP":[28.4,84.1],"NR":[-0.5,166.9],"NU":[-19.1,-169.9],"NZ":[-40.9,174.9],"OM":[21.5,55.9],"PA":[8.5,-80.8],"PE":[-9.2,-75.0],"PF":[-17.7,-149.4],"PG":[-6.3,144.0],"PH":[12.9,121.8],"PK":[30.4,69.3],"PL":[51.9,19.1],"PM":[46.9,-56.3],"PN":[-24.7,-127.4],"PR":[18.2,-66.6],"PS":[32.0,35.2],"PT":[39.4,-8.2],"PW":[7.5,134.6],"PY":[-23.4,-58.4],"QA":[25.4,51.2],"RE":[-21.1,55.5],"RO":[45.9,25.0],"RS":[44.0,21.0],"RU":[61.5,105.3],"RW":[-1.9,29.9],"SA":[23.9,45.1],"SB":[-9.6,160.2],"SC":[-4.7,55.5],"SD":[12.9,30.2],"SE":[60.1,18.6],"SG":[1.4,103.8],"SH":[-24.1,-10.0],"SI":[46.2,15.0],"SJ":[77.6,23.7],"SK":[48.7,19.7],"SL":[8.5,-11.8],"SM":[43.9,12.5],"SN":[14.5,-14.5],"SO":[5.2,46.2],"SR":[3.9,-56.0],"ST":[0.2,6.6],"SV":[13.8,-88.9],"SY":[34.8,39.0],"SZ":[-26.5,31.5],"TC":[21.7,-71.8],"TD":[15.5,18.7],"TF":[-49.3,69.3],"TG":[8.6,0.8],"TH":[15.9,101.0],"TJ":[38.9,71.3],"TK":[-9.0,-171.9],"TL":[-8.9,125.7],"TM":[39.0,59.6],"TN":[33.9,9.5],"TO":[-21.2,-175.2],"TR":[39.0,35.2],"TT":[10.7,-61.2],"TV":[-7.1,177.6],"TW":[23.7,121.0],"TZ":[-6.4,34.9],"UA":[48.4,31.2],"UG":[1.4,32.3],"US":[37.1,-95.7],"UY":[-32.5,-55.8],"UZ":[41.4,64.6],"VA":[41.9,12.5],"VC":[13.0,-61.3],"VE":[6.4,-66.6],"VG":[18.4,-64.6],"VI":[18.3,-64.9],"VN":[14.1,108.3],"VU":[-15.4,167.0],"WF":[-13.8,-177.2],"WS":[-13.8,-172.1],"XK":[42.6,20.9],"YE":[15.6,48.5],"YT":[-12.8,45.2],"ZA":[-30.6,22.9],"ZM":[-13.1,27.8],"ZW":[-19.0,29.2]}};
const CONT={NA:["NORTH AMERICA",45,-100],SA:["SOUTH AMERICA",-15,-60],EU:["EUROPE",50,12],AF:["AFRICA",5,20],AS:["ASIA",35,95],OC:["OCEANIA",-25,135],AN:["ANTARCTICA",-75,0]};
const BLUE="#0052ff",PALE="#c9d6ff",PINK="#ff2bd6",INK="#0b1a8f";
const CELL=6;
let land=null,state={presence:null,squads:null,err:null,at:0},raf=0,pollT=0,canvas=null,openNow=false;

function mask(){
  if(land)return land;
  land=WD.rows.map(h=>{const bits=[];for(const ch of h){const v=parseInt(ch,16);for(let i=3;i>=0;i--)bits.push((v>>i)&1)}return bits.slice(0,WD.W)});
  return land;
}
function proj(lat,lon){return[Math.max(0,Math.min(WD.W-1,Math.floor((lon+180)/360*WD.W))),Math.max(0,Math.min(WD.H-1,Math.floor((WD.lat0-lat)/(WD.lat0-WD.lat1)*WD.H)))]}
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const base=()=>String((window.BT_CONFIG&&BT_CONFIG.serverUrl)||"").replace(/\/$/,"");

function markers(p){
  const out=[];if(!p)return out;
  for(const [cc,n] of Object.entries(p.countries||{})){
    const c=WD.cc[cc];if(c)out.push({cc,n,xy:proj(c[0],c[1])});
  }
  // No country we can pin: fall back to one marker per continent centre.
  if(!out.length)for(const [k,n] of Object.entries(p.regions||{})){const c=CONT[k];if(c)out.push({cc:k,n,xy:proj(c[1],c[2])})}
  return out;
}

function draw(t){
  if(!canvas||!canvas.isConnected){raf=0;return}
  const g=canvas.getContext("2d"),m=mask(),W=WD.W,H=WD.H;
  g.fillStyle="#fff";g.fillRect(0,0,canvas.width,canvas.height);
  // ocean: sparse ordered-dither dots; land: dot-matrix squares
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    if(m[y][x]){g.fillStyle=PALE;g.fillRect(x*CELL+1,y*CELL+1,CELL-2,CELL-2)}
    else if(((x+y*3)&3)===0){g.fillStyle="#e4ebff";g.fillRect(x*CELL+2,y*CELL+2,2,2)}
  }
  // graticule ticks every 30 degrees
  g.fillStyle="#d7e1ff";
  for(let lon=-150;lon<180;lon+=30){const [x]=proj(0,lon);for(let y=0;y<H;y+=2)g.fillRect(x*CELL+CELL/2,y*CELL+CELL/2,1,1)}
  const [,eq]=proj(0,0);for(let x=0;x<W;x+=2)g.fillRect(x*CELL+CELL/2,eq*CELL+CELL/2,1,1);
  const ms=markers(state.presence);
  const pulse=(Math.sin((t||0)/260)+1)/2;
  for(const mk of ms){
    const [cx,cy]=mk.xy,r=Math.min(4,1+Math.ceil(Math.log2(mk.n+1)));
    // pulsing pink ring (stepped, pixel style)
    const rr=r+1+Math.round(pulse*2);
    g.fillStyle=PINK;
    for(let dy=-rr;dy<=rr;dy++)for(let dx=-rr;dx<=rr;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy));if(d===rr&&((dx+dy)&1)===0)g.fillRect((cx+dx)*CELL+1,(cy+dy)*CELL+1,CELL-2,CELL-2)}
    g.fillStyle=BLUE;
    for(let dy=-r+1;dy<r;dy++)for(let dx=-r+1;dx<r;dx++)if(Math.abs(dx)+Math.abs(dy)<r)g.fillRect((cx+dx)*CELL,(cy+dy)*CELL,CELL,CELL);
    // count label
    const label=String(mk.n);g.font="bold 11px monospace";const tw=g.measureText(label).width+6;
    const lx=Math.min(canvas.width-tw-1,(cx+r+1)*CELL),ly=Math.max(1,(cy-r)*CELL-4);
    g.fillStyle=BLUE;g.fillRect(lx,ly,tw,13);g.fillStyle="#fff";g.fillText(label,lx+3,ly+10);
  }
  raf=openNow?requestAnimationFrame(draw):0;
}

function statsHtml(){
  const p=state.presence;
  if(!p)return state.err?`<p class="note">World map is offline: ${esc(state.err)}</p>`:'<p class="note">Locating trenchers…</p>';
  const online=p.online||0,recruits=(typeof Multiplayer!=="undefined"&&Multiplayer.connected?Multiplayer.recruitCount:0)||p.recruits||0;
  const regions=Object.entries(p.regions||{}).sort((a,b)=>b[1]-a[1]);
  const countries=Object.entries(p.countries||{}).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const ev=typeof BTEvents!=="undefined"&&BTEvents.getCache?BTEvents.getCache():null;
  const live=ev&&Array.isArray(ev.live)?ev.live:[];
  const next=ev&&Array.isArray(ev.upcoming)?ev.upcoming.slice().sort((a,b)=>a.start_at-b.start_at)[0]:null;
  const sq=state.squads&&Array.isArray(state.squads.squads||state.squads.leaderboard)?(state.squads.squads||state.squads.leaderboard).slice(0,3):[];
  return `
  <div class="world-stats">
    <div class="world-big"><b>${online}</b><span>TRENCHER${online===1?"":"S"} ONLINE</span></div>
    ${recruits?`<div class="world-big bots"><b>+${recruits}</b><span>RECRUIT BOTS<br><em>not counted, not on the map</em></span></div>`:""}
    <div class="world-big"><b>${regions.length}</b><span>REGION${regions.length===1?"":"S"} ACTIVE</span></div>
  </div>
  <div class="world-cols">
    <div><h3 class="dotmatrix">BY REGION</h3><ul class="world-list">${regions.map(([k,n])=>`<li><span>${esc((CONT[k]||[k])[0])}</span><b>${n}</b></li>`).join("")||'<li><span>Nobody yet. Be the first.</span></li>'}</ul></div>
    <div><h3 class="dotmatrix">TOP COUNTRIES</h3><ul class="world-list">${countries.map(([c,n])=>`<li><span>${esc(c)}</span><b>${n}</b></li>`).join("")||'<li><span>—</span></li>'}</ul></div>
    <div><h3 class="dotmatrix">SECTORS</h3><ul class="world-list">${(Array.isArray(p.sectors)&&p.sectors.length?p.sectors:[{name:"main",online}]).map((s,i)=>({s,i})).filter(o=>o.i===0||o.s.online>0).map(({s,i})=>`<li${typeof Multiplayer!=="undefined"&&Multiplayer.sector===s.name?' class="mine"':""}><span>SECTOR ${i+1}${typeof Multiplayer!=="undefined"&&Multiplayer.sector===s.name?" (YOU)":""}</span><b>${s.online}</b></li>`).join("")}</ul></div>
    <div><h3 class="dotmatrix">TOP SQUADS</h3><ul class="world-list">${sq.length?"":"<li><span>No squads yet</span><b></b></li>"}${sq.map(s=>`<li><span>${esc(s.name||s.code)}</span><b>${esc(s.members!=null?s.members:(s.memberCount!=null?s.memberCount:""))}</b></li>`).join("")}</ul></div>
    <div><h3 class="dotmatrix">LIVE EVENTS</h3><ul class="world-list">${live.map(e=>`<li class="live"><span>● ${esc(e.title)}</span><b>LIVE</b></li>`).join("")||(next?`<li><span>NEXT: ${esc(next.title)}</span><b>${esc(new Date(next.start_at).toLocaleString([], {weekday:"short",hour:"2-digit",minute:"2-digit"}))}</b></li>`:'<li><span>No events scheduled</span></li>')}</ul></div>
  </div>
  <p class="note world-privacy">Counts by country from Cloudflare at connect time. No IPs, cities or exact locations are stored or shown. Updated ${esc(new Date(state.at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}))}.</p>`;
}

function render(){
  return `<div class="worldmap" id="worldMap">
    <div class="world-canvas-wrap"><canvas id="worldCanvas" width="${WD.W*CELL}" height="${WD.H*CELL}" aria-label="World map of trenchers online"></canvas></div>
    <div id="worldStats">${statsHtml()}</div>
  </div>`;
}

async function refresh(){
  try{
    const [p,s]=await Promise.all([
      fetch(base()+"/presence",{cache:"no-store"}).then(r=>r.json()),
      state.squads?Promise.resolve(state.squads):fetch(base()+"/api/squads/leaderboard",{cache:"no-store"}).then(r=>r.json()).catch(()=>null)
    ]);
    state.presence=p;state.squads=s;state.err=null;state.at=Date.now();
  }catch(e){state.err="presence unavailable"}
  if(typeof BTEvents!=="undefined"&&BTEvents.load){const c=BTEvents.getCache();if(!c||(!c.live.length&&!c.upcoming.length&&!c.loadedForMap)){await BTEvents.load().catch(()=>{});const c2=BTEvents.getCache();if(c2)c2.loadedForMap=true}}
  const el=document.getElementById("worldStats");if(el)el.innerHTML=statsHtml();
}

function mount(){
  canvas=document.getElementById("worldCanvas");openNow=true;
  if(!raf)raf=requestAnimationFrame(draw);
  refresh();clearInterval(pollT);pollT=setInterval(()=>{if(!document.getElementById("worldCanvas")){unmount();return}refresh()},10000);
}
function unmount(){openNow=false;clearInterval(pollT);pollT=0;if(raf)cancelAnimationFrame(raf);raf=0;canvas=null}

window.WorldMap={render,mount,unmount,refresh,_state:state,_proj:proj};
})();
