// Tumbling dithered entrenching-pick, rendered as a 3D point cloud into a low-res
// buffer with ordered dithering + vertical scanlines (the TRENCHER PROGRAM look).
(function(){
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(v=>(v+.5)/16);
const SPECK=["#22e36b","#ffd400","#ff2bd6","#16e0ff"];
let MODEL=null;
function buildModel(){
  const P=[];// [x,y,z,nx,ny,nz,mat]  model roughly centred on origin
  const OY=-.04;
  // handle: tapered cylinder along y
  for(let y=-1.0;y<=.62;y+=.006){
    const r=.05+(y+1)*.008+(y<-.9?.015:0);
    for(let a=0;a<Math.PI*2;a+=Math.PI/12){const c=Math.cos(a),s=Math.sin(a);P.push([c*r,y+OY,s*r,c,0,s,0])}
  }
  // head collar (box-ish)
  for(let y=.55;y<=.82;y+=.006)for(let a=0;a<Math.PI*2;a+=Math.PI/16){const c=Math.cos(a),s=Math.sin(a);P.push([c*.11,y+OY,s*.11,c,0,s,1])}
  // pick spike (to -x): thick, tapering, curving down
  for(let u=0;u<=1;u+=.005){
    const x=-.08-u*.62,yc=.7-u*u*.22,r=.1*(1-u*.85);
    for(let a=0;a<Math.PI*2;a+=Math.PI/12){const c=Math.cos(a),s=Math.sin(a);P.push([x,yc+c*r+OY,s*r,0,c,s,1])}
  }
  // spade blade (to +x): broad flat plate, slightly curved, with thickness
  for(let u=0;u<=1;u+=.005){
    const x=.08+u*.6,yc=.7-u*u*.18,w=.12+Math.sin(Math.min(1,u*1.6)*Math.PI/2)*.32;
    for(let v=-1;v<=1;v+=.02){const z=v*w;
      P.push([x,yc+.045+OY,z,0,1,.15*v,1]);P.push([x,yc-.045+OY,z,0,-1,.15*v,1]);}
    // rim
    for(let k=-1;k<=1;k+=.25){P.push([x,yc+k*.045+OY,w,0,0,1,1]);P.push([x,yc+k*.045+OY,-w,0,0,-1,1])}
  }
  for(let v=-1;v<=1;v+=.01){const w=.44;for(let k=-1;k<=1;k+=.25)P.push([.68,.52+k*.045+OY,v*w,1,0,0,1])}
  return P;
}
function render(ctx,W,H,t,opt){
  if(!MODEL)MODEL=buildModel();
  opt=opt||{};
  const img=ctx.createImageData(W,H),d=img.data;
  const z=new Float32Array(W*H).fill(-1e9),I=new Float32Array(W*H),M=new Int8Array(W*H).fill(-1);
  const ay=t*1.7,ax=Math.sin(t*.9)*.9+.4,az=t*1.1;
  const cy=Math.cos(ay),sy=Math.sin(ay),cx=Math.cos(ax),sx=Math.sin(ax),cz=Math.cos(az),sz=Math.sin(az);
  const sc=W*.52,ox=W/2,oy=H/2;
  const L=[-.4,.6,.7];
  for(const p of MODEL){
    let x=p[0],y=p[1]-.0,zz=p[2],nx=p[3],ny=p[4],nz=p[5];
    // rotate z
    let x1=x*cz-y*sz,y1=x*sz+y*cz;let nx1=nx*cz-ny*sz,ny1=nx*sz+ny*cz;
    // rotate y
    let x2=x1*cy+zz*sy,z2=-x1*sy+zz*cy;let nx2=nx1*cy+nz*sy,nz2=-nx1*sy+nz*cy;
    // rotate x
    let y3=y1*cx-z2*sx,z3=y1*sx+z2*cx;let ny3=ny1*cx-nz2*sx,nz3=ny1*sx+nz2*cx;
    const persp=1/(1.9-z3*.35);
    const px=(ox+x2*sc*persp*1.6)|0,py=(oy-y3*sc*persp*1.6)|0;
    let li=Math.abs(nx2*L[0]+ny3*L[1]+nz3*L[2]);li=.25+.75*li;
    for(let k=0;k<2;k++)for(let j=0;j<2;j++){
      const X=px+k,Y=py+j;if(X<0||Y<0||X>=W||Y>=H)continue;const i=Y*W+X;
      if(z3>z[i]){z[i]=z3;I[i]=li;M[i]=p[6]}
    }
  }
  const frame=(t*10)|0;
  for(let Y=0;Y<H;Y++)for(let X=0;X<W;X++){
    const i=Y*W+X,m=M[i];if(m<0)continue;
    const th=BAYER[(Y&3)*4+(X&3)];let on=false,col=[0,82,255];
    if(m===1){ // head: heavy blue, vertical scanlines
      on=(X%2===0)?I[i]>th*.35:I[i]>.55+th*.45;
      if(I[i]>.92&&th>.7){col=[255,255,255];on=true}
    }else{ // handle: pale, sparse dots
      on=I[i]*.8>th;col=(X%2)?[120,150,255]:[0,82,255];
      const h=(X*73856093^Y*19349663^frame*83492791)>>>0;
      if(h%23===0){on=true;const c=SPECK[h%4];col=[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]}
    }
    if(!on)continue;
    d[i*4]=col[0];d[i*4+1]=col[1];d[i*4+2]=col[2];d[i*4+3]=255;
  }
  // sparse glitch speckles around
  const n=opt.speckles??14;
  for(let s=0;s<n;s++){
    const h=((frame*2654435761)^(s*40503))>>>0;const X=h%W,Y=(h>>>11)%H;const i=Y*W+X;
    const c=SPECK[(h>>>5)%4];d[i*4]=parseInt(c.slice(1,3),16);d[i*4+1]=parseInt(c.slice(3,5),16);d[i*4+2]=parseInt(c.slice(5,7),16);d[i*4+3]=255;
  }
  ctx.putImageData(img,0,0);
}
function attach(canvas,opt){
  opt=opt||{};const res=opt.res||110;
  const off=document.createElement("canvas");off.width=res;off.height=res;const octx=off.getContext("2d");
  const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;
  let run=true,last=0;const fps=opt.fps||10,t0=performance.now();
  function loop(now){
    if(!run)return;requestAnimationFrame(loop);
    if(now-last<1000/fps)return;last=now;
    if(canvas.offsetParent===null&&!opt.always)return;
    const t=Math.floor((now-t0)/(1000/fps))/fps;
    render(octx,res,res,t*(opt.speed||1),opt);
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
    ctx.drawImage(off,0,0,canvas.width,canvas.height);
  }
  requestAnimationFrame(loop);
  return ()=>{run=false};
}
window.Pickaxe={attach,render};
})();
