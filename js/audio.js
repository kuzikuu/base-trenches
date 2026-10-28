// WebAudio chiptune blips. No assets.
(function(){
let ctx=null,master=null,muted=localStorage.getItem("bt_muted")==="1";
function ensure(){
  if(!ctx){try{ctx=new (window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();master.gain.value=muted?0:.22;master.connect(ctx.destination);}catch(e){return null}}
  if(ctx.state==="suspended")ctx.resume();return ctx;
}
function tone(f,dur,type,vol,slide,delay){
  const c=ensure();if(!c||muted)return;
  const t=c.currentTime+(delay||0);const o=c.createOscillator(),g=c.createGain();
  o.type=type||"square";o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,slide),t+dur);
  g.gain.setValueAtTime(vol||.5,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
  o.connect(g);g.connect(master);o.start(t);o.stop(t+dur+.02);
}
let noiseBuf=null;
function noise(dur,vol,lp,delay){
  const c=ensure();if(!c||muted)return;
  if(!noiseBuf){noiseBuf=c.createBuffer(1,c.sampleRate,c.sampleRate);const d=noiseBuf.getChannelData(0);let v=0;for(let i=0;i<d.length;i++){if(i%4===0)v=Math.random()*2-1;d[i]=v}}
  const t=c.currentTime+(delay||0);const s=c.createBufferSource();s.buffer=noiseBuf;
  const f=c.createBiquadFilter();f.type="lowpass";f.frequency.setValueAtTime(lp||3000,t);f.frequency.exponentialRampToValueAtTime(80,t+dur);
  const g=c.createGain();g.gain.setValueAtTime(vol||.6,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
  s.connect(f);f.connect(g);g.connect(master);s.start(t);s.stop(t+dur+.02);
}
const S={
  dig(h){noise(.07,.35,h?900:1800);tone(h?90:140,.05,"square",.18,60)},
  clink(){tone(1400,.05,"square",.15,900);noise(.04,.2,5000)},
  jump(){tone(260,.12,"square",.22,520)},
  land(){noise(.05,.2,600)},
  gem(n){const b=[523,659,784,1047];b.forEach((f,i)=>tone(f*(1+(n||0)*.03),.09,"square",.22,null,i*.045))},
  power(){[392,523,659,784,1047,1319].forEach((f,i)=>tone(f,.12,"square",.25,null,i*.06));noise(.3,.15,8000,.3)},
  hit(){tone(220,.25,"sawtooth",.35,55);noise(.15,.4,2000)},
  whistle(){tone(1800,.9,"sine",.12,500)},
  boom(){noise(.7,.9,1600);tone(70,.5,"square",.4,30)},
  ping(){tone(2400,.03,"square",.06,1800)},
  sweep(){tone(880,.08,"square",.15,null);tone(880,.08,"square",.15,null,.16)},
  over(){[392,330,262,196].forEach((f,i)=>tone(f,.22,"square",.25,f*.9,i*.18))},
  ui(){tone(660,.05,"square",.15,null)},
  milestone(){[523,523,784,1047].forEach((f,i)=>tone(f,.1,"square",.22,null,i*.08))}
};
window.Sfx={
  play(n,a){try{S[n]&&S[n](a)}catch(e){}},
  unlock(){ensure()},
  get muted(){return muted},
  toggle(){muted=!muted;localStorage.setItem("bt_muted",muted?"1":"0");if(master)master.gain.value=muted?0:.22;if(!muted){ensure();S.ui()}return muted}
};
})();
