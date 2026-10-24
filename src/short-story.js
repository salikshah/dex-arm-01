// Fifteen-second continuous product film. Every channel is a function of time.
import * as THREE from 'three';
import { Story } from './story.js?v=short-20261012';
import { GESTURES, ARM_POSES } from './pose.js?v=short-20261012';
const clamp = v => Math.min(1, Math.max(0, v));
const ease = v => { const u = clamp(v); return u * u * (3 - 2 * u); };
const TAU = Math.PI * 2;
const EXPLODE_AT=1.4, FLAT_AT=3, FINISH_AT=4.2, DETAIL_PEAK=6.25, ORBIT_AT=8.8, COLOR_AT=11.9;
const smoother=v=>{const u=clamp(v);return u*u*u*(u*(u*6-15)+10);};
// The detail move gently arcs 45°, then continues into two full finish turns.
// Integrate angular speed so the zoom/orbit handoff never stops or changes direction.
const DETAIL_TURN=Math.PI/4, DETAIL_RAMP=.5, COLOR_RAMP=.65;
const DETAIL_SPEED=DETAIL_TURN/(ORBIT_AT-FINISH_AT-DETAIL_RAMP/2);
const COLOR_SPEED=(TAU-DETAIL_SPEED*COLOR_RAMP/2)/(COLOR_AT-ORBIT_AT-COLOR_RAMP/2);
const EXIT_RAMP=2*((15-COLOR_AT)-TAU/COLOR_SPEED);
const integratedRamp=(time,duration)=>{
  if(time<=0)return 0;
  if(time>=duration)return time-duration/2;
  const u=time/duration;return duration*(u*u*u-.5*u*u*u*u);
};
const CHAPTERS = [
  { id:'three', label:'Three · 3', duration:.36 },
  { id:'one', label:'One · 1', duration:1.04 },
  { id:'explode', label:'Explode', duration:1.6 },
  { id:'reassemble', label:'Reassemble', duration:1.2 },
  { id:'detail', label:'Detail orbit', duration:4.6 },
  { id:'finish', label:'Finishes', duration:6.2 },
];
const POSES = [[0,'three'],[.26,'three'],[.46,'one'],[4.2,'one'],[5.4,'open'],[6.7,'open'],[8.8,'one']];

export class ShortStory extends Story {
  constructor(ctx) { super({...ctx,chapters:ctx.chapters??CHAPTERS,duration:ctx.duration??15,timelineStart:0}); }
  enter() {
    this._normalLens??={fov:this.camera.fov,far:this.camera.far,maxDistance:this.controls.maxDistance};
    this.camera.fov=12;this.camera.far=100;this.camera.updateProjectionMatrix();
    this.controls.maxDistance=100;
    super.enter();this._lastFinishKey=null;this._lastShortPose=null;this._cameraTrack=null;
  }
  exit() {
    super.exit();
    const lens=this._normalLens;
    if(!lens)return;
    const offset=this.camera.position.clone().sub(this.controls.target)
      .multiplyScalar(Math.tan(this.camera.fov*Math.PI/360)/Math.tan(lens.fov*Math.PI/360));
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.fov=lens.fov;this.camera.far=lens.far;this.camera.updateProjectionMatrix();
    this.controls.maxDistance=lens.maxDistance;
  }
  _scorePose(progress) {
    const time=progress*15;
    let i=0;while(i<POSES.length-2&&time>=POSES[i+1][0])i++;
    const a=POSES[i],b=POSES[i+1],u=ease((time-a[0])/(b[0]-a[0]));
    this.pose.cancelMotion();this.pose.curl=0;
    this.pose.armAngles=[...ARM_POSES.rest.angles];
    this.pose.handAngles=GESTURES[a[1]].hand.map((v,j)=>THREE.MathUtils.lerp(v,GESTURES[b[1]].hand[j],u));
    this.pose.gesture=u<.5?a[1]:b[1];this.pose.apply();
  }
  prepareScore() {
    if(this._scorePrepared||!this._explode)return;
    this._scorePose(1);this.pose.flush();
    this.modes.set('transparent');this.modes.snapBlend();this._explode.capture();
    this._flatShift=null;this._spreadShift=null;
    this._setParts(0);this._entryPoints=this._partPoints();
    const center=new THREE.Box3().setFromPoints(this._entryPoints).getCenter(new THREE.Vector3());
    // The exploration board lives beside the model. The film unfolds in place.
    this._flatShift=center.clone().sub(this._targetCenter('flat'));
    this._spreadShift=center.clone().sub(this._targetCenter('exploded'));
    this._orbitFit=null;this._cameraTrack=null;this._scorePrepared=true;
    this._scorePose(this.progress);this._lastShortPose=null;
  }
  _separation(t) {
    if(t<EXPLODE_AT||t>=FINISH_AT)return 0;
    return t<=FLAT_AT?Math.sin((t-EXPLODE_AT)/(FLAT_AT-EXPLODE_AT)*Math.PI/2):Math.cos((t-FLAT_AT)/(FINISH_AT-FLAT_AT)*Math.PI/2);
  }
  _setParts(p) {
    // Overlapping translations avoid stopping at the exploded intermediate pose.
    const spread=ease(p/.75),flatten=ease((p-.22)/.78),x=this._explode;
    for(const r of x.parts){
      r.mesh.position.copy(r.entry.position)
        .addScaledVector(r.targets.exploded.position.clone().sub(r.entry.position),spread)
        .addScaledVector(r.targets.flat.position.clone().sub(r.targets.exploded.position),flatten);
      if(this._spreadShift)r.mesh.position.addScaledVector(this._spreadShift,spread-flatten);
      if(this._flatShift)r.mesh.position.addScaledVector(this._flatShift,flatten);
      r.mesh.quaternion.slerpQuaternions(r.entry.quaternion,r.targets.flat.quaternion,flatten);
      r.mesh.scale.copy(r.entry.scale);r.mesh.matrixWorldNeedsUpdate=true;
    }
    x.progress=p;x.layout=p>.95?'flat':'exploded';x._boundsCache.key=null;
    x.root.updateMatrixWorld(true);
  }
  _targetCenter(kind) {
    const box=new THREE.Box3(),matrix=new THREE.Matrix4();
    for(const r of this._explode.parts){
      if(!r.mesh.visible)continue;
      const target=r.targets[kind];
      matrix.compose(target.position,target.quaternion??r.entry.quaternion,r.entry.scale);
      box.union(r.localBox.clone().applyMatrix4(matrix));
    }
    return box.getCenter(new THREE.Vector3());
  }
  _partPoints() {
    const points=[];
    for(const r of this._explode.parts){
      if(!r.mesh.visible)continue;
      const b=r.localBox;
      for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])
        points.push(new THREE.Vector3(x,y,z).applyMatrix4(r.mesh.matrixWorld));
    }
    return points;
  }
  _fitPoints(points,direction,fill=.86,target=null) {
    const tgt=target?.clone()??new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    const dir=direction.clone().normalize(),right=new THREE.Vector3(0,1,0).cross(dir).normalize(),up=dir.clone().cross(right);
    const tan=Math.tan(this.camera.fov*Math.PI/360),v=new THREE.Vector3();let dist=0;
    for(const p of points){v.copy(p).sub(tgt);const z=v.dot(dir);dist=Math.max(dist,z+Math.abs(v.dot(up))/(fill*tan),z+Math.abs(v.dot(right))/(.87*tan*this.camera.aspect));}
    return {pos:tgt.clone().addScaledVector(dir,dist),tgt,dist};
  }
  _wholeFrame(turn=0) {
    if(!this._entryPoints)return super._wholeFrame(turn);
    if(!this._orbitFit||this._orbitFit.aspect!==this.camera.aspect){
      const target=new THREE.Box3().setFromPoints(this._entryPoints).getCenter(new THREE.Vector3());
      const base=Math.atan2(this.defaultDir.x,this.defaultDir.z);let radius=0;
      // Fit once against the entire turn. Never chase the silhouette mid-orbit.
      for(let i=0;i<120;i++){
        const angle=base+i/120*TAU,dir=new THREE.Vector3(Math.sin(angle),.025,Math.cos(angle)).normalize();
        radius=Math.max(radius,this._fitPoints(this._entryPoints,dir,.94,target).dist);
      }
      this._orbitFit={target,radius,base,aspect:this.camera.aspect};
    }
    const {target,radius,base}=this._orbitFit;
    const dir=new THREE.Vector3(Math.sin(base+turn),.025,Math.cos(base+turn)).normalize();
    return {pos:target.clone().addScaledVector(dir,radius),tgt:target.clone(),dist:radius};
  }
  _orbitTurn(t) {
    if(t<=FINISH_AT)return 0;
    if(t<ORBIT_AT)return DETAIL_SPEED*integratedRamp(t-FINISH_AT,DETAIL_RAMP);
    if(t<COLOR_AT){
      const elapsed=t-ORBIT_AT;
      return DETAIL_TURN+DETAIL_SPEED*elapsed+(COLOR_SPEED-DETAIL_SPEED)*integratedRamp(elapsed,COLOR_RAMP);
    }
    const elapsed=Math.min(15,t)-COLOR_AT;
    return DETAIL_TURN+TAU+COLOR_SPEED*(elapsed-integratedRamp(elapsed-(15-COLOR_AT-EXIT_RAMP),EXIT_RAMP));
  }
  _orbitFrame(t){return this._wholeFrame(this._orbitTurn(t));}
  _buildCameraTrack() {
    const whole=this._wholeFrame(),direction=whole.pos.clone().sub(whole.tgt).normalize();
    const hand=this._anchors.hand,points=[];
    for(const x of [hand.min.x,hand.max.x])for(const y of [hand.min.y,hand.max.y])for(const z of [hand.min.z,hand.max.z])points.push(new THREE.Vector3(x,y,z));
    const close=this._fitPoints(points,direction,.80);
    // Frame the physical palm rails, independent of moving finger bounds.
    const palmBox=new THREE.Box3();
    for(const bucket of this.model.buckets)for(const part of bucket.parts){
      if(/^hand\/(palm-(side|cross)-rail|metacarpal)/.test(part.name))
        palmBox.union(part.bounds.clone().applyMatrix4(bucket.owner.matrixWorld));
    }
    if(palmBox.isEmpty())palmBox.copy(hand);
    const palmPoints=[];
    for(const x of [palmBox.min.x,palmBox.max.x])for(const y of [palmBox.min.y,palmBox.max.y])for(const z of [palmBox.min.z,palmBox.max.z])palmPoints.push(new THREE.Vector3(x,y,z));
    const detail=this._fitPoints(palmPoints,direction,.63);
    // One fixed close-up radius, fitted to the whole gentle arc ahead of time.
    for(let i=1;i<=24;i++){
      const frame=this._wholeFrame(DETAIL_TURN*i/24),dir=frame.pos.clone().sub(frame.tgt).normalize();
      detail.dist=Math.max(detail.dist,this._fitPoints(palmPoints,dir,.63,detail.tgt).dist);
    }
    this._palmPoints=palmPoints;
    let extra=0;
    for(let i=1;i<=24;i++){
      const p=i/24;this._setParts(p);
      const fit=this._fitPoints(this._partPoints(),direction,THREE.MathUtils.lerp(.94,.82,ease(p)),whole.tgt);
      extra=Math.max(extra,(fit.dist-whole.dist)/ease(p/.65));
    }
    this._cameraTrack={whole,close,detail,direction,extra};this._trackAspect=this.camera.aspect;
    this._setParts(this._separation(this.progress*15));
  }
  _cameraAt(t) {
    if(t>=ORBIT_AT)return this._orbitFrame(t);
    if(!this._cameraTrack||this._trackAspect!==this.camera.aspect)this._buildCameraTrack();
    const {whole,close,detail,direction,extra}=this._cameraTrack;
    if(t>=FINISH_AT){
      // Zoom into the palm while the same one-way orbit continues slowly.
      const weight=t<=DETAIL_PEAK?smoother((t-FINISH_AT)/(DETAIL_PEAK-FINISH_AT))
        :1-smoother((t-DETAIL_PEAK)/(ORBIT_AT-DETAIL_PEAK));
      const distance=1/THREE.MathUtils.lerp(1/whole.dist,1/detail.dist,weight);
      const targetWeight=1-(1-weight)*distance/whole.dist;
      const target=whole.tgt.clone().lerp(detail.tgt,targetWeight);
      const orbit=this._orbitFrame(t),arcDirection=orbit.pos.clone().sub(orbit.tgt).normalize();
      return {pos:target.clone().addScaledVector(arcDirection,distance),tgt:target};
    }
    if(t<EXPLODE_AT){
      // Hold a large, fixed hand frame for 3 → 1, then pull straight into
      // the explosion. Interpolate screen scale; never turn or follow fingers.
      const pull=smoother((t-.55)/(EXPLODE_AT-.55));
      const distance=1/THREE.MathUtils.lerp(1/close.dist,1/whole.dist,pull);
      const targetWeight=pull*distance/whole.dist;
      const target=close.tgt.clone().lerp(whole.tgt,targetWeight);
      return {pos:target.clone().addScaledVector(direction,distance),tgt:target};
    }
    const distance=whole.dist+extra*ease(this._separation(t)/.65);
    return {pos:whole.tgt.clone().addScaledVector(direction,distance),tgt:whole.tgt.clone()};
  }
  _applyChapterSideEffects() {
    const t=this.progress*15,detached=t>=EXPLODE_AT&&t<FINISH_AT;
    if(detached){this.prepareScore();this._explodeEntered=true;this._explode.root.visible=true;this.model.root.visible=false;this.wiring.group.visible=false;}
    else this._leaveParts();
  }
  _finishAt(t) {
    let from='frost',to='frost',amount=0;
    if(t>=FINISH_AT&&t<ORBIT_AT){from='frost';to='crystal';amount=smoother((t-FINISH_AT)/.8);}
    else if(t>=ORBIT_AT&&t<COLOR_AT){from='crystal';to='glacier';amount=smoother((t-ORBIT_AT)/.45);}
    else if(t>=COLOR_AT){from='glacier';to='amber';amount=smoother((t-COLOR_AT)/.45);}
    const key=`${from}:${to}:${amount}`;if(key===this._lastFinishKey)return;
    this.materials.applySkinBlend(from,to,amount);this._lastFinishKey=key;
  }
  update() {
    if(!this.active)return;
    if(this._lastRenderedProgress===this.progress&&this._lastRenderedAspect===this.camera.aspect)return;
    this._applyChapterSideEffects();
    const t=this.progress*15,poseKey=t<FINISH_AT?Math.min(t,.46):Math.min(t,ORBIT_AT);
    if(poseKey!==this._lastShortPose){this._scorePose(this.progress);this._lastShortPose=poseKey;}
    if(this._explodeEntered)this._setParts(this._separation(t));
    const cam=this._cameraAt(t);this.camera.position.copy(cam.pos);this.controls.target.copy(cam.tgt);this.camera.lookAt(cam.tgt);
    // Gesture changes must not alter the shell or briefly hide its geometry.
    this.modes.setBlend(0,0);this.modes.snapBlend();this._finishAt(t);
    this._lastRenderedProgress=this.progress;this._lastRenderedAspect=this.camera.aspect;
  }
  goTo(idx) {this.setProgress([0,.55/15,2.1/15,3.6/15,6.25/15,8.8/15][Math.max(0,Math.min(5,idx))]);}
}
