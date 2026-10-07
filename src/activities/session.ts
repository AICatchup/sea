import type {AdventureState,GroundSampler} from '../world/contracts.ts';
import type {ActivityMotion} from '../world/explorer-controls.ts';
import {createFishing,type FishingFrame} from './fishing.ts';
import {createSurfState,stepSurfing,type SurfInput,type SurfOutput} from './surfing.ts';
type Point={x:number;y:number;z:number};
export class ActivitySession{
 tool:'none'|'rod'|'board'='none';readonly fishing=createFishing(3917);surf=createSurfState();surfOutput:SurfOutput|null=null;
 readonly pole:Point;board:Point;private actionPending=false;private previousCatch='';private store?:Storage;
  catches=0;bestFish=0;bestRide=0;revision=0;
  private wasRiding=false;
 private ground:GroundSampler;private water:(x:number,z:number)=>number;private ready:()=>boolean;
 constructor(ground:GroundSampler,water:(x:number,z:number)=>number,ready:()=>boolean,store?:Storage){
  this.ground=ground;this.water=water;this.ready=ready;
  this.pole={x:-39,z:24,y:ground.heightAt(-39,24)};this.board={x:5836,z:-4507,y:ground.heightAt(5836,-4507)};this.store=store;
  try{const raw=store?.getItem('sea.activities.v1');if(raw&&raw.length<1000){const s=JSON.parse(raw);if(s.version===1){this.catches=this.safe(s.catches,10000);this.bestFish=this.safe(s.bestFish,100);this.bestRide=this.safe(s.bestRide,5000);}}}catch{}
 }
 private safe(n:number,max:number){return Number.isFinite(n)?Math.max(0,Math.min(max,n)):0;}
 private save(){this.revision++;try{this.store?.setItem('sea.activities.v1',JSON.stringify({version:1,catches:this.catches,bestFish:this.bestFish,bestRide:this.bestRide}));}catch{}}
 private near(s:AdventureState,p:Point,r=3){return Math.hypot(s.position.x-p.x,s.position.z-p.z)<r&&Math.abs(s.position.y-p.y)<3.5;}
 private frame(s:AdventureState):FishingFrame{
  const x=s.position.x+Math.sin(s.yaw)*8,z=s.position.z-Math.cos(s.yaw)*8,y=this.water(x,z),groundY=this.ground.heightAt(x,z);
  return{player:s.position,yaw:s.yaw,mode:s.mode as 'walk'|'boat',speed:s.speed,boarding:(s.boardingProgress??0)>0,voyageActive:!!s.voyageTarget,waterTarget:{x,y,z,groundY,isWater:Number.isFinite(groundY)&&groundY<y-.25}};
 }
 hint(s:AdventureState):string{
  if((s.boardingProgress??0)>0)return'';
  if(this.tool==='rod'){const f=this.fishing.snapshot();return f.phase==='bite'?'今、合わせる':f.phase==='reeling'?(f.reeling?'糸を緩める':'リールを巻く'):f.canCast?'浮きを投げる':f.phase==='waiting'?'魚信を待っています':'竿を持っています';}
  if(this.tool==='board')return this.surf.phase==='carried'?'海でボードを出す':this.surf.phase==='wipeout'?'ボードへ戻る':this.surf.phase==='riding'?'波に乗っています':this.surf.catchWindow>0?'立ち上がる！':'岸を向いてパドル';
  if(s.mode==='boat'&&!s.voyageTarget&&s.speed<.9||s.mode==='walk'&&this.near(s,this.pole))return'釣り竿を手に取る';
  if(s.mode==='walk'&&this.near(s,this.board,2.5))return'サーフボードを持つ';return'';
 }
 activate(s:AdventureState):void{
  if(this.tool==='none'){
   if(s.mode==='boat'&&!s.voyageTarget&&s.speed<.9||s.mode==='walk'&&this.near(s,this.pole)){this.tool='rod';}
   else if(s.mode==='walk'&&this.near(s,this.board,2.5)){this.tool='board';this.surf=stepSurfing(this.surf,{...this.surfInput(s,1/60,0,0),pickup:true,yaw:s.yaw}).state;}
  }else this.actionPending=true;
 }
 stow(s:AdventureState):boolean{
  if(this.tool==='none')return false;
  if(this.tool==='rod')this.fishing.update(.02,{...this.frame(s),speed:1});
  if(this.tool==='board'){this.board={x:s.position.x+Math.cos(s.yaw)*.8,z:s.position.z+Math.sin(s.yaw)*.8,y:Math.max(this.ground.heightAt(s.position.x,s.position.z),this.water(s.position.x,s.position.z))};this.surf=createSurfState();}
  this.tool='none';this.actionPending=false;s.message='道具をしまいました。';return true;
 }
 update(dt:number,s:AdventureState):void{
  if(dt<=0)return;
  if(this.tool==='rod'){
   if(s.mode==='boat'&&(s.speed>=.9||s.voyageTarget)){this.stow(s);s.message='竿をしまって操船に戻りました。';return;}
   const f=this.fishing.update(dt,this.frame(s),{interact:this.actionPending});this.actionPending=false;
   if(!['walk','boat'].includes(s.mode)){this.tool='none';return;}
   if(f.phase==='caught'&&f.catch&&this.previousCatch!=='caught'){this.catches++;this.bestFish=Math.max(this.bestFish,f.catch.lengthCm);this.save();}
   this.previousCatch=f.phase;
  }
  this.bestRide=Math.max(this.bestRide,this.surf.bestDistance);
  if(this.wasRiding&&this.surf.phase!=='riding')this.save();this.wasRiding=this.surf.phase==='riding';
 }
 syncPausedFrame(s:AdventureState):void{
  this.actionPending=false;
  if(this.tool!=='board')return;
  const water=this.water(s.position.x,s.position.z),valid=this.ready()&&Number.isFinite(water);
  this.surf.previousWaterHeight=valid?water:null;
  this.surf.previousPlayerX=valid?s.position.x:null;this.surf.previousPlayerZ=valid?s.position.z:null;
  this.surf.catchWindow=0;this.surf.movingWave=0;
 }
 private surfInput(s:AdventureState,dt:number,forward:number,steer:number):SurfInput{
  const p=s.position,w=this.water(p.x,p.z),gx=(this.water(p.x+1,p.z)-this.water(p.x-1,p.z))*.5,gz=(this.water(p.x,p.z+1)-this.water(p.x,p.z-1))*.5;
  return{dt,playerPosition:p,boardPosition:this.board,waterHeight:w,waterGradient:{x:gx,z:gz},waveReady:this.ready(),groundDepth:w-this.ground.heightAt(p.x,p.z),shoreward:{x:-1,z:0},forward,steer,yaw:s.yaw};
 }
 motion(dt:number,input:{x:number;forward:number},s:AdventureState):ActivityMotion|null{
  if(this.tool!=='board')return null;
  const action=this.actionPending;this.actionPending=false;const data=this.surfInput(s,dt,input.forward,input.x);
  if(this.surf.phase==='carried')this.surf.yaw=s.yaw;
  const oldYaw=this.surf.yaw;this.surfOutput=stepSurfing(this.surf,{...data,launch:action,stand:action,recover:action});this.surf=this.surfOutput.state;
  if(this.surf.phase!=='paddling'&&this.surf.phase!=='riding')return null;
  return{dx:this.surfOutput.displacement.x,dz:this.surfOutput.displacement.z,eyeY:data.waterHeight+this.surfOutput.eyeHeight,vx:this.surfOutput.velocity.x,vz:this.surfOutput.velocity.z,standing:this.surf.phase==='riding',stance:this.surfOutput.eyeBlend,yawDelta:Math.atan2(Math.sin(this.surf.yaw-oldYaw),Math.cos(this.surf.yaw-oldYaw))};
 }
 blocked():void{this.surf.phase='wipeout';this.surf.speed=0;this.surf.wipeoutTime=0;}
 get diagnostics(){return{tool:this.tool,fishing:this.fishing.snapshot(),surf:{...this.surf},catches:this.catches,bestFish:this.bestFish,bestRide:this.bestRide};}
}
