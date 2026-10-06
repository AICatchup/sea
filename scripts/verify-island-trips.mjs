import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {IslandWorld} from '../src/world/terrain.ts';
// Run with Node --experimental-strip-types. The optional argument is a JSON receipt path.
const receiptPath=process.argv[2]??'work/island-roundtrips.json';
fs.mkdirSync(path.dirname(receiptPath),{recursive:true});
import {ExplorerControls} from '../src/world/explorer-controls.ts';
import {Expedition,createExpeditionMap} from '../src/game/expedition.ts';
class Doc extends EventTarget{hidden=false;defaultView=new EventTarget();pointerLockElement=null;}
class Canvas extends EventTarget{ownerDocument=new Doc();style={touchAction:''};tabIndex=0;focus(){}setPointerCapture(){}releasePointerCapture(){}hasPointerCapture(){return false;}}
const world=new IslandWorld(true,true,false,true,true),map=createExpeditionMap(world,world.destinations),results=[];
const gap=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),diff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const save={version:1,notebook:true,cargo:[],banked:[],stamps:[],gear:[],captain:false,bestRace:null};
try{for(const dest of world.destinations.filter(d=>d.id!=='tomari')){
 const canvas=new Canvas(),c=new ExplorerControls(canvas,world,world.destinations,world.spawnPoint),s=c.state;
 const game=new Expedition(map,world,{getItem:()=>JSON.stringify(save),setItem:()=>{}});let time=0,maxFrameTravel=0;
 c.setContextInteraction({label:s=>game.context(s)?.label??'',activate:s=>game.interact(s)});
 const step=()=>{const previous=s.position.clone();c.update(1/60,time);game.update(1/60,s);time+=1/60;maxFrameTravel=Math.max(maxFrameTravel,s.position.distanceTo(previous));};
 const advance=n=>{for(let f=0;f<n*60;f++)step();};
 const look=(yaw,pitch=0)=>{canvas.ownerDocument.pointerLockElement=canvas;canvas.ownerDocument.dispatchEvent(Object.assign(new Event('mousemove'),{movementX:-diff(yaw,s.yaw)*.12/.0028,movementY:(s.pitch-pitch)*.12/.0028}));};
 const aroundHull=target=>{const b=s.boatPosition,first=Math.atan2(s.position.z-b.z,s.position.x-b.x),final=Math.atan2(target.z-b.z,target.x-b.x),turn=diff(final,first),n=Math.max(1,Math.ceil(Math.abs(turn)/.35));return [...Array.from({length:n+1},(_,i)=>({x:b.x+Math.cos(first+turn*i/n)*6,z:b.z+Math.sin(first+turn*i/n)*6})),target];};
 const follow=(waypoints,budget=300)=>{const start=time;let waypoint=0,last=s.position.clone(),stalled=0,nextCheck=time+5;
  while(waypoint<waypoints.length&&time-start<budget){const target=waypoints[waypoint];if(gap(s.position,target)<1.15){waypoint++;continue;}
   const yaw=Math.atan2(target.x-s.position.x,-(target.z-s.position.z)),error=diff(yaw,s.yaw);look(yaw);c.setMove(0,Math.abs(error)<.6?1:0);step();
   if(time>=nextCheck){stalled=s.position.distanceTo(last)<.25?stalled+5:0;last.copy(s.position);nextCheck=time+5;if(stalled>=15)break;}
  }c.setMove(0,0);advance(2);return {complete:waypoint===waypoints.length,seconds:time-start,gap:gap(s.position,waypoints.at(-1)),mode:s.mode,grounded:s.grounded,position:s.position.toArray(),stalled};};
 const sail=id=>{c.navigate(id);const start=time,limit=s.voyageRemaining/12+120;while(s.voyageTarget&&time-start<limit)step();return {seconds:time-start,arrived:s.voyageTarget===null&&s.message.includes('到着'),message:s.message,position:s.boatPosition.toArray()};};
 // Only this initial bookmark sets a position. Every later leg uses inputs.
 c.viewpoint(s.boatPosition.x+1.7,s.boatPosition.z,0,0,'swim');c.interact();advance(5.5);
 const row={id:dest.id,initialBoarded:s.mode==='boat'};
 if(row.initialBoarded){
  row.outbound=sail(dest.id);c.interact();advance(5.5);
  row.landing=follow(aroundHull({x:dest.landingX,z:dest.landingZ}));
  const find=map.finds.find(f=>f.id==='shore-'+dest.id);
  if(find&&row.landing.complete){for(let i=0;i<120;i++){look(Math.atan2(find.x-s.position.x,-(find.z-s.position.z)),Math.atan2(find.y-s.position.y,gap(s.position,find)));step();}c.interact();row.collected=game.cargo.includes(find.id);}
  const b=s.boatPosition,yaw=s.boatYaw,entry={x:b.x-.75*Math.cos(yaw)-3.35*Math.sin(yaw),z:b.z-.75*Math.sin(yaw)+3.35*Math.cos(yaw)};
  row.backToBoat=follow(aroundHull(entry));c.interact();advance(5.5);row.reboarded=s.mode==='boat';
  if(row.reboarded){row.returnVoyage=sail('tomari');c.interact();advance(5.5);row.camp=follow(aroundHull(map.camp));c.interact();row.banked=game.banked;row.stamps=game.stamps;}
 }
 row.maxFrameTravel=maxFrameTravel;results.push(row);c.dispose();
 fs.writeFileSync(receiptPath,JSON.stringify({scope:'Current real IslandWorld, controller, expedition. One explicit vessel QA start per destination and notebook-only simulated save; subsequent legs only input/mouse/E/map actions. Mean water level, no rendered asset collision registry. CPU simulation, not browser or human-play proof.',results},null,2));
 assert.ok(row.initialBoarded&&row.outbound?.arrived&&row.landing?.complete&&row.reboarded&&row.returnVoyage?.arrived&&row.camp?.complete,JSON.stringify(row));
 assert.equal(row.landing.mode,'walk');assert.equal(row.landing.grounded,true);
 assert.ok(row.stamps.includes(dest.id)&&row.stamps.includes('tomari'));
 if(map.finds.some(f=>f.id==='shore-'+dest.id)){assert.equal(row.collected,true);assert.ok(row.banked.includes('shore-'+dest.id));}
 assert.ok(row.maxFrameTravel<.4,'continuous 60Hz route exceeded the bounded vessel/boarding step');
 console.log(JSON.stringify({id:dest.id,status:'PASS',banked:row.banked,stamps:row.stamps,maxFrameTravel:row.maxFrameTravel}));
}}finally{world.dispose();}

