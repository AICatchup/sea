import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Expedition,createExpeditionMap} from '../src/game/expedition.ts';
import type {AdventureState} from '../src/world/contracts.ts';

const ground={heightAt:(_x:number,z:number)=>z>0?.5:-8};
const destinations=[{id:'tomari',label:'泊',island:'式根島',x:-118,z:-90,heading:0,landingX:-33,landingZ:29},
 {id:'nakanoura',label:'中の浦',island:'式根島',x:400,z:-90,heading:0,landingX:400,landingZ:29}];
const make=(overrides:Record<string,unknown>={})=>new Expedition(createExpeditionMap(ground,destinations),ground,{getItem:()=>JSON.stringify({version:1,notebook:true,cargo:[],banked:[],stamps:[],gear:[],captain:false,bestRace:null,...overrides}),setItem:()=>{}});
const at=(x=400,z=29):AdventureState=>({mode:'walk',position:new THREE.Vector3(x,2.14,z),yaw:0,pitch:0,speed:0,oxygen:1,depth:0,boatPosition:new THREE.Vector3(400,0,-90),boatYaw:0,voyageTarget:null,voyageRemaining:0,message:'',grounded:true,avatarAction:'idle'});

test('reaching another beach naturally reveals its local record before the Tomari chapter is complete',()=>{
 const g=make(),s=at();
 assert.equal(g.target(s)?.id,'shore-nakanoura');
 assert.match(g.objective(s).detail,/回収/);
 assert.equal(g.target(at(-36,27))?.id,'glass','home beach keeps its original first task');
 assert.equal(make({notebook:false}).target(s)?.id,'notebook','the introduction still starts with the notebook');
 assert.deepEqual(g.cargo,[],'guidance never grants a record or progress');
});

test('explicit tracking and a full return load take priority over nearby discoveries',()=>{
 const g=make(),s=at();g.track('glass');assert.equal(g.target(s)?.id,'glass');
 g.track(null);assert.equal(g.target(s)?.id,'shore-nakanoura');
 const loaded=make({cargo:['glass','compass']});assert.equal(loaded.target(s)?.id,'camp');
 const banked=make({banked:['shore-nakanoura']});assert.notEqual(banked.target(s)?.id,'shore-nakanoura');
});

test('one island record is enough to guide the return and actual delivery',()=>{
 const g=make({cargo:['shore-nakanoura']}),s=at();
 assert.equal(g.target(s)?.id,'camp');assert.match(g.objective(s).detail,/船/);
 s.mode='boat';assert.match(g.objective(s).detail,/泊海水浴場/);
 s.mode='walk';s.position.set(g.map.camp.x,2.14,g.map.camp.z);
 assert.match(g.objective(s).detail,/E/);assert.equal(g.interact(s),true);
 assert.ok(g.banked.includes('shore-nakanoura'));assert.equal(g.cargo.length,0);assert.equal(g.target(s)?.id,'glass');
});
