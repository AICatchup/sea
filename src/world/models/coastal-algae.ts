import * as THREE from 'three';
import {ModelResources,randomSeed} from './procedural.ts';

export type AlgaeFamily='branched'|'turf';

/** Authored brown-algae morphology informed by island photographs, not a scan
 * or a species census. Every stipe, lamina and vesicle has a closed surface. */
export function coastalAlgaeGeometry(resources:ModelResources,seed:number,family:AlgaeFamily):THREE.BufferGeometry{
 const random=randomSeed(seed),positions:number[]=[],colors:number[]=[],uv:number[]=[],indices:number[]=[];
 const up=new THREE.Vector3(0,1,0),zAxis=new THREE.Vector3(0,0,1);
 const tall=family==='branched',height=tall?.60+random()*.24:.19+random()*.07;
 let branches=0,leaves=0,vesicles=0;
 const stemColor=new THREE.Color(tall?'#7b6845':'#6b5539'),leafColor=new THREE.Color(tall?'#9c7f43':'#8b7549');
 const add=(p:THREE.Vector3,u:number,v:number,c:THREE.Color)=>{const id=positions.length/3;positions.push(p.x,p.y,p.z);uv.push(u,v);colors.push(c.r,c.g,c.b);return id;};
 function tube(curve:(t:number)=>THREE.Vector3,width:(t:number,side:number)=>number,thickness:(t:number)=>number,segments:number,sides:number,color:THREE.Color,twist=0,leafUV=false){
  const first=positions.length/3;
  for(let ring=0;ring<=segments;ring++){
   const t=ring/segments,p=curve(t),d=curve(Math.min(1,t+.002)).sub(curve(Math.max(0,t-.002))).normalize();
   const reference=Math.abs(d.y)>.92?zAxis:up;
   const n=new THREE.Vector3().crossVectors(d,reference).normalize(),b=new THREE.Vector3().crossVectors(d,n).normalize();
   const q=new THREE.Quaternion().setFromAxisAngle(d,twist*t);n.applyQuaternion(q);b.applyQuaternion(q);
   for(let k=0;k<sides;k++){
    const a=k/sides*Math.PI*2;
    add(p.clone().addScaledVector(n,Math.cos(a)*width(t,Math.cos(a))).addScaledVector(b,Math.sin(a)*thickness(t)),leafUV?(Math.cos(a)+1)*.5:k/sides,t,color);
   }
  }
  for(let ring=0;ring<segments;ring++)for(let k=0;k<sides;k++){
   const a=first+ring*sides+k,b=first+ring*sides+(k+1)%sides,c=a+sides,d=b+sides;
   indices.push(a,b,c,b,d,c);
  }
  const a=add(curve(0),.5,0,color),b=add(curve(1),.5,1,color);
  for(let k=0;k<sides;k++){
   indices.push(a,first+(k+1)%sides,first+k);
   const last=first+segments*sides;indices.push(b,last+k,last+(k+1)%sides);
  }
 }
 function lamina(root:THREE.Vector3,direction:THREE.Vector3,length:number,width:number,phase:number){
  const dir=direction.clone().normalize(),side=new THREE.Vector3().crossVectors(dir,up).normalize();
  if(side.lengthSq()<.1)side.set(1,0,0);
  const c=leafColor.clone().multiplyScalar(.84+random()*.26);
  const curve=(t:number)=>root.clone().addScaledVector(dir,length*t).addScaledVector(side,Math.sin(t*Math.PI)*length*.12)
   .addScaledVector(up,Math.sin(t*Math.PI*.9+phase)*length*t*.22);
  const shape=(t:number)=>Math.max(.018,Math.pow(Math.sin(Math.PI*t),.7)),lobes=3+Math.floor(random()*2);
  // Deep, alternating incisions are silhouette, not a painted leaf pattern.
  const edge=(t:number,side:number)=>.24+.76*(.5+.5*Math.cos(t*Math.PI*2*lobes+phase+side*.85));
  tube(curve,(t,side)=>Math.max(.00017,width*shape(t)*edge(t,side)),t=>(.00022+.00013*shape(t)),tall?14:7,4,c,(random()-.5)*2.2,true);leaves++;
 }
 const stemCount=tall?2+Math.floor(random()*2):3+Math.floor(random()*2);
 for(let stem=0;stem<stemCount;stem++){
  const angle=random()*Math.PI*2,spread=tall?.29+random()*.12:.23,length=height*(.66+random()*.34);
  const axis=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
  const curve=(t:number)=>axis.clone().multiplyScalar(length*spread*Math.pow(t,1.5)).add(new THREE.Vector3(Math.sin(t*4+stem)*length*t*.045,length*t,Math.cos(t*3+stem)*length*t*.036));
  tube(curve,t=>(tall?.003:.0022)*(1-t*.86),t=>(tall?.0022:.0022)*(1-t*.86),12,6,stemColor);
  const laterals=tall?8+Math.floor(random()*3):3+Math.floor(random()*2);
  for(let branch=0;branch<laterals;branch++){
   const t=.16+(branch+.2+random()*.4)/laterals*.74,root=curve(t),yaw=angle+branch*2.34+(random()-.5)*.6;
   const extent=length*(tall?.27:.34)*(1-t*.45)*(.8+random()*.55);
   const dir=new THREE.Vector3(Math.cos(yaw),.45+random()*.8,Math.sin(yaw)).normalize();
   const lateral=(q:number)=>root.clone().addScaledVector(dir,extent*q).add(new THREE.Vector3(0,extent*q*q*.15,0));
   const radius=tall?.0013:.0011;
   tube(lateral,q=>radius*(1-q*.83),q=>radius*(1-q*.83),5,5,stemColor);branches++;
   const leafCount=tall?5+Math.floor(random()*3):2;
   for(let leaf=0;leaf<leafCount;leaf++){
    const q=(leaf+.35)/leafCount,leafRoot=lateral(q),leafYaw=yaw+(leaf%2?1:-1)*(.6+random()*.65);
    const leafDir=new THREE.Vector3(Math.cos(leafYaw),.15+random()*.65,Math.sin(leafYaw));
    lamina(leafRoot,leafDir,(tall?.037:.025)*(.75+random()*.8),(tall?.006:.0045)*(.65+random()*.75),random()*Math.PI*2);
   }
   if(tall&&branch%3===1){
    const base=lateral(.45),direction=new THREE.Vector3(Math.cos(yaw+1.8),.8,Math.sin(yaw+1.8)).normalize();
    const fork=(q:number)=>base.clone().addScaledVector(direction,extent*.65*q).addScaledVector(up,q*q*extent*.16);
    tube(fork,q=>.0009*(1-q*.8),q=>.0007*(1-q*.8),5,5,stemColor);branches++;
    for(const q of [.42,.83])lamina(fork(q),direction.clone().add(axis),.024+random()*.025,.004+random()*.002,random()*6.28);
   }
   if(tall&&random()<.43){
    const root=lateral(.67),radius=.0045+random()*.0025;
    const curve=(q:number)=>root.clone().add(new THREE.Vector3(0,radius*3.6*q,0));
    tube(curve,q=>Math.max(radius*.03,Math.pow(Math.sin(q*Math.PI),.55)*radius),q=>Math.max(radius*.03,Math.pow(Math.sin(q*Math.PI),.55)*radius),7,7,leafColor);
    lamina(curve(1),dir,radius*3,.0025,random()*6.28);vesicles++;
   }
  }
  if(tall)lamina(curve(1),axis.clone().add(up),.032,.004,random()*6.28);
 }
 // One compact holdfast keeps the family attached to a single support point.
 for(let root=0;root<5;root++){
  const a=root/5*Math.PI*2+random()*.3;
  tube(t=>new THREE.Vector3(Math.cos(a)*.025*(1-t),.003+t*.025,Math.sin(a)*.025*(1-t)),t=>.0025*(1-t*.45),t=>.0025*(1-t*.45),4,5,stemColor);
 }
 const geometry=resources.geometry(new THREE.BufferGeometry());
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 geometry.userData={marinePlant:true,family,seed,branches,leaves,vesicles,height:geometry.boundingBox!.max.y,triangles:indices.length/3,provenance:'Authored local brown-algae family; no specimen scan or exact habitat map'};
 // Account for the bounded vertex bend without enlarging the real geometry.
 geometry.boundingBox!.expandByScalar(.12);geometry.boundingSphere!.radius+=.12;
 return geometry;
}

const bending=/* glsl */`
 uniform float uAlgaeTime;
 float algaePhase(){
 #ifdef USE_INSTANCING
  return dot(instanceMatrix[3].xz,vec2(.27,.19));
 #else
  return 0.0;
 #endif
 }
 vec2 algaeOffset(float h){float flex=pow(clamp((h-.028)/.9,0.0,1.6),1.5);float p=algaePhase();
  vec2 flow=vec2(-.8,-.6)*sin(uAlgaeTime*.72+h*1.8+p)*.046+vec2(.6,-.8)*cos(uAlgaeTime*.51+h*1.3+p)*.012;
  #ifdef USE_INSTANCING
   flow=vec2(dot(flow,normalize(instanceMatrix[0].xz)),dot(flow,normalize(instanceMatrix[2].xz)));
  #endif
  return flow*flex;
 }
`;
function bendMaterial(material:THREE.Material,time:THREE.IUniform<number>){
 material.onBeforeCompile=shader=>{
  shader.uniforms.uAlgaeTime=time;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+bending)
   .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
    {vec2 bendSlope=(algaeOffset(position.y+.001)-algaeOffset(position.y-.001))/.002;
     objectNormal.y-=dot(objectNormal.xz,bendSlope);}`)
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.xz+=algaeOffset(position.y);');
 };
 material.customProgramCacheKey=()=>`coastal-algae-closed-v48-${material.type}`;
}
export function coastalAlgaeMaterial(resources:ModelResources,time:THREE.IUniform<number>){
 const width=64,height=256,color=new Uint8Array(width*height*4),relief=new Uint8Array(width*height*4);
 const random=randomSeed(34817);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x/(width-1),v=y/(height-1),rib=Math.exp(-Math.pow((u-.5)*22,2));
  const vein=Math.exp(-Math.pow(Math.sin(v*51+Math.abs(u-.5)*15)*9,2))*.11;
  const grain=(random()-.5)*.065,tone=Math.round(236-rib*10-vein*40+grain*160),h=Math.round(105+rib*24+vein*38+grain*80),i=(y*width+x)*4;
  color.set([tone,tone,tone,255],i);relief.set([h,h,h,255],i);
 }
 function texture(data:Uint8Array,space:THREE.ColorSpace){const t=resources.texture(new THREE.DataTexture(data,width,height));t.colorSpace=space;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
 const material=resources.material(new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,map:texture(color,THREE.SRGBColorSpace),bumpMap:texture(relief,THREE.NoColorSpace),bumpScale:.00013,roughness:.66,metalness:0,side:THREE.FrontSide,transparent:false,depthWrite:true}));
 material.name='closed brown algae tissue / micro-rib / true leaf depth';material.userData.marinePlant=true;
 bendMaterial(material,time);
 const depth=resources.material(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.FrontSide}));bendMaterial(depth,time);
 return {material,depth};
}
