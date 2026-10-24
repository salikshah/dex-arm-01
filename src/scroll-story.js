// Twenty-second native-scroll tour. Keep the 15-second film independently usable.
import * as THREE from 'three';
import { ShortStory } from './short-story.js?v=scroll-20261013';
import { GESTURES, ARM_POSES } from './pose.js?v=short-20261012';
const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=v=>{const u=clamp(v);return u*u*u*(u*(u*6-15)+10);};
const TAU=2*Math.PI, EXPLODE=10.4, FLAT=12.4, FINISH=13.8, COLOR=16.9;
const CHAPTERS=[
  ['gesture','Three → One',1.2],['palm','Palm details',2],
  ['wrist','Wrist',1.8],['forearm','Forearm',2],['upper','Upper arm',2],
  ['whole','Whole form',1.4],['explode','Parts laid out',2],
  ['reassemble','Reassemble',1.4],['glacier','Ice blue · 360°',3.1],['amber','Amber · 360°',3.1],
].map(([id,label,duration])=>({id,label,duration}));
const POSES=[[0,'three'],[.30,'three'],[.55,'one'],[.95,'one'],[1.45,'open'],[8.8,'open'],[9.7,'one'],[20,'one']];
const corners=box=>{const p=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])p.push(new THREE.Vector3(x,y,z));return p;};

// Shape-preserving cubic interpolation: shared velocities at shot boundaries,
// no overshoot past a mechanical section and no stop at every chapter marker.
function interpolate(keys,t,field){
  let i=0;while(i<keys.length-2&&t>keys[i+1].time)i++;
  const slope=j=>(keys[j+1][field]-keys[j][field])/(keys[j+1].time-keys[j].time);
  const tangent=j=>{
    if(j===0||j===keys.length-1)return 0;
    const a=slope(j-1),b=slope(j);if(a*b<=0)return 0;
    const h0=keys[j].time-keys[j-1].time,h1=keys[j+1].time-keys[j].time;
    const w0=2*h1+h0,w1=h1+2*h0;return (w0+w1)/(w0/a+w1/b);
  };
  const a=keys[i],b=keys[i+1],h=b.time-a.time,u=clamp((t-a.time)/h);
  return (2*u**3-3*u*u+1)*a[field]+(u**3-2*u*u+u)*h*tangent(i)
    +(-2*u**3+3*u*u)*b[field]+(u**3-u*u)*h*tangent(i+1);
}

export class ScrollStory extends ShortStory {
  constructor(ctx){super({...ctx,chapters:CHAPTERS,duration:20});this.scrollFilm=true;}
  enter(){super.enter();this._scrollTrack=null;this._lastScrollPose=null;}
  _scorePose(progress){
    const time=progress*20;let i=0;while(i<POSES.length-2&&time>=POSES[i+1][0])i++;
    const a=POSES[i],b=POSES[i+1],u=smooth((time-a[0])/(b[0]-a[0]));
    this.pose.cancelMotion();this.pose.curl=0;this.pose.armAngles=[...ARM_POSES.rest.angles];
    this.pose.handAngles=GESTURES[a[1]].hand.map((v,j)=>THREE.MathUtils.lerp(v,GESTURES[b[1]].hand[j],u));
    this.pose.gesture=u<.5?a[1]:b[1];this.pose.apply();
  }
  _separation(t){
    if(t<EXPLODE||t>=FINISH)return 0;
    return t<=FLAT?Math.sin((t-EXPLODE)/(FLAT-EXPLODE)*Math.PI/2):Math.cos((t-FLAT)/(FINISH-FLAT)*Math.PI/2);
  }
  _buildScrollTrack(){
    super._buildCameraTrack();
    const {whole,close,detail,direction}=this._cameraTrack;
    const fore=this._fitPoints(corners(this._anchors.forearm),direction,.82);
    const upper=this._fitPoints(corners(this._anchors.upper),direction,.83);
    const wrist={tgt:close.tgt.clone().lerp(fore.tgt,.43),dist:close.dist*1.15};
    const frames=[[0,close],[1.1,{tgt:close.tgt,dist:close.dist*.96}],
      [2.6,detail],[4.2,wrist],[6.2,fore],[8.2,upper],[EXPLODE,whole]];
    this._scrollTrack=frames.map(([time,f])=>({time,x:f.tgt.x,y:f.tgt.y,z:f.tgt.z,zoom:Math.log(f.dist)}));
    this._setParts(this._separation(this.progress*20));
  }
  _orbitTurn(t){
    if(t<FINISH)return 0;
    const duration=3.1,ramp=.45,speed=TAU/(duration-ramp/2);
    const integral=x=>x<=0?0:x>=ramp?x-ramp/2:ramp*((x/ramp)**3-.5*(x/ramp)**4);
    if(t<COLOR)return speed*integral(t-FINISH);
    const elapsed=Math.min(20,t)-COLOR;
    return TAU+speed*(elapsed-integral(elapsed-(duration-ramp)));
  }
  _cameraAt(t){
    if(!this._scrollTrack||this._trackAspect!==this.camera.aspect)this._buildScrollTrack();
    const {whole,direction,extra}=this._cameraTrack;
    if(t>=FINISH)return this._wholeFrame(this._orbitTurn(t));
    if(t>=EXPLODE){
      const dist=whole.dist+extra*smooth(this._separation(t)/.65);
      return {pos:whole.tgt.clone().addScaledVector(direction,dist),tgt:whole.tgt.clone()};
    }
    const k=this._scrollTrack,target=new THREE.Vector3(interpolate(k,t,'x'),interpolate(k,t,'y'),interpolate(k,t,'z'));
    const distance=Math.exp(interpolate(k,t,'zoom'));
    return {pos:target.clone().addScaledVector(direction,distance),tgt:target};
  }
  _applyChapterSideEffects(){
    const t=this.progress*20,detached=t>=EXPLODE&&t<FINISH;
    if(detached){this.prepareScore();this._explodeEntered=true;this._explode.root.visible=true;this.model.root.visible=false;this.wiring.group.visible=false;}
    else this._leaveParts();
  }
  _finishAt(t){
    // All opening details share precisely the same shell material.
    let from='frost',to='frost',amount=0;
    if(t>=FINISH&&t<COLOR){to='glacier';amount=smooth((t-FINISH)/.5);}
    else if(t>=COLOR){from='glacier';to='amber';amount=smooth((t-COLOR)/.5);}
    const key=`${from}:${to}:${amount}`;if(key===this._lastFinishKey)return;
    this.materials.applySkinBlend(from,to,amount);this._lastFinishKey=key;
  }
  update(){
    if(!this.active)return;
    if(this._lastRenderedProgress===this.progress&&this._lastRenderedAspect===this.camera.aspect)return;
    this._applyChapterSideEffects();const t=this.progress*20;
    const poseKey=t<1.45?t:t<8.8?1.45:Math.min(9.7,t);
    if(poseKey!==this._lastScrollPose){this._scorePose(this.progress);this._lastScrollPose=poseKey;}
    if(this._explodeEntered)this._setParts(this._separation(t));
    const cam=this._cameraAt(t);this.camera.position.copy(cam.pos);this.controls.target.copy(cam.tgt);this.camera.lookAt(cam.tgt);
    this.modes.setBlend(0,0);this.modes.snapBlend();this._finishAt(t);
    this._lastRenderedProgress=this.progress;this._lastRenderedAspect=this.camera.aspect;
  }
  goTo(idx){const i=Math.max(0,Math.min(this.chapters.length-1,idx));this.setProgress(this.chapterStarts[i]/20);}
}
