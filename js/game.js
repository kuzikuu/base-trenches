// BASE TRENCHES: trench-digging, bullet-dodging canvas game.
(function(){
"use strict";
const TS=12, W=40, S=12;               // tile size, world width (tiles), trench top row
const FLOOR=S+2;                        // duckboard row
const T={AIR:0,DUG:1,DIRT:2,CLAY:3,ROCK:4,BED:5,GEM:6,POWER:7,BOULDER:8,UXB:9,TRENCH:11,TIMBER:12,GATE:13};
const HP={2:1,3:2,4:4,6:1,7:2,8:3,9:1,12:2,13:6};
const SOLID=new Set([T.DIRT,T.CLAY,T.ROCK,T.BED,T.GEM,T.POWER,T.BOULDER,T.UXB,T.TIMBER,T.GATE]);
// ---------- endless levels (js/levels.js, shared with the server) ----------
const LV=window.BTLevels||null;
const LDEPTH=LV?LV.LEVEL_DEPTH_M:589;
let levelsOn=false;                      // config switch: off = classic endless level 1
const levelOfDepth=d=>levelsOn&&LV?LV.levelForDepth(d,true):1;
const levelOfRow=y=>levelOfDepth(Math.max(0,y-FLOOR));
const diffCache={};
const DIFF=L=>diffCache[L]||(diffCache[L]=LV?LV.difficulty(L):{hardness:1,hazard:1,fire:1,bulletSpeed:1,extraBullets:0,blastDamage:2,blastRadius:2.3,enemyHp:0,enemyDamage:0,enemyCount:0,enemySpeed:0});
function hpFor(t,y){const b=HP[t]||0;if(!b)return 0;const L=levelOfRow(y);return L>1&&LV?LV.tileHp(b,L):b}
// ---------- skills (js/skills.js) ----------
const NOFX={digSpeed:1,softDouble:false,oneShot:0,melee:1,parry:0,fortifyCooldown:0,fortifyHp:0,blastReduce:0,reveal:0,warnBonus:0,compass:false,regenEvery:0,secondWind:false};
let fx=NOFX;
const BLUE="#0052ff",BLUE2="#0a2fd1",INK="#0b1a8f",PALE="#c9d6ff",BROWN="#8a5a2b",TAN="#c9a27a";
const SPK=["#22e36b","#ffd400","#ff2bd6","#16e0ff"];
const BAY=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(v=>(v+.5)/16);
const bay=(x,y)=>BAY[(y&3)*4+(x&3)];
const GEM_X=1.05, POWER_X=1.25, DEPTH_X=1.09, GOAL=589;

// ---------- seeded rng + value noise ----------
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hash2(x,y,s){let h=(x*374761393+y*668265263+s*1442695041)|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296}
function vnoise(x,y,s){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash2(xi,yi,s),b=hash2(xi+1,yi,s),c=hash2(xi,yi+1,s),d=hash2(xi+1,yi+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}

// ---------- textures ----------
const tex={};
function mk(fn){const c=document.createElement("canvas");c.width=TS;c.height=TS;const g=c.getContext("2d");fn(g);return c}
function px(g,x,y,c){g.fillStyle=c;g.fillRect(x,y,1,1)}
function buildTextures(){
  const dirt=(dens,brown,v)=>mk(g=>{g.fillStyle="#fff";g.fillRect(0,0,TS,TS);
    for(let y=0;y<TS;y++)for(let x=0;x<TS;x++){const h=hash2(x+v*31,y,7);
      if(bay(x,y)<dens+(h-.5)*.05)px(g,x,y,BLUE);else if(h<brown)px(g,x,y,BROWN);}});
  tex.dirt=[0,1,2,3].map(v=>[dirt(.15,.05,v),dirt(.25,.035,v),dirt(.37,.02,v)]);
  tex.clay=[0,1,2,3].map(v=>mk(g=>{g.fillStyle="#fff";g.fillRect(0,0,TS,TS);
    for(let y=0;y<TS;y++)for(let x=0;x<TS;x++){const band=((y+v)%4<2)?.75:.35;if(bay(x,y)<band)px(g,x,y,BLUE);else if(hash2(x,y,v+40)<.05)px(g,x,y,BROWN)}}));
  tex.rock=[0,1,2,3].map(v=>mk(g=>{g.fillStyle=BLUE;g.fillRect(0,0,TS,TS);
    for(let y=0;y<TS;y++)for(let x=0;x<TS;x++){if(x%2===1&&bay(x,y)<.35)px(g,x,y,"#fff");}
    g.fillStyle="#fff";g.fillRect(2+v,2,3,1);g.fillRect(2+v,3,1,1);
    g.fillStyle=INK;g.fillRect(0,TS-1,TS,1);g.fillRect(TS-1,0,1,TS)}));
  tex.bed=[mk(g=>{g.fillStyle=BLUE2;g.fillRect(0,0,TS,TS);for(let y=0;y<TS;y++)for(let x=0;x<TS;x++)if(x%2===0&&bay(x,y)<.2)px(g,x,y,INK)})];
  tex.dug=mk(g=>{g.fillStyle="#fff";g.fillRect(0,0,TS,TS);for(let y=0;y<TS;y++)for(let x=0;x<TS;x++)if(bay(x,y)<.07)px(g,x,y,PALE)});
  tex.timber=mk(g=>{g.fillStyle="#fff";g.fillRect(0,0,TS,TS);g.fillStyle=TAN;g.fillRect(0,1,TS,4);g.fillStyle=BROWN;g.fillRect(0,0,TS,1);g.fillRect(0,5,TS,1);
    g.fillRect(5,1,1,4);for(let y=6;y<TS;y++)for(let x=0;x<TS;x++)if(bay(x,y)<.3)px(g,x,y,BLUE)});
  tex.gate=[0,1].map(v=>mk(g=>{g.fillStyle=INK;g.fillRect(0,0,TS,TS);for(let y=0;y<TS;y++)for(let x=0;x<TS;x++)if(((x+y+v*6)%6)<2)px(g,x,y,"#ffd400");
    g.fillStyle="#fff";g.fillRect(4,4,4,1);g.fillRect(5,5,2,1);g.fillStyle=BLUE;g.fillRect(0,0,TS,1)}));
  themeTex[0]=tex;
  tex.wall=[0,1].map(v=>mk(g=>{g.fillStyle="#fff";g.fillRect(0,0,TS,TS);
    for(let y=0;y<TS;y++)for(let x=0;x<TS;x++){if(bay(x,y)<.12)px(g,x,y,PALE)}
    g.fillStyle="#e3d2bf";g.fillRect(v?3:8,0,1,TS);g.fillStyle=TAN;g.fillRect(v?4:9,0,1,TS)}));
}
// Level 2+ texture sets in the same white/#0052FF dithered dot-matrix style, per theme.
const themeTex={};
function texFor(L){
  if(L<=1||!LV)return tex;
  const th=LV.themeFor(L);const key=th.id+"-"+th.cycle;
  if(themeTex[key])return themeTex[key];
  const bg=th.invert?BLUE:"#fff",dot=th.invert?"#fff":th.ink,acc=th.accent,acc2=th.accent2,pale=th.pale;
  const mir=th.mirror?1:0;
  const dirt=(dens,accP,v)=>mk(g=>{g.fillStyle=bg;g.fillRect(0,0,TS,TS);
    for(let y=0;y<TS;y++)for(let x=0;x<TS;x++){const xx=mir?TS-1-x:x;const h=hash2(xx+v*31,y,7+th.index);
      if(bay(xx,y)<dens+(h-.5)*.05)px(g,x,y,dot);else if(h<accP)px(g,x,y,acc);}});
  const t={};
  t.dirt=[0,1,2,3].map(v=>[dirt(th.dens[0],.06,v),dirt(th.dens[1],.045,v),dirt(th.dens[2],.03,v)]);
  t.clay=[0,1,2,3].map(v=>mk(g=>{g.fillStyle=bg;g.fillRect(0,0,TS,TS);
    for(let y=0;y<TS;y++)for(let x=0;x<TS;x++){const band=((y+v+th.index)%(th.id==="chalk"?6:4)<2)?.7:.3;if(bay(x,y)<band*(th.dens[1]/.25*.5+.5))px(g,x,y,dot);else if(hash2(x,y,v+40)<.06)px(g,x,y,acc)}}));
  t.rock=[0,1,2,3].map(v=>mk(g=>{g.fillStyle=th.invert?INK:(th.id==="chalk"?"#7fa0ff":BLUE);g.fillRect(0,0,TS,TS);
    for(let y=0;y<TS;y++)for(let x=0;x<TS;x++){if(x%2===1&&bay(x,y)<.35)px(g,x,y,th.invert?acc:"#fff");}
    g.fillStyle=acc2;g.fillRect(2+v,2,3,1);g.fillRect(2+v,3,1,1);
    g.fillStyle=th.invert?"#fff":INK;g.fillRect(0,TS-1,TS,1);g.fillRect(TS-1,0,1,TS)}));
  t.bed=[mk(g=>{g.fillStyle=th.bed;g.fillRect(0,0,TS,TS);for(let y=0;y<TS;y++)for(let x=0;x<TS;x++)if(x%2===0&&bay(x,y)<.2)px(g,x,y,th.invert?"#fff":INK)})];
  t.dug=mk(g=>{g.fillStyle=th.invert?INK:"#fff";g.fillRect(0,0,TS,TS);for(let y=0;y<TS;y++)for(let x=0;x<TS;x++)if(bay(x,y)<(th.invert?.12:.09))px(g,x,y,th.invert?BLUE:pale)});
  t.timber=tex.timber;t.wall=tex.wall;
  t.gate=[0,1].map(v=>mk(g=>{g.fillStyle=INK;g.fillRect(0,0,TS,TS);for(let y=0;y<TS;y++)for(let x=0;x<TS;x++)if(((x+y+v*6)%6)<2)px(g,x,y,acc2);
    g.fillStyle="#fff";g.fillRect(4,4,4,1);g.fillRect(5,5,2,1);g.fillStyle=acc;g.fillRect(0,0,TS,1)}));
  t.theme=th;
  return themeTex[key]=t;
}
// Props drawn in open (dug) ground per theme.
function drawProp(th,x,y,X,Y,step){
  const h=hash2(x,y,11);if(h>.09)return;
  const below=solidAt(x,y+1),above=solidAt(x,y-1);
  switch(th.props){
    case "timber": if(above&&below){ctx.fillStyle=BROWN;ctx.fillRect(X+1,Y,2,TS);ctx.fillRect(X+TS-3,Y,2,TS);ctx.fillStyle=TAN;ctx.fillRect(X,Y,TS,2)}
      else if(above){ctx.fillStyle=INK;ctx.fillRect(X+5,Y,1,3);ctx.fillStyle=step%8<6?"#ffd400":"#fff";ctx.fillRect(X+4,Y+3,3,3)}break;
    case "chalk": if(below){ctx.fillStyle="#7fa0ff";for(let i=0;i<3;i++)ctx.fillRect(X+2+i*3,Y+TS-2-(i%2),2,1);ctx.fillRect(X+3,Y+6,5,1)}break;
    case "water": if(below){ctx.fillStyle="#16e0ff";ctx.fillRect(X,Y+TS-3,TS,3);ctx.fillStyle="#fff";ctx.fillRect(X+((step+x)%TS),Y+TS-3,2,1)}
      else if(above){ctx.fillStyle="#16e0ff";const d=(step+x*3)%10;ctx.fillRect(X+6,Y+d,1,2)}break;
    case "ember": {ctx.fillStyle=(step+x+y)%4<2?"#ff2bd6":"#ffd400";const k=(step+x*5)%TS;ctx.fillRect(X+((x*7)%10),Y+TS-1-k,1,1);if(below){ctx.fillStyle="#ff2bd6";ctx.fillRect(X,Y+TS-1,TS,1)}}break;
    case "circuit": ctx.fillStyle="#16e0ff";ctx.fillRect(X,Y+5,TS,1);ctx.fillRect(X+((x*5)%9)+1,Y+2,1,4);if(step%6<3){ctx.fillStyle="#22e36b";ctx.fillRect(X+((x*5)%9),Y+1,3,2)}break;
    case "wire": ctx.fillStyle=BLUE;for(let k=0;k<TS;k+=3)ctx.fillRect(X+k,Y+6+((k/3)%2),1,1);break;
  }
}
// sprite helper
function sprite(g,rows,x,y,flip,cmap){const w=rows[0].length;
  for(let j=0;j<rows.length;j++){const r=rows[j];for(let i=0;i<w;i++){const ch=r[i];if(ch==="."||ch===" ")continue;
    g.fillStyle=cmap[ch];g.fillRect(x+(flip?w-1-i:i),y+j,1,1)}}}
const CM={"#":BLUE,"w":"#fff","d":INK,"c":"#16e0ff","m":"#ff2bd6","y":"#ffd400","b":BROWN,"t":TAN,"p":PALE};
const WHITE=new Proxy({},{get:()=>"#fff"});
const SOLDIER_TOP=[
"...####...",
"..######..",
".##w#####.",
"##########",
"...#ww#...",
"...####...",
"..######..",
"..######..",
"..##dd##.."];
const LEGS=[["...#..#...","..##..##.."],["...##.#...","...#..##.."],["...#.##...","..##..#..."]];
const GEM=[".######.","#ww#w#w#","#c#ww#c#",".#c##c#.","..#cc#..","...##..."];
const PGEM=["..######..",".#wwmw#w#.","#ww#ww#ww#","#c#wwyw#c#",".#c#ww#c#.","..#c##c#..","...#cc#...","....##...."];
const BOULDER=["...#####...","..##www##..",".##ww####d.",".#w######d.","##########d","##########d",".########d.",".d#######d.","..ddddddd.."];
const UXB=["....#....","...###...","..#####..","..#mmm#..","..#####..","..#####..","..#####..","..ddddd.."];

// ---------- state ----------
let ridge=null,cv,ctx,VW=320,VH=200,SCALE=3;
let world=null,hp=null,seed=1,rng=Math.random,seams=[],hotList=[],sharedSeed=null;
let P,cam={x:0,y:0},shake=0,flash=0,glitch=0;
let bullets=[],lanes=[],shells=[],booms=[],parts=[],texts=[],falling=[],unstable=new Map(),fuses=[];
let mode="title",paused=false,time=0,runTime=0,timers={},banner=null;
let mult=1,lives=9,maxDepth=0,gems=0,powerGems=0,milestones=new Set(),depthBonusAt=25,inv=0,dead=0;
const keys={},pressed={};
let cb={};
const bunkers=[{col:5,id:"hot",label:"HOT LIST"},{col:14,id:"calls",label:"CALLS"},{col:23,id:"callers",label:"CALLERS"},{col:32,id:"about",label:"HOW TO"}];
// RPG stats (applied from equipped gear)
let gearStats={digSpeed:1,protection:0,moveSpeed:1,luck:1};
let curLevel=1,runId="",rats=[],fortified=new Set(),fortCd=0,regenT=0,secondWindUsed=false,seamMax=0,seamRng=null,seamI=0;
const RAT=["..##....","#####.#.",".#w###..","..####..",".#..#..."];
let sessionDigs=0,sessionXp=0,lastDepthXp=0,sessionStart=0;

// Power seams past the first 2000 rows are generated lazily (own seeded stream, same for everyone).
function extendSeams(y){
  if(!seamRng)seamRng=mulberry(seed^0x5eed);
  while(seamMax<y+400){const hl=hotList.length?hotList[seamI%hotList.length]:{ticker:"EXAMPLE"};
    seams.push({x:3+Math.floor(seamRng()*(W-9)),y:seamMax,ticker:hl.ticker,status:hl.status||"",left:9});seamMax+=22+Math.floor(seamRng()*30);seamI++}
}
function rowGen(y){
  if(y>seamMax-200)extendSeams(y);
  const r=new Uint8Array(W),h=new Uint8Array(W);
  for(let x=0;x<W;x++){
    let t;
    if(y<S)t=T.AIR;else if(y<FLOOR)t=T.TRENCH;else if(y===FLOOR)t=(x===0||x===W-1)?T.BED:T.TIMBER;
    else{
      const d=y-FLOOR;
      const L=levelsOn?levelOfDepth(d):1,ld=levelsOn?d%LDEPTH:d,hz=L>1?Math.min(3,DIFF(L).hazard):1;
      if(x===0||x===W-1)t=T.BED;
      else if(levelsOn&&ld===LDEPTH-1)t=T.GATE;                 // sealed floor of the level
      else if(levelsOn&&L>1&&ld<4)t=(ld===3&&hash2(x,y,seed+5)<.25)?T.DIRT:T.DUG; // drop-in cavern
      else{
        t=T.DIRT;
        const n=vnoise(x*.2,y*.2,seed),n2=vnoise(x*.34+50,y*.34,seed+1),n3=vnoise(x*.13+300,y*.24,seed+2);
        if(d>5&&n>.64)t=T.CLAY;
        if(d>6&&n2>.8-Math.min(.06,d*.001))t=T.ROCK;
        if(d>7&&n3>.76)t=T.DUG;
        const q=hash2(x,y,seed+9);
        if(t===T.DIRT||t===T.CLAY){
          if(q<.04+Math.min(.02,d*.0005))t=T.GEM;
          else if(d>4&&q>1-(.008+Math.min(.02,d*.0004))*hz)t=T.BOULDER;
          else if(d>9&&q>.5&&q<.5+(.006+Math.min(.012,d*.0002))*hz)t=T.UXB;
        }
        if(d<=3&&(t===T.ROCK||t===T.DUG))t=T.DIRT;
        if(d===2&&Math.abs(x-20)===3)t=T.GEM;
      }
    }
    if(t!==T.GATE)for(const s of seams){if(y>=s.y&&y<s.y+3&&x>=s.x&&x<s.x+3)t=T.POWER;
      else if(y>=s.y-1&&y<s.y+4&&x>=s.x-1&&x<s.x+4&&(t===T.DUG||t===T.BOULDER||t===T.UXB))t=T.CLAY;}
    r[x]=t;h[x]=hpFor(t,y);
  }
  world[y]=r;hp[y]=h;
}
function tile(x,y){if(x<0||x>=W)return y>=FLOOR?T.BED:(y<S?T.AIR:T.TRENCH);if(y<0)return T.AIR;if(!world[y])rowGen(y);return world[y][x]}
function setTile(x,y,t){if(x<0||x>=W||y<0)return;if(!world[y])rowGen(y);world[y][x]=t;hp[y][x]=hpFor(t,y)}
function applyRemoteDig(x,y){if(!Number.isInteger(x)||!Number.isInteger(y)||!world)return;const t=tile(x,y);if(!SOLID.has(t)||t===T.BED)return;fortified.delete(x+","+y);setTile(x,y,y<FLOOR?T.TRENCH:T.DUG)}
const solidAt=(x,y)=>SOLID.has(tile(x,y));
const isAir=t=>!SOLID.has(t);

function newRun(){
  // Multiplayer: everyone in the room uses the room's seed so the trench is the same for all
  seed=sharedSeed!=null?sharedSeed:(Math.random()*1e9)|0;rng=mulberry(seed);world=[];hp=[];
  seams=[];let sy=FLOOR+9;let i=0;
  while(sy<FLOOR+2000){const hl=hotList.length?hotList[i%hotList.length]:{ticker:"EXAMPLE"};
    seams.push({x:3+Math.floor(rng()*(W-9)),y:sy,ticker:hl.ticker,status:hl.status||"",left:9});sy+=16+Math.floor(i*3+rng()*10);i++;}
  seamMax=sy;seamRng=null;seamI=i;
  curLevel=1;rats=[];fortified=new Set();fortCd=0;regenT=0;secondWindUsed=false;
  runId="r-"+Date.now().toString(36)+"-"+((Math.random()*1e8)|0).toString(36);
  P={x:20*TS+2,y:(FLOOR)*TS-11,w:8,h:11,vx:0,vy:0,face:1,ground:false,swing:0,aim:"side",digCd:0,walk:0,climb:false};
  bullets=[];lanes=[];shells=[];booms=[];parts=[];texts=[];falling=[];unstable.clear();fuses=[];
  mult=1;lives=9;maxDepth=0;gems=0;powerGems=0;milestones=new Set();depthBonusAt=25;inv=0;dead=0;runTime=0;banner=null;
  timers={sweep:2.5,art:7,scan:0};
  cam.x=P.x-VW/2;cam.y=P.y-VH*.5;clampCam(true);
  // RPG: reset session stats and get gear bonuses
  sessionDigs=0;sessionXp=0;lastDepthXp=0;sessionStart=Date.now();
  if(typeof RPG!=='undefined'){
    gearStats=RPG.getGearStats();
    const prot=gearStats.protection;
    if(prot>0)lives=Math.min(9,lives+prot); // Helmet adds extra hits
  }
  // Re-apply tiles other players dug recently
  if(typeof Multiplayer!=='undefined'&&Multiplayer.dugBlocks)Multiplayer.dugBlocks.forEach((_,k)=>{const [x,y]=k.split(',').map(Number);applyRemoteDig(x,y)});
  hud(true);
}

// ---------- effects ----------
function burst(x,y,n,colors,sp,grav,life){for(let i=0;i<n;i++){const a=rng()*Math.PI*2,s=(sp||60)*(.3+rng());
  parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-(grav?30:0),g:grav??300,l:(life||.6)*(.5+rng()),c:colors[(rng()*colors.length)|0],s:rng()<.25?2:1})}}
function addText(x,y,s,c){texts.push({x,y,s,c:c||BLUE,t:0})}
function addShake(n){shake=Math.max(shake,n)}

function hurt(n,fx,fy){
  if(inv>0||mode!=="play"||dead)return;
  lives=Math.max(0,lives-n);inv=1.4;flash=.12;glitch=.25;addShake(5+n*2);Sfx.play("hit");
  const dir=Math.sign(P.x+P.w/2-(fx??P.x))||1;P.vx=dir*90;P.vy=-110;
  burst(P.x+4,P.y+5,14,["#ff2bd6",BLUE,"#fff"],90);
  cb.onHit&&cb.onHit(n);
  if(typeof Multiplayer!=='undefined')Multiplayer.sendEvent({kind:'hit'});
  if(typeof Campaign!=='undefined')Campaign.note('hit');
  if(lives<=0&&fx.secondWind&&!secondWindUsed){secondWindUsed=true;lives=3;inv=2.5;showBanner("SECOND WIND");Sfx.play("power");burst(P.x+4,P.y+5,24,["#22e36b","#fff",BLUE],120);hud();return}
  if(lives<=0){dead=1.2;Sfx.play("over");burst(P.x+4,P.y+5,40,[BLUE,"#ff2bd6","#16e0ff","#ffd400"],140,250,1.2)}
  hud();
}
function explode(tx,ty,r,dmg){
  const cx=tx*TS+TS/2,cy=ty*TS+TS/2;
  for(let y=Math.floor(ty-r);y<=Math.ceil(ty+r);y++)for(let x=Math.floor(tx-r);x<=Math.ceil(tx+r);x++){
    const d=Math.hypot(x-tx,y-ty);if(d>r)continue;const t=tile(x,y);
    if(t===T.BED||t===T.GEM||t===T.POWER||t===T.GATE||y<FLOOR)continue;
    if(t===T.ROCK&&d>r*.6)continue;
    if(t===T.UXB){fuses.push({x,y,t:.15});continue}
    if(SOLID.has(t)){setTile(x,y,T.DUG);fortified.delete(x+","+y);if(rng()<.5)burst(x*TS+6,y*TS+6,3,[BLUE,BROWN],80)}
  }
  booms.push({x:cx,y:cy,r:r*TS,t:0});
  burst(cx,cy,46,[BLUE,"#fff",BLUE,"#ffd400","#ff2bd6",BROWN],170,200,.9);
  addShake(10);flash=.18;glitch=.3;Sfx.play("boom");
  const pd=Math.hypot(P.x+P.w/2-cx,P.y+P.h/2-cy);
  for(const rt of rats)if(Math.hypot(rt.x+4-cx,rt.y+3-cy)<(r+.4)*TS)rt.hp=0;
  if(pd<(r+.6)*TS)hurt(Math.max(1,(dmg||2)-fx.blastReduce),cx,cy);
  else if(mode==="play"&&!dead){
    if(typeof Multiplayer!=='undefined')Multiplayer.sendEvent({kind:'survive'});
    if(typeof Campaign!=='undefined')Campaign.note('survive',1,curLevel);
  }
  timers.scan=0;
}

// ---------- digging ----------
function digTarget(){
  const cx=P.x+P.w/2,cy=P.y+P.h/2;const tx=Math.floor(cx/TS),ty=Math.floor(cy/TS);
  if(P.aim==="down")return[tx,Math.floor((P.y+P.h+2)/TS)];
  if(P.aim==="up")return[tx,Math.floor((P.y-2)/TS)];
  return[Math.floor((P.face>0?P.x+P.w+2:P.x-2)/TS),ty];
}
function meleeHit(){
  if(!rats.length)return false;
  const hx=P.face>0?P.x+P.w:P.x-12,hy=P.y-2,dn=P.aim==="down",up=P.aim==="up";
  for(const rt of rats){if(rt.hp<=0)continue;
    const inBox=dn?(rt.x+8>P.x-3&&rt.x<P.x+P.w+3&&rt.y>P.y&&rt.y<P.y+P.h+12):up?(rt.x+8>P.x-3&&rt.x<P.x+P.w+3&&rt.y+6>P.y-12&&rt.y<P.y):(rt.x+8>hx&&rt.x<hx+12&&rt.y+6>hy&&rt.y<P.y+P.h+2);
    if(inBox){rt.hp-=fx.melee;rt.vx=(P.face||1)*80;rt.vy=-90;rt.stun=.35;burst(rt.x+4,rt.y+3,6,["#ff2bd6","#fff",INK],80);addText(rt.x-2,rt.y-6,"-"+fx.melee,"#ff2bd6");Sfx.play("clink");addShake(2);return true}}
  return false;
}
function dig(){
  P.swing=.18;P.digCd=.2/(gearStats.digSpeed*fx.digSpeed); // Faster dig with better pickaxe + Digging skill
  if(meleeHit())return;
  const [x,y]=digTarget();const t=tile(x,y);
  const hx=x*TS+6,hy=y*TS+6;
  if(!SOLID.has(t)){Sfx.play("dig",1);return}
  if(t===T.BED){Sfx.play("clink");burst(hx,hy,4,["#fff","#16e0ff"],60);return}
  const soft=t===T.DIRT||t===T.CLAY||t===T.GEM;
  hp[y][x]=Math.max(0,hp[y][x]-(fx.softDouble&&soft?2:1));
  if(fx.oneShot&&t!==T.GATE&&t!==T.UXB&&hp[y][x]>0&&rng()<fx.oneShot){hp[y][x]=0;addText(hx-8,hy-12,"CRACK!","#16e0ff")}
  const cols=t===T.ROCK?[BLUE,"#fff",INK]:t===T.TIMBER?[BROWN,TAN]:t===T.GEM||t===T.POWER?["#16e0ff","#fff",BLUE]:[BLUE,BROWN,BLUE];
  burst(hx,hy,t===T.ROCK?6:5,cols,70);addShake(t===T.ROCK?2:1);
  Sfx.play(t===T.ROCK?"clink":"dig",t===T.CLAY);
  if(typeof Haptics!=='undefined')Haptics.impact('light');
  if(hp[y][x]>0)return;
  if(t===T.UXB){fuses.push({x,y,t:1});addText(hx-10,hy-10,"UXB!","#ff2bd6");Sfx.play("sweep");return}
  setTile(x,y,y<FLOOR?T.TRENCH:T.DUG);
  burst(hx,hy,8,cols,90);
  // Own fortifications come down without XP or a world dig (they were never shared).
  if(fortified.delete(x+","+y))return;
  if(t===T.GATE){showBanner(levelsOn?"FLOOR BREACHED":"");flash=.2;glitch=.4;addShake(8);Sfx.play("power")}
  if(typeof Haptics!=='undefined')Haptics.impact('medium');
  // RPG: XP for digging + multiplayer sync
  sessionDigs++;
  if(typeof RPG!=='undefined')RPG.addXp(1,'dig');
  if(typeof Multiplayer!=='undefined')Multiplayer.sendDig(x,y);
  if(t===T.GEM){
    gems++;bump(GEM_X);addText(hx-8,hy-8,"x"+GEM_X.toFixed(2),BLUE);Sfx.play("gem",gems%5);
    burst(hx,hy,12,["#16e0ff","#fff",BLUE],100,120);
    if(typeof Haptics!=='undefined')Haptics.notification('success');
    if(typeof RPG!=='undefined'){
      RPG.addXp(5,'diamond');
      if(typeof Multiplayer!=='undefined')Multiplayer.sendEvent({kind:'diamond',x,y});
      if(typeof Multiplayer==='undefined'||!Multiplayer.connected)RPG.tryGearDrop(maxDepth);
    }
    // Rare relic find on a gem at depth
    if(maxDepth>8&&hash2(x,y,seed+21)<.12){
      if(typeof Multiplayer!=='undefined')Multiplayer.sendEvent({kind:'relic',x,y});
      if(typeof Campaign!=='undefined')Campaign.note('relic',1,curLevel);
      addText(hx-16,hy-16,"RELIC", "#ffd400");
    }
  }
  if(t===T.POWER){
    powerGems++;bump(POWER_X);Sfx.play("gem",4);
    burst(hx,hy,18,["#ff2bd6","#ffd400","#16e0ff","#fff"],130,100);
    if(typeof Haptics!=='undefined')Haptics.notification('success');
    if(typeof RPG!=='undefined'){
      RPG.addXp(10,'power');
      if(typeof Multiplayer!=='undefined')Multiplayer.sendEvent({kind:'power',x,y});
      if(typeof Multiplayer==='undefined'||!Multiplayer.connected)RPG.tryGearDrop(maxDepth);
    }
    const s=seams.find(s=>x>=s.x&&x<s.x+3&&y>=s.y&&y<s.y+3);
    if(s){s.left--;addText(hx-14,hy-10,"$"+s.ticker+" "+(9-s.left)+"/9","#ff2bd6");
      if(s.left===0){Sfx.play("power");showBanner("$"+s.ticker+" POWERED UP");flash=.15;glitch=.35;addShake(6);if(typeof Haptics!=='undefined')Haptics.notification('success')}}}
  timers.scan=0;
}
function bump(f){const before=mult;mult*=f;
  for(const m of [9,58.9,100,589]){if(before<m&&mult>=m&&!milestones.has(m)){milestones.add(m);
    showBanner(m===589?"589x MANIFESTED":m===9?"POWER OF 9":"x"+m+" KEEP DIGGING");Sfx.play(m===589?"power":"milestone");if(m===589){glitch=.6;flash=.2}}}
  hud();cb.onMult&&cb.onMult();
}
function showBanner(s){banner={s,t:0}}

// ---------- update ----------
function clampCam(snap){
  if(!P)return;
  const wp=W*TS;
  const tx=VW>=wp?(wp-VW)/2:Math.max(0,Math.min(wp-VW,P.x+P.w/2-VW/2));
  const ty=Math.max(0,P.y+P.h/2-VH*.38);
  if(snap){cam.x=tx;cam.y=ty}else{cam.x+=(tx-cam.x)*.12;cam.y+=(ty-cam.y)*.1}
}
function collide(axis){
  const x0=Math.floor(P.x/TS),x1=Math.floor((P.x+P.w-.01)/TS),y0=Math.floor(P.y/TS),y1=Math.floor((P.y+P.h-.01)/TS);
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){if(!solidAt(x,y))continue;
    if(axis==="x"){if(P.vx>0)P.x=x*TS-P.w;else if(P.vx<0)P.x=(x+1)*TS;P.vx=0;return true}
    else{if(P.vy>0){P.y=y*TS-P.h;if(!P.ground&&P.vy>120)Sfx.play("land");P.ground=true}else if(P.vy<0)P.y=(y+1)*TS;P.vy=0;return true}}
  return false;
}
function update(dt){
  time+=dt;
  const playing=mode==="play"&&!dead;
  if(mode==="play")runTime+=dt;
  // player
  const L=keys.left,R=keys.right,U=keys.up,D=keys.down;
  if(playing){
    const tgt=(R?1:0)-(L?1:0);
    const spd=62*gearStats.moveSpeed; // Boots speed bonus
    if(tgt){P.vx+=tgt*700*gearStats.moveSpeed*dt;P.face=tgt;P.walk+=dt*10}else{P.vx*=Math.pow(.0005,dt)}
    P.vx=Math.max(-spd,Math.min(spd,P.vx));
    P.aim=D?"down":U&&!tgt?"up":"side";
    const my=Math.floor((P.y+P.h/2)/TS),touchL=solidAt(Math.floor((P.x-3)/TS),my),touchR=solidAt(Math.floor((P.x+P.w+3)/TS),my);
    if(pressed.up&&P.ground){P.vy=-150;P.ground=false;Sfx.play("jump")}
    P.climb=U&&(touchL||touchR)&&P.vy>-60&&!solidAt(Math.floor((P.x+P.w/2)/TS),Math.floor((P.y-1)/TS));
    if(P.climb){P.vy=-52;if(rng()<.1)burst(P.x+(touchR?P.w:0),P.y+6,1,[BLUE,BROWN],30)}
    if(D&&P.ground){const tx=Math.floor((P.x+P.w/2)/TS);const c=tx*TS+(TS-P.w)/2;P.x+=Math.sign(c-P.x)*Math.min(Math.abs(c-P.x),50*dt)}
    P.digCd-=dt;
    if((pressed.dig||keys.dig)&&P.digCd<=0)dig();
  }else{P.vx*=.8}
  if(dead){dead-=dt;if(dead<=0){dead=0;mode="over";best();endSession();cb.onOver&&cb.onOver(stats())}}
  P.swing=Math.max(0,P.swing-dt);inv=Math.max(0,inv-dt);
  P.vy=Math.min(260,P.vy+520*dt);
  P.x+=P.vx*dt;collide("x");
  P.x=Math.max(0,Math.min(W*TS-P.w,P.x));
  P.ground=false;P.y+=P.vy*dt;collide("y");
  // depth
  const depth=Math.max(0,Math.floor((P.y+P.h)/TS)-FLOOR);
  if(playing){const L=levelOfDepth(depth);if(L!==curLevel){const up=L>curLevel;curLevel=L;enterLevel(L,up)}}
  if(playing&&depth>maxDepth){maxDepth=depth;
    // RPG: XP for depth milestones
    if(depth-lastDepthXp>=5){
      lastDepthXp=depth;
      if(typeof RPG!=='undefined')RPG.addXp(2,'depth');
      if(typeof Campaign!=='undefined')Campaign.note('depth',depth,curLevel);
    }
    if(maxDepth>=depthBonusAt){bump(DEPTH_X);addText(P.x-10,P.y-8,depthBonusAt+"M x"+DEPTH_X,"#ff2bd6");depthBonusAt+=25;
      if(typeof RPG!=='undefined'&&(typeof Multiplayer==='undefined'||!Multiplayer.connected))RPG.tryGearDrop(maxDepth);
    }
    hud()}
  clampCam(false);
  // Multiplayer: send state and interpolate others
  if(typeof Multiplayer!=='undefined'&&Multiplayer.connected){
    Multiplayer.sendState(P.x,P.y,P.vx,P.vy,P.face,P.swing);
    Multiplayer.interpolatePlayers(dt);
  }

  // difficulty
  const diff=Math.min(1,runTime/150);
  const deep=mode==="play"&&curLevel>1,DL=DIFF(mode==="play"?curLevel:1);
  // sweeps (level 2+: "tunnel rounds" fired along the trencher's own row; they pass through dirt, timber stops them)
  timers.sweep-=dt;
  if(timers.sweep<=0){
    const near=P.y<(FLOOR+1)*TS;
    timers.sweep=mode==="play"?(deep?Math.max(.9,(4.2-1.6*diff)/DL.fire):(near?3.4-1.8*diff:5))+rng()*1.5:3+rng()*2;
    let row;const r=rng();
    if(mode!=="play")row=S-2-Math.floor(rng()*3);
    else if(deep)row=Math.floor((P.y+P.h/2)/TS)+(r<.7?0:r<.85?-1:1);
    else row=r<.45?S+1:r<.75?S:S-1-Math.floor(rng()*2);
    if(!deep||!near)lanes.push({row,dir:rng()<.5?1:-1,t:.95+fx.warnBonus+(deep?.25:0),n:3+Math.floor(rng()*(2+diff*4))+DL.extraBullets,gap:16+rng()*10,speed:(200+diff*80)*DL.bulletSpeed*(deep?.55:1),ghost:deep});
    if(mode==="play")Sfx.play("sweep");
  }
  for(const ln of lanes){ln.t-=dt;if(ln.t<=0&&!ln.fired){ln.fired=true;
    for(let i=0;i<ln.n;i++){const sx=ln.dir>0?Math.min(cam.x,0)-10-i*ln.gap:Math.max(cam.x+VW,W*TS)+10+i*ln.gap;
      bullets.push({x:sx,y:ln.row*TS+4+((rng()*4)|0),vx:ln.dir*ln.speed,pinged:false,ghost:!!ln.ghost})}}}
  lanes=lanes.filter(l=>!l.fired||l.t>-.2);
  for(const b of bullets){b.x+=b.vx*dt;
    const tx=Math.floor(b.x/TS),ty=Math.floor(b.y/TS);
    if(b.ghost){const t=tile(tx,ty);if(t===T.TIMBER&&b.x>0&&b.x<W*TS){b.dead=true;hp[ty][tx]=Math.max(0,hp[ty][tx]-1);if(hp[ty][tx]<=0){setTile(tx,ty,T.DUG);fortified.delete(tx+","+ty)}burst(b.x,b.y,6,["#ffd400",BROWN,TAN],60,150,.3);continue}}
    else if(b.x>0&&b.x<W*TS&&solidAt(tx,ty)){b.dead=true;burst(b.x,b.y,5,["#ffd400","#fff",BLUE],60,150,.3);continue}
    if(b.x<Math.min(0,cam.x)-400||b.x>Math.max(W*TS,cam.x+VW)+400)b.dead=true;
    if(playing&&b.y>P.y&&b.y<P.y+P.h&&b.x>P.x-2&&b.x<P.x+P.w+2){b.dead=true;
      if(fx.parry&&inv<=0&&rng()<fx.parry){addText(P.x-6,P.y-8,"PARRY","#16e0ff");Sfx.play("clink");burst(b.x,b.y,8,["#16e0ff","#fff"],90)}else hurt(1,b.x-b.vx,b.y)}
    else if(playing&&!b.pinged&&Math.abs(b.x-P.x)<20&&Math.abs(b.y-P.y)<30){
      b.pinged=true;Sfx.play("ping");
      if(typeof Multiplayer!=='undefined')Multiplayer.sendEvent({kind:'dodge'});
      if(typeof Campaign!=='undefined')Campaign.note('dodge',1,curLevel);
    }
    if(rng()<.3)parts.push({x:b.x-Math.sign(b.vx)*4,y:b.y,vx:0,vy:0,g:0,l:.12,c:rng()<.5?"#ffd400":"#ff2bd6",s:1});
  }
  bullets=bullets.filter(b=>!b.dead);
  // artillery
  if(mode==="play"){timers.art-=dt;
    if(timers.art<=0){timers.art=deep?Math.max(1.5,(7.5-4*diff)/DL.fire)+rng()*2:7.5-4*diff+rng()*3;
      if(deep){ // sapper charges: a fuse set in the walls near the trencher
        for(let k=0;k<12;k++){const fx2=Math.max(1,Math.min(W-2,Math.floor((P.x+P.w/2)/TS+(rng()*10-5)))),fy=Math.floor((P.y+P.h/2)/TS)+Math.floor(rng()*7-3);
          const t=tile(fx2,fy);if(SOLID.has(t)&&t!==T.BED&&t!==T.GATE&&t!==T.GEM&&t!==T.POWER){fuses.push({x:fx2,y:fy,t:1.6+fx.warnBonus,charge:true});addText(fx2*TS-6,fy*TS-4,"CHARGE!","#ff2bd6");Sfx.play("whistle");break}}
      }else{
      const tx=Math.max(1,Math.min(W-2,Math.floor((P.x+P.w/2)/TS+(rng()*8-4))));
      shells.push({x:tx*TS+6,y:Math.min(cam.y,S*TS)-40,vy:120,tx});Sfx.play("whistle")}}}
  for(const s of shells){s.vy=Math.min(300,s.vy+200*dt);s.y+=s.vy*dt;
    const tx=Math.floor(s.x/TS),ty=Math.floor((s.y+4)/TS);
    const hitP=mode==="play"&&s.x>P.x-2&&s.x<P.x+P.w+2&&s.y+4>P.y&&s.y<P.y+P.h;
    if((s.y>0&&solidAt(tx,ty))||hitP){s.dead=true;explode(tx,ty,2.3,2)}
    if(rng()<.6)parts.push({x:s.x+(rng()*2-1),y:s.y-3,vx:0,vy:-10,g:0,l:.25,c:PALE,s:2});
  }
  shells=shells.filter(s=>!s.dead);
  // fuses
  for(const f of fuses){f.t-=dt;if(f.t<=0&&!f.done){f.done=true;if(tile(f.x,f.y)===T.UXB)setTile(f.x,f.y,T.DUG);
    const FL=DIFF(levelOfRow(f.y));explode(f.x,f.y,f.charge?FL.blastRadius:2.2,levelOfRow(f.y)>1?FL.blastDamage:2)}}
  fuses=fuses.filter(f=>!f.done);
  // boulders
  timers.scan-=dt;
  if(timers.scan<=0){timers.scan=.25;
    const y0=Math.max(FLOOR,Math.floor(cam.y/TS)-2),y1=Math.floor((cam.y+VH)/TS)+3;
    for(let y=y0;y<=y1;y++)for(let x=1;x<W-1;x++)if(tile(x,y)===T.BOULDER&&isAir(tile(x,y+1))){const k=x+","+y;if(!unstable.has(k))unstable.set(k,{x,y,t:.5})}}
  for(const [k,u] of unstable){u.t-=dt;if(u.t<=0){unstable.delete(k);
    if(tile(u.x,u.y)===T.BOULDER&&isAir(tile(u.x,u.y+1))){setTile(u.x,u.y,T.DUG);falling.push({x:u.x*TS,y:u.y*TS,tx:u.x,vy:0});timers.scan=0}}}
  for(const f of falling){f.vy=Math.min(240,f.vy+500*dt);f.y+=f.vy*dt;
    const below=Math.floor((f.y+TS)/TS);
    if(solidAt(f.tx,below)){f.y=(below-1)*TS;f.dead=true;
      if(isAir(tile(f.tx,below-1)))setTile(f.tx,below-1,T.BOULDER);
      Sfx.play("land");addShake(3);burst(f.x+6,f.y+11,8,[BLUE,BROWN,"#fff"],60)}
    if(mode==="play"&&f.vy>40&&f.x<P.x+P.w&&f.x+TS>P.x&&f.y+TS>P.y+2&&f.y<P.y+P.h){f.dead=true;hurt(1,f.x+6,f.y);burst(f.x+6,f.y+6,20,[BLUE,"#fff",INK],110)}
  }
  falling=falling.filter(f=>!f.dead);
  // tunnel raiders (level 2+): burrow out of the wall a few tiles from the trencher, chase along
  // the row and gnaw through dirt to get at you. Timber (Engineering) slows them down.
  if(deep&&DL.enemyCount>0){timers.rat=(timers.rat??3)-dt;
    if(timers.rat<=0){timers.rat=Math.max(1.2,6-.4*(curLevel-2))+rng()*2;
      if(playing&&rats.length<Math.min(12,DL.enemyCount))for(let k=0;k<10;k++){
        const pr=Math.floor((P.y+P.h-1)/TS),side=rng()<.5?-1:1,rx=Math.floor((P.x+4)/TS)+side*(6+Math.floor(rng()*5)),ry=pr;
        if(rx<1||rx>W-2||levelOfRow(ry)!==curLevel)continue;const t=tile(rx,ry);if(t===T.BED||t===T.GATE||t===T.TIMBER)continue;
        if(SOLID.has(t))setTile(rx,ry,T.DUG);
        rats.push({x:rx*TS+2,y:ry*TS+6,vx:0,vy:0,hp:DL.enemyHp,max:DL.enemyHp,face:-side,stun:.6,dmg:DL.enemyDamage,spd:DL.enemySpeed,gnaw:0});
        burst(rx*TS+6,ry*TS+6,12,[BROWN,TAN,"#ff2bd6"],90);addText(rx*TS-8,ry*TS-6,"RAIDER!","#ff2bd6");break}}}
  for(const rt of rats){
    if(rt.hp<=0){rt.dead=true;burst(rt.x+4,rt.y+3,14,["#ff2bd6",INK,"#fff"],110);addText(rt.x-4,rt.y-8,"RAIDER DOWN","#ff2bd6");continue}
    rt.stun=Math.max(0,rt.stun-dt);
    const dx=P.x-rt.x,dy=P.y+P.h-(rt.y+6);
    const chase=playing&&Math.abs(dy)<2.5*TS&&Math.abs(dx)<14*TS;
    if(!rt.stun&&playing){const dir=chase?Math.sign(dx)||1:rt.face;rt.face=dir;rt.vx=dir*rt.spd}
    else rt.vx*=.9;
    rt.vy=Math.min(240,rt.vy+520*dt);
    const nx=rt.x+rt.vx*dt,fy=Math.floor((rt.y+3)/TS),fx2=Math.floor((nx+(rt.vx>0?8:0))/TS);
    if(solidAt(fx2,fy)){
      if(chase&&!rt.stun){rt.gnaw+=dt;if(rt.gnaw>.8){rt.gnaw=0;const t=tile(fx2,fy);
        if(t===T.TIMBER){hp[fy][fx2]--;if(hp[fy][fx2]<=0){setTile(fx2,fy,T.DUG);fortified.delete(fx2+","+fy)}burst(fx2*TS+6,fy*TS+6,5,[BROWN,TAN],60)}
        else if(t!==T.BED&&t!==T.GATE&&t!==T.UXB&&fy>=FLOOR){setTile(fx2,fy,T.DUG);burst(fx2*TS+6,fy*TS+6,6,[BROWN,TAN],70)}
        else{rt.face=-rt.face}}}
      else{rt.face=-rt.face;rt.vx=0;if(!solidAt(fx2,fy-1)&&solidAt(Math.floor((rt.x+4)/TS),Math.floor((rt.y+7)/TS)))rt.vy=-150}
    }else rt.x=nx;
    rt.y+=rt.vy*dt;const gy=Math.floor((rt.y+6)/TS);if(solidAt(Math.floor((rt.x+4)/TS),gy)&&rt.vy>0){rt.y=gy*TS-6;rt.vy=0}
    if(Math.abs(rt.y-P.y)>20*TS)rt.dead=true;
    if(playing&&!rt.stun&&rt.x<P.x+P.w&&rt.x+8>P.x&&rt.y+6>P.y&&rt.y<P.y+P.h){hurt(rt.dmg,rt.x+4,rt.y);rt.stun=1;rt.vx=-Math.sign(dx||1)*60}}
  rats=rats.filter(r=>!r.dead);
  // Medic: patch up over time
  if(playing&&fx.regenEvery&&lives<9){regenT+=dt;if(regenT>=fx.regenEvery){regenT=0;lives++;addText(P.x-4,P.y-8,"+1 +","#22e36b");hud()}}else regenT=0;
  // Engineering: fortify
  fortCd=Math.max(0,fortCd-dt);
  if(playing&&(pressed.build)&&fx.fortifyCooldown){
    if(fortCd>0)addText(P.x-8,P.y-8,Math.ceil(fortCd)+"S","#ff2bd6");
    else{const [bx,by]=digTarget();const t=tile(bx,by);const overlap=bx*TS<P.x+P.w&&bx*TS+TS>P.x&&by*TS<P.y+P.h&&by*TS+TS>P.y;
      if(by>=FLOOR&&!SOLID.has(t)&&!overlap){setTile(bx,by,T.TIMBER);hp[by][bx]=fx.fortifyHp;fortified.add(bx+","+by);fortCd=fx.fortifyCooldown;Sfx.play("land");burst(bx*TS+6,by*TS+6,8,[BROWN,TAN],70)}}}
  // particles
  for(const p of parts){p.vy+=p.g*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.l-=dt;
    if(p.g&&solidAt(Math.floor(p.x/TS),Math.floor(p.y/TS))){p.vy*=-.3;p.vx*=.6;p.y-=1}}
  parts=parts.filter(p=>p.l>0);if(parts.length>700)parts.splice(0,parts.length-700);
  for(const t of texts)t.t+=dt;texts=texts.filter(t=>t.t<1.1);
  for(const b of booms)b.t+=dt;booms=booms.filter(b=>b.t<.5);
  if(banner){banner.t+=dt;if(banner.t>2.6)banner=null}
  shake*=Math.pow(.004,dt);if(shake<.3)shake=0;
  flash=Math.max(0,flash-dt);glitch=Math.max(0,glitch-dt);
  // bunker hint
  if(playing){const b=nearBunker();cb.onHint&&cb.onHint(b?("E / ENTER: OPEN "+b.label):null);
    if(b&&pressed.enter){cb.onOpen&&cb.onOpen(b.id)}}
  for(const k in pressed)pressed[k]=false;
}
function enterLevel(L,down){
  const th=LV?LV.themeFor(L):null;
  if(down&&L>1&&th){const ch=LV.levelChapter(L);showBanner("LEVEL "+L+" · "+th.displayName.toUpperCase());flash=.25;glitch=.5;Sfx.play("milestone");
    setTimeout(()=>{if(curLevel===L&&mode==="play")showBanner(ch.name.toUpperCase()+" CAMPAIGN")},2700)}
  rats=[];timers.rat=4;
  if(typeof Campaign!=='undefined')Campaign.note('level',0,L);
  cb.onLevelEnter&&cb.onLevelEnter(L,th,down);hud(true);
}
function nearBunker(){if(P.y+P.h>(FLOOR)*TS+1||P.y<S*TS-4)return null;const cx=P.x+P.w/2;return bunkers.find(b=>cx>b.col*TS-2&&cx<(b.col+2)*TS+2)||null}

// ---------- render ----------
function draw(){
  const sx=shake?Math.round((Math.random()*2-1)*shake):0,sy=shake?Math.round((Math.random()*2-1)*shake):0;
  const cx=Math.round(cam.x)+sx,cy=Math.round(cam.y)+sy;
  const step=Math.floor(time*8);
  ctx.fillStyle="#fff";ctx.fillRect(0,0,VW,VH);
  drawSky(cx,cy,step);
  // tiles
  const x0=Math.floor(cx/TS)-1,x1=Math.floor((cx+VW)/TS)+1,y0=Math.max(0,Math.floor(cy/TS)),y1=Math.floor((cy+VH)/TS)+1;
  for(let y=y0;y<=y1;y++){const d=y-FLOOR,layer=d<14?0:d<40?1:2;const RL=levelOfRow(y),tx2=texFor(RL),th=tx2.theme;const tex=tx2;
    for(let x=x0;x<=x1;x++){
      const t=tile(x,y);const X=x*TS-cx,Y=y*TS-cy;
      if(t===T.AIR)continue;
      const v=(hash2(x,y,3)*4)|0;
      if(t===T.TRENCH){ctx.drawImage(tex.wall[x&1],X,Y);continue}
      if(t===T.DUG){ctx.drawImage(tex.dug,X,Y);if(th)drawProp(th,x,y,X,Y,step);continue}
      if(t===T.GATE){ctx.drawImage(tex.gate[(x+(step>>2))&1],X,Y);
        if(hp[y]&&hp[y][x]<hpFor(T.GATE,y)){ctx.fillStyle="#fff";ctx.fillRect(X+2,Y+3,1,6);ctx.fillRect(X+3,Y+8,4,1);ctx.fillRect(X+8,Y+2,1,5)}continue}
      let img;
      if(t===T.DIRT||t===T.GEM||t===T.UXB||t===T.POWER)img=tex.dirt[v][layer];
      else if(t===T.CLAY)img=tex.clay[v];else if(t===T.ROCK)img=tex.rock[v];else if(t===T.BED)img=tex.bed[0];
      else if(t===T.TIMBER)img=tex.timber;else if(t===T.BOULDER)img=tex.dug;
      ctx.drawImage(img,X,Y);
      if(t===T.GEM){sprite(ctx,GEM,X+2,Y+3,false,CM);if(((step+x*7+y*3)%23)===0){ctx.fillStyle="#fff";ctx.fillRect(X+8,Y+1,1,3);ctx.fillRect(X+7,Y+2,3,1)}}
      if(t===T.POWER){const pulse=(step+x+y)%6<3;ctx.fillStyle=pulse?"#ffd400":"#ff2bd6";ctx.fillRect(X,Y,1,1);ctx.fillRect(X+TS-1,Y+TS-1,1,1);sprite(ctx,PGEM,X+1,Y+2,false,CM)}
      if(t===T.BOULDER){const u=unstable.get(x+","+y);const wob=u?((step%2)?1:-1):0;sprite(ctx,BOULDER,X+wob,Y+2,false,CM)}
      if(t===T.UXB){const f=fuses.find(f=>f.x===x&&f.y===y);sprite(ctx,UXB,X+1,Y+3,false,f&&step%2?{...CM,"#":"#ff2bd6","m":"#fff"}:CM)}
      // outline solid edges against air
      if(SOLID.has(t)&&t!==T.BED){ctx.fillStyle=INK;
        if(isAir(tile(x,y-1)))ctx.fillRect(X,Y,TS,1);if(isAir(tile(x,y+1)))ctx.fillRect(X,Y+TS-1,TS,1);
        if(isAir(tile(x-1,y)))ctx.fillRect(X,Y,1,TS);if(isAir(tile(x+1,y)))ctx.fillRect(X+TS-1,Y,1,TS)}
      // crack overlay
      if(SOLID.has(t)&&hp[y]&&hp[y][x]<hpFor(t,y)&&hp[y][x]>0){ctx.fillStyle="#fff";ctx.fillRect(X+3,Y+4,1,4);ctx.fillRect(X+4,Y+7,3,1);ctx.fillRect(X+7,Y+3,1,4)}
    }}
  drawTrenchDecor(cx,cy,step);
  // seam labels
  for(const s of seams){if(s.left<=0)continue;const X=s.x*TS-cx,Y=s.y*TS-cy;if(Y<-20||Y>VH+20)continue;
    const lab="$"+s.ticker;const w=PixFont.width(lab)+4;const lx=X+18-w/2;
    ctx.fillStyle=BLUE;ctx.fillRect(lx,Y-10,w,8);PixFont.draw(ctx,lab,lx+2,Y-9,"#fff");
    ctx.fillStyle=(step%4<2)?"#ff2bd6":"#ffd400";ctx.fillRect(lx+w/2|0,Y-2,1,2)}
  // falling boulders
  for(const f of falling)sprite(ctx,BOULDER,Math.round(f.x-cx),Math.round(f.y-cy)+2,false,CM);
  // shells + targets
  for(const s of shells){const X=Math.round(s.x-cx),Y=Math.round(s.y-cy);
    sprite(ctx,[".#.","###","###","#m#","###","d.d"],X-1,Y-3,false,CM);
    if(step%2===0){const gy=S*TS-cy;ctx.fillStyle="#ff2bd6";ctx.fillRect(X-4,gy-1,9,1);ctx.fillRect(X,gy-5,1,9);ctx.fillRect(X-3,gy-4,1,1);ctx.fillRect(X+3,gy-4,1,1)}}
  drawOtherPlayers(cx,cy,step);
  for(const rt of rats){const X=Math.round(rt.x-cx),Y=Math.round(rt.y-cy);sprite(ctx,RAT,X,Y,rt.face<0,{...CM,"#":rt.stun?"#ff2bd6":INK});
    if(rt.hp<rt.max){ctx.fillStyle="#ff2bd6";ctx.fillRect(X,Y-3,Math.max(1,Math.round(8*rt.hp/rt.max)),1)}}
  if(mode==="play"&&curLevel>1)drawDark(cx,cy,step);
  drawPlayer(cx,cy,step);
  // bullets
  for(const b of bullets){const X=Math.round(b.x-cx),Y=Math.round(b.y-cy);
    if(b.ghost){ctx.fillStyle="#ff2bd6";ctx.fillRect(X-(b.vx>0?7:0),Y,8,1);ctx.fillStyle="#fff";ctx.fillRect(X-(b.vx>0?4:0),Y+1,5,1);ctx.fillStyle="#ffd400";ctx.fillRect(b.vx>0?X:X-1,Y,1,2);continue}
    ctx.fillStyle=BLUE;ctx.fillRect(X-(b.vx>0?5:0),Y,6,2);ctx.fillStyle="#ffd400";ctx.fillRect(b.vx>0?X:X-1,Y,1,2)}
  // lane warnings
  for(const ln of lanes){if(ln.fired)continue;const Y=ln.row*TS+5-cy;if(step%2)continue;
    const ex=ln.dir>0?3:VW-12;ctx.fillStyle="#ff2bd6";PixFont.draw(ctx,ln.dir>0?">>!":"!<<",ex,Y-2,"#ff2bd6");
    ctx.fillStyle="rgba(255,43,214,.5)";for(let x=(step*3)%8;x<VW;x+=8)ctx.fillRect(x,Y,2,1)}
  // booms
  for(const b of booms){const X=b.x-cx,Y=b.y-cy,r=b.r*(.4+b.t*1.6);
    if(b.t<.22){const rr=b.r*(1.1-b.t*2),th=.75-b.t*3;ctx.fillStyle=b.t<.06?"#ffd400":BLUE;
      for(let yy=-rr;yy<=rr;yy++)for(let xx=-rr;xx<=rr;xx++)if(xx*xx+yy*yy<rr*rr&&bay(xx+64|0,yy+64|0)<th)ctx.fillRect(Math.round(X+xx),Math.round(Y+yy),1,1)}
    ctx.fillStyle=b.t<.08?"#fff":BLUE;
    for(let a=0;a<24;a++){const an=a/24*Math.PI*2;const rr=r*(.85+hash2(a,step,1)*.3);ctx.fillRect(Math.round(X+Math.cos(an)*rr),Math.round(Y+Math.sin(an)*rr),2,2)}
    if(b.t<.15){ctx.fillStyle="#ffd400";ctx.fillRect(X-r*.4,Y-r*.4,r*.8,r*.8)}}
  // particles
  for(const p of parts){ctx.fillStyle=p.c;ctx.fillRect(Math.round(p.x-cx),Math.round(p.y-cy),p.s,p.s)}
  // floating texts
  for(const t of texts){const Y=Math.round(t.y-cy-t.t*16),X=Math.round(t.x-cx);if(t.t>.8&&step%2)continue;
    const w=PixFont.width(t.s);ctx.fillStyle="#fff";ctx.fillRect(X-1,Y-1,w+2,7);PixFont.draw(ctx,t.s,X,Y,t.c)}
  // ambient glitch speckles (stepped, low fps)
  for(let i=0;i<7;i++){const h=hash2(step,i,77);const h2=hash2(i,step,78);ctx.fillStyle=SPK[(h*97|0)%4];ctx.fillRect((h*VW)|0,(h2*VH)|0,1,1)}
  // banner
  if(banner){const s=banner.s,sc=VW>300?2:1;const w=PixFont.width(s,sc);const X=(VW-w)/2|0,Y=(VH*.3)|0;
    if(!(banner.t>2.2&&step%2)){ctx.fillStyle=BLUE;ctx.fillRect(X-8,Y-6,w+16,5*sc+12);ctx.fillStyle="#fff";ctx.fillRect(X-6,Y-4,w+12,1);ctx.fillRect(X-6,Y+5*sc+4,w+12,1);
      PixFont.draw(ctx,s,X+(step%3===0?1:0),Y,"#fff",sc)}}
  if(flash>0){ctx.fillStyle="rgba(255,255,255,"+Math.min(.8,flash*5)+")";ctx.fillRect(0,0,VW,VH)}
  if(inv>0&&mode==="play"&&!dead&&step%2){ctx.fillStyle="rgba(255,43,214,.06)";ctx.fillRect(0,0,VW,VH)}
  if(glitch>0){for(let i=0;i<5;i++){const y=(Math.random()*VH)|0,h=2+((Math.random()*10)|0),dx=((Math.random()*2-1)*8)|0;ctx.drawImage(cv,0,y,VW,h,dx,y,VW,h)}
    ctx.fillStyle=SPK[(Math.random()*4)|0];for(let i=0;i<30;i++)ctx.fillRect((Math.random()*VW)|0,(Math.random()*VH)|0,2,1)}
  // Chat bubbles rendered on top of everything
  if(mode==="play")drawChatBubbles(cx,cy);
}
// Level 2+ is dark: you see a few tiles around you, Scouting widens it. Tile-sized dither = cheap.
let darkTex=null;
function drawDark(cx,cy,step){
  if(!darkTex){darkTex=[.82,.55,.3].map(th=>mk(g=>{for(let y=0;y<TS;y++)for(let x=0;x<TS;x++)if(bay(x,y)<th)px(g,x,y,INK)}))}
  const sight=5+fx.reveal,pcx=(P.x+P.w/2)/TS,pcy=(P.y+P.h/2)/TS;
  const x0=Math.floor(cx/TS)-1,x1=Math.floor((cx+VW)/TS)+1,y0=Math.max(FLOOR,Math.floor(cy/TS)),y1=Math.floor((cy+VH)/TS)+1;
  for(let y=y0;y<=y1;y++){if(levelOfRow(y)<2)continue;for(let x=x0;x<=x1;x++){const d=Math.hypot(x+.5-pcx,y+.5-pcy)-sight;if(d<0)continue;
    ctx.drawImage(darkTex[d>2.2?0:d>1?1:2],x*TS-cx,y*TS-cy)}}
  // compass to the level floor (Scouting 2+)
  if(fx.compass&&LV){const left=LV.levelFloorDepth(curLevel)-maxDepth;if(left>0){const s="FLOOR "+left+"M";const w=PixFont.width(s)+4;ctx.fillStyle=INK;ctx.fillRect(VW-w-3,VH-11,w,8);PixFont.draw(ctx,s,VW-w-1,VH-10,"#16e0ff")}}
}
function drawSky(cx,cy,step){
  const gy=S*TS-cy;if(gy<0)return;
  // distant ridge (parallax), dithered, cached
  if(!ridge){ridge=document.createElement("canvas");ridge.width=1024;ridge.height=40;const g=ridge.getContext("2d");g.fillStyle=PALE;
    for(let x=0;x<1024;x++){const h=10+Math.floor(vnoise(x*.03,0,5)*16+vnoise(x*.11,1,6)*6);for(let y=40-h;y<40;y++)if(bay(x,y)<.18+(y-(40-h))/h*.12)g.fillRect(x,y,1,1)}}
  const par=Math.floor(cx*.4);const off=((par%1024)+1024)%1024;
  for(let x=-off;x<VW;x+=1024)ctx.drawImage(ridge,x,gy-40);
  // ruined posts + barbed wire
  const par2=cx*.7;ctx.fillStyle=BLUE;
  for(let i=-1;i<VW/38+2;i++){const wx=Math.floor(par2/38)*38+i*38;const X=Math.round(wx-par2);const hh=6+((hash2(wx,0,9)*6)|0);
    ctx.fillRect(X,gy-hh,1,hh);ctx.fillRect(X-1,gy-hh+1,3,1);
    for(let k=0;k<38;k+=3){const yy=gy-hh+2+Math.round(Math.sin((k+wx)*.5)*1.5+k*.08);if((k+step)%5)ctx.fillRect(X+k,yy,1,1);if(k%9===0){ctx.fillRect(X+k-1,yy-1,1,1);ctx.fillRect(X+k+1,yy+1,1,1)}}}
  // smoke puffs (stepped)
  for(let i=0;i<4;i++){const wx=((i*137+step*.6)%(VW+80))-40;const wy=gy-34-i*9-((step+i*5)%8);const r=6+i%3*2;
    for(let yy=-r;yy<=r;yy++)for(let xx=-r;xx<=r;xx++)if(xx*xx+yy*yy<r*r&&bay(xx+40,yy+40)<.18){ctx.fillStyle=PALE;ctx.fillRect(Math.round(wx+xx),wy+yy,1,1)}}
  // ground line + sandbag parapet
  for(let X=-((cx%10+10)%10)-10;X<VW+10;X+=10){const wy=gy-5;ctx.fillStyle="#fff";ctx.fillRect(X,wy,10,5);ctx.fillStyle=BLUE;
    ctx.fillRect(X+1,wy,8,1);ctx.fillRect(X,wy+1,1,3);ctx.fillRect(X+9,wy+1,1,3);ctx.fillRect(X+1,wy+4,8,1);ctx.fillStyle=TAN;ctx.fillRect(X+2,wy+2,5,1)}
  ctx.fillStyle=BLUE;ctx.fillRect(0,gy,VW,1);
}
function drawTrenchDecor(cx,cy,step){
  const top=S*TS-cy;if(top>VH||top<-80)return;
  for(const b of bunkers){const X=b.col*TS-cx;if(X<-40||X>VW+40)continue;
    // doorway
    ctx.fillStyle=BLUE;ctx.fillRect(X,top+3,24,21);ctx.fillStyle="#fff";ctx.fillRect(X+3,top+6,18,18);
    for(let y=0;y<18;y++)for(let x=0;x<18;x++)if(bay(x,y)<.55){ctx.fillStyle=BLUE2;ctx.fillRect(X+3+x,top+6+y,1,1)}
    ctx.fillStyle=BROWN;ctx.fillRect(X-1,top+2,26,2);ctx.fillRect(X,top+4,2,20);ctx.fillRect(X+22,top+4,2,20);
    ctx.fillStyle=step%6?"#ffd400":"#fff";ctx.fillRect(X+11,top+9,2,2);
    // signpost
    const w=PixFont.width(b.label)+6,sx=X+12-w/2|0;ctx.fillStyle=BROWN;ctx.fillRect(X+11,top-16,2,18);
    ctx.fillStyle=BLUE;ctx.fillRect(sx,top-23,w,9);PixFont.draw(ctx,b.label,sx+3,top-21,"#fff");
    const nb=nearBunker();if(nb===b&&mode==="play"&&step%2===0){ctx.fillStyle="#ff2bd6";ctx.fillRect(sx-2,top-24,w+4,1);ctx.fillRect(sx-2,top-14,w+4,1);ctx.fillRect(sx-2,top-24,1,11);ctx.fillRect(sx+w+1,top-24,1,11)}
  }
}
function drawPlayer(cx,cy,step){
  if(mode==="over"&&!dead)return;
  if(inv>0&&step%2&&mode==="play"&&!dead)return;
  const X=Math.round(P.x-cx)-1,Y=Math.round(P.y-cy);const f=P.face<0;
  if(dead){ // tumbling
    if(step%2)return;
  }
  const moving=Math.abs(P.vx)>8&&P.ground;
  const legs=!P.ground?LEGS[1]:moving?LEGS[1+((P.walk|0)%2)]:LEGS[0];
  for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1]]){sprite(ctx,SOLDIER_TOP,X+ox,Y+oy,f,WHITE);sprite(ctx,legs,X+ox,Y+9+oy,f,WHITE)}
  sprite(ctx,SOLDIER_TOP,X,Y,f,CM);
  sprite(ctx,legs,X,Y+9,f,CM);
  // pickaxe
  let ang;const sw=P.swing/.18;
  if(P.swing>0){const end=P.aim==="down"?1.5:P.aim==="up"?-1.4:.25;const start=-2.3;ang=end+(start-end)*sw*sw}
  else ang=P.climb?-1.2:-2.2+Math.sin(time*3)*.05;
  const hx=X+(f?2:7),hy=Y+7;const dir=f?-1:1;
  const ex=hx+Math.cos(ang)*8*dir,ey=hy+Math.sin(ang)*8;
  const n=8;for(let i=0;i<=n;i++){const x=Math.round(hx+(ex-hx)*i/n),y=Math.round(hy+(ey-hy)*i/n);ctx.fillStyle=i%3===1?"#16e0ff":(i%2?PALE:BLUE);ctx.fillRect(x,y,1,1)}
  const pxn=-Math.sin(ang)*dir,pyn=Math.cos(ang);
  ctx.fillStyle=BLUE;for(let k=-3;k<=3;k++){const x=Math.round(ex+pxn*k+Math.cos(ang)*dir*(Math.abs(k)>2?-1:0)),y=Math.round(ey+pyn*k+Math.sin(ang)*(Math.abs(k)>2?-1:0));ctx.fillRect(x,y,1,1);if(Math.abs(k)<2)ctx.fillRect(x+(dir>0?0:0),y,2,1)}
  if(P.swing>.1){ctx.fillStyle="#fff";ctx.fillRect(Math.round(ex),Math.round(ey),1,1)}
  // aim indicator
  if(mode==="play"&&!dead){const [tx,ty]=digTarget();if(solidAt(tx,ty)&&step%4<3){const X2=tx*TS-cx,Y2=ty*TS-cy;ctx.fillStyle="#ff2bd6";
    ctx.fillRect(X2,Y2,3,1);ctx.fillRect(X2,Y2,1,3);ctx.fillRect(X2+TS-3,Y2,3,1);ctx.fillRect(X2+TS-1,Y2,1,3);ctx.fillRect(X2,Y2+TS-1,3,1);ctx.fillRect(X2,Y2+TS-3,1,3);ctx.fillRect(X2+TS-3,Y2+TS-1,3,1);ctx.fillRect(X2+TS-1,Y2+TS-3,1,3)}}
}

// Draw other players (multiplayer ghosts)
// NPC recruits: khaki/grey palette so they never pass for real players.
const BOT_CM={"#":"rgba(120,128,96,0.75)","w":"rgba(255,255,255,0.7)","d":"rgba(70,76,56,0.75)","c":"rgba(180,190,160,0.7)","m":"rgba(150,150,150,0.6)","y":"rgba(210,200,140,0.7)","b":"rgba(138,90,43,0.6)","t":"rgba(201,162,122,0.6)","p":"rgba(220,220,210,0.7)"};
const GHOST_CM={"#":"rgba(0,82,255,0.5)","w":"rgba(255,255,255,0.6)","d":"rgba(11,26,143,0.5)","c":"rgba(22,224,255,0.5)","m":"rgba(255,43,214,0.5)","y":"rgba(255,212,0,0.5)","b":"rgba(138,90,43,0.5)","t":"rgba(201,162,122,0.5)","p":"rgba(201,214,255,0.5)"};
let ownChatText=null,ownChatTime=0;
function setOwnChat(text){ownChatText=text;ownChatTime=Date.now()}
function drawOtherPlayers(cx,cy,step){
  if(typeof Multiplayer==='undefined'||!Multiplayer.connected)return;
  const players=Multiplayer.players;
  players.forEach(p=>{
    if(!p.x&&p.x!==0)return;
    const X=Math.round(p.x-cx)-1,Y=Math.round(p.y-cy);
    const f=p.face<0;
    const moving=Math.abs(p.vx||0)>8;
    const legs=moving?LEGS[1+((step/3|0)%2)]:LEGS[0];
    // Draw ghost with transparency
    const cm=p.bot?BOT_CM:GHOST_CM;
    sprite(ctx,SOLDIER_TOP,X,Y,f,cm);
    sprite(ctx,legs,X,Y+9,f,cm);
    if(p.bot&&p.swing&&(step/4|0)%2){ctx.fillStyle="rgba(70,76,56,0.8)";ctx.fillRect(X+(f?-3:10),Y+4,3,2)}
    // Name tag (recruits: grey tag with a BOT prefix)
    if(p.bot&&p.name){
      const name="BOT "+(p.name.length>10?p.name.slice(0,9)+'…':p.name).toUpperCase();
      const tw=PixFont.width(name)+4;
      ctx.fillStyle="rgba(70,76,56,0.85)";
      ctx.fillRect(X+5-tw/2|0,Y-10,tw,7);
      PixFont.draw(ctx,name,X+7-tw/2|0,Y-9,"#fff");
    }else if(p.name){
      const name=(p.name.length>10?p.name.slice(0,9)+'…':p.name).toUpperCase();
      const tw=PixFont.width(name)+4;
      ctx.fillStyle="rgba(255,255,255,0.8)";
      ctx.fillRect(X+5-tw/2|0,Y-10,tw,7);
      PixFont.draw(ctx,name,X+7-tw/2|0,Y-9,BLUE);
      // Level badge
      if(p.level>1){
        ctx.fillStyle=BLUE;ctx.fillRect(X+5+tw/2|0,Y-10,12,7);
        PixFont.draw(ctx,"L"+p.level,X+7+tw/2|0,Y-9,"#fff");
      }
    }
  });
}

// Draw chat bubbles above everything (called after all other rendering)
function drawChatBubbles(cx,cy){
  const now=Date.now();
  const bubbles=[];
  // Other players' bubbles
  if(typeof Multiplayer!=='undefined'&&Multiplayer.connected){
    Multiplayer.players.forEach(p=>{
      if(p.chatText&&p.chatTime&&now-p.chatTime<4000){
        const age=(now-p.chatTime)/4000;
        bubbles.push({x:p.x,y:p.y,text:p.chatText,name:p.name,age,own:false,bot:!!p.bot});
      }
    });
  }
  // Own chat bubble
  if(ownChatText&&now-ownChatTime<4000){
    const age=(now-ownChatTime)/4000;
    bubbles.push({x:P.x,y:P.y,text:ownChatText,name:'YOU',age,own:true});
  }
  // Draw all bubbles
  for(const b of bubbles){
    const X=Math.round(b.x-cx),Y=Math.round(b.y-cy);
    const txt=(b.text.length>24?b.text.slice(0,23)+'…':b.text).toUpperCase();
    const tw=PixFont.width(txt);
    const bw=tw+12,bh=14;
    // Clamp to screen edges
    let bx=X+5-bw/2;
    bx=Math.max(2,Math.min(VW-bw-2,bx));
    let by=Y-28;
    by=Math.max(2,by);
    // Pop-in animation (scale from 0.5 to 1 in first 150ms)
    const popT=Math.min(1,(now-(b.own?ownChatTime:0))/150);
    const scale=0.5+0.5*popT;
    // Fade out in last 500ms
    const fade=b.age>0.875?1-(b.age-0.875)/0.125:1;
    ctx.globalAlpha=fade;
    // Draw bubble with thick border
    ctx.fillStyle="#fff";
    ctx.fillRect(bx|0,by|0,bw,bh);
    ctx.fillStyle=BLUE;
    // Thick 2px border
    ctx.fillRect(bx|0,by|0,bw,2);ctx.fillRect(bx|0,(by+bh-2)|0,bw,2);
    ctx.fillRect(bx|0,by|0,2,bh);ctx.fillRect((bx+bw-2)|0,by|0,2,bh);
    // Tail pointing down to digger
    const tailX=(X+5)|0;
    ctx.fillStyle="#fff";
    ctx.fillRect(tailX-3,(by+bh)|0,6,3);
    ctx.fillRect(tailX-2,(by+bh+3)|0,4,2);
    ctx.fillRect(tailX-1,(by+bh+5)|0,2,1);
    ctx.fillStyle=BLUE;
    ctx.fillRect(tailX-3,(by+bh)|0,2,3);ctx.fillRect(tailX+1,(by+bh)|0,2,3);
    ctx.fillRect(tailX-2,(by+bh+3)|0,1,2);ctx.fillRect(tailX+1,(by+bh+3)|0,1,2);
    ctx.fillRect(tailX-1,(by+bh+5)|0,1,1);ctx.fillRect(tailX,(by+bh+5)|0,1,1);
    // Text
    PixFont.draw(ctx,txt,(bx+6)|0,(by+4)|0,BLUE);
    // Name badge (small, top-left of bubble)
    if(b.name){
      const nm=(b.own?'YOU':(b.bot?'BOT ':'')+b.name.slice(0,8)).toUpperCase();
      const nw=PixFont.width(nm)+4;
      ctx.fillStyle=b.own?'#ff2bd6':b.bot?'#4a5038':BLUE;
      ctx.fillRect((bx-1)|0,(by-6)|0,nw,7);
      PixFont.draw(ctx,nm,(bx+1)|0,(by-5)|0,'#fff');
    }
    ctx.globalAlpha=1;
  }
}

// ---------- hud / stats ----------
let lastHud="";
function hud(force){const s=lives+"|"+mult.toFixed(2)+"|"+maxDepth+"|"+curLevel;if(!force&&s===lastHud)return;lastHud=s;
  const th=levelsOn&&LV?LV.themeFor(curLevel):null;
  cb.onHud&&cb.onHud({lives,mult,depth:maxDepth,goal:Math.min(1,Math.log(mult)/Math.log(GOAL)),level:curLevel,levelsOn,theme:th?th.displayName:null})}
function best(){const b=+localStorage.getItem("bt_best")||1;if(mult>b)localStorage.setItem("bt_best",mult.toFixed(2))}
function stats(){return{mult,depth:maxDepth,gems,powerGems,time:runTime,best:Math.max(mult,+localStorage.getItem("bt_best")||1),digs:sessionDigs,level:curLevel}}
// Save game: the run snapshot the server validates (see server/lib/save.js).
function snapshot(force){
  if(!P||(mode!=="play"&&!(force&&mode==="over")))return null;
  return{runId,x:Math.round(P.x),y:Math.round(P.y),lives,gems,powerGems,maxDepth,mult:Math.round(mult*100)/100,runTime:Math.round(runTime*10)/10,
    depthBonusAt,seed,secondWindUsed,level:curLevel,dead:dead>0||lives<=0};
}
function startFrom(sv){
  Sfx.unlock();
  if(sv&&sv.seed!=null&&Number.isFinite(+sv.seed))sharedSeed=+sv.seed;
  newRun();mode="play";paused=false;
  if(sv){
    runId=sv.runId||runId;P.x=+sv.x||P.x;P.y=+sv.y||P.y;
    lives=Math.max(1,Math.min(9,sv.lives|0||9));gems=sv.gems|0;powerGems=sv.powerGems|0;maxDepth=sv.maxDepth|0;lastDepthXp=maxDepth;
    mult=Math.max(1,+sv.mult||1);runTime=+sv.runTime||0;depthBonusAt=sv.depthBonusAt|0||25;secondWindUsed=!!sv.secondWindUsed;
    for(const m of [9,58.9,100,589])if(mult>=m)milestones.add(m);
    // carve a pocket where the trencher stood (the world regenerates around a save)
    const x0=Math.floor(P.x/TS),x1=Math.floor((P.x+P.w-.01)/TS),y0=Math.floor(P.y/TS),y1=Math.floor((P.y+P.h-.01)/TS);
    for(let y=y0-1;y<=y1;y++)for(let x=x0;x<=x1;x++){const t=tile(x,y);if(y>=FLOOR&&t!==T.BED&&SOLID.has(t))setTile(x,y,T.DUG)}
    if(!solidAt(x0,y1+1)&&!solidAt(x1,y1+1)&&y1+1>FLOOR)setTile(x0,y1+1,T.DIRT);
    const depth=Math.max(0,Math.floor((P.y+P.h)/TS)-FLOOR);curLevel=levelOfDepth(depth);
    inv=2;cam.x=P.x-VW/2;cam.y=P.y-VH*.5;clampCam(true);
    showBanner((sv.checkpoint?"CHECKPOINT":"RESUMED")+(levelsOn?" · LEVEL "+curLevel:" · "+depth+"M"));
  }
  hud(true);
}
function endSession(){
  // RPG: save stats on game over
  if(typeof RPG!=='undefined'){
    RPG.updateStats({depth:maxDepth,diamonds:gems+powerGems,digs:sessionDigs,died:true,playTime:Date.now()-sessionStart});
    RPG.saveToServer();
  }
  if(typeof Multiplayer!=='undefined')Multiplayer.flushXp(maxDepth);
}

// ---------- loop / sizing ----------
function resize(){
  const r=cv.parentElement.getBoundingClientRect();const dpr=window.devicePixelRatio||1;
  const dw=r.width*dpr,dh=r.height*dpr;
  SCALE=Math.max(1,Math.floor(Math.min(dw/200,dh/200)));
  VW=Math.ceil(dw/SCALE);VH=Math.ceil(dh/SCALE);cv.width=VW;cv.height=VH;
  cv.style.width=(VW*SCALE/dpr)+"px";cv.style.height=(VH*SCALE/dpr)+"px";
  ctx.imageSmoothingEnabled=false;clampCam(true);
}
let acc=0,lastT=0;
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(.1,(now-lastT)/1000||0);lastT=now;
  if(!paused){acc+=dt;let n=0;while(acc>=1/60&&n<5){update(1/60);acc-=1/60;n++}if(n===5)acc=0}
  draw();
}
function onKey(e,down){
  const m={ArrowLeft:"left",KeyA:"left",ArrowRight:"right",KeyD:"right",ArrowUp:"up",KeyW:"up",ArrowDown:"down",KeyS:"down",Space:"dig",KeyJ:"dig",KeyE:"enter",Enter:"enter",KeyF:"build",KeyK:"build"};
  const k=m[e.code];if(!k)return;
  if(e.target&&/INPUT|TEXTAREA/.test(e.target.tagName))return;
  if(mode==="play"&&!paused)e.preventDefault();
  setKey(k,down);
}
function setKey(k,down){if(down&&!keys[k])pressed[k]=true;keys[k]=down}

const Game={
  init(canvas,callbacks){cv=canvas;ctx=cv.getContext("2d",{alpha:false});cb=callbacks||{};buildTextures();resize();newRun();
    window.addEventListener("resize",resize);addEventListener("keydown",e=>onKey(e,true));addEventListener("keyup",e=>onKey(e,false));
    addEventListener("blur",()=>{for(const k in keys)keys[k]=false});
    cv.addEventListener("click",e=>{const r=cv.getBoundingClientRect();const x=(e.clientX-r.left)/r.width*VW+cam.x,y=(e.clientY-r.top)/r.height*VH+cam.y;
      for(const b of bunkers){const top=S*TS;if(x>b.col*TS-8&&x<(b.col+2)*TS+8&&y>top-26&&y<top+24){cb.onOpen&&cb.onOpen(b.id);return}}});
    requestAnimationFrame(frame)},
  setHotList(l){hotList=l;newRun()},
  // Multiplayer: adopt the room's world seed (regenerates the trench unless a run is in progress)
  setSeed(s){if(sharedSeed===s)return;sharedSeed=s;if(mode!=="play")newRun()},
  applyRemoteDig,
  setOwnChat,
  start(){Sfx.unlock();newRun();mode="play";paused=false;hud(true)},
  pause(p){paused=p;if(p)for(const k in keys)keys[k]=false},
  get mode(){return mode},
  setKey,
  findTicker(t){const s=seams.find(s=>s.ticker===t&&s.left>0);return s?(s.y-FLOOR):null},
  snapshot,
  startFrom,
  setLevelsEnabled(on){on=!!on&&!!LV;if(on===levelsOn)return;levelsOn=on;if(mode!=="play")newRun()},
  get levelsEnabled(){return levelsOn},
  setSkills(sk){fx=window.BTSkills&&sk?window.BTSkills.skillEffects(sk):NOFX},
  get skillFx(){return fx},
  get level(){return curLevel},
  get runId(){return runId},
  _debug:{get P(){return P},explode,get state(){return{mult,lives,maxDepth,curLevel,rats:rats.length}},bump,showBanner,hurt,setInv:v=>inv=v,
    // preview/screenshot helper: put the trencher at a depth in an open pocket
    goDepth(d){const y=(FLOOR+d)*TS-P.h;P.y=y;P.vy=0;const tx=Math.floor((P.x+4)/TS);for(let r=FLOOR+d-2;r<FLOOR+d;r++){const t=tile(tx,r);if(t!==T.BED)setTile(tx,r,T.DUG)}
      if(!solidAt(tx,FLOOR+d))setTile(tx,FLOOR+d,T.DIRT);clampCam(true)},
    tile,T}
};
window.Game=Game;
})();
