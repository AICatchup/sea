import * as THREE from 'three';
import type { GroundSampler } from './contracts.ts';
import { sandAt } from './geodata.ts';
import { jointRandom } from './coast-structure.ts';

/** Conservative bounds for rock volumes, including their embedded backs. Coordinates are world metres. */
export interface CliffCollisionProxy { minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number; }
export interface BodyPoint { x:number;y:number;z:number; }

/** Sweep the feet position of a vertical body through all exposed ledges, including underwater approach. */
export function cliffBodySegmentBlocked(
  proxies:readonly CliffCollisionProxy[], from:BodyPoint, to:BodyPoint, radius=.38, bodyHeight=1.72,
): boolean {
  for(const p of proxies) {
    let enter=0,exit=1;
    for(const [a,b,low,high] of [[from.x,to.x,p.minX-radius,p.maxX+radius],
      [from.y,to.y,p.minY-bodyHeight,p.maxY],[from.z,to.z,p.minZ-radius,p.maxZ+radius]]) {
      const delta=b-a;
      if(Math.abs(delta)<1e-9){if(a<low || a>high){enter=2;break;}continue;}
      let t0=(low-a)/delta,t1=(high-a)/delta;if(t0>t1)[t0,t1]=[t1,t0];
      enter=Math.max(enter,t0);exit=Math.min(exit,t1);if(enter>exit)break;
    }
    if(enter<=exit && exit>=0 && enter<=1)return true;
  }
  return false;
}

/** Structural joint groups replace the dense decorative all-over rock scatter. */
export function cliffOutcrops(ground:GroundSampler,bounds:{minX:number;minZ:number;maxX:number;maxZ:number}):THREE.BufferGeometry {
  const positions:number[]=[],colors:number[]=[],uvs:number[]=[],proxies:CliffCollisionProxy[]=[];
  const familyCounts={plates:0,columns:0,buttresses:0},regions={west:0,centre:0,east:0};
  const stride=4.7,triangleLimit=80000;
  let eligible=0,count=0,pieces=0,rejectedStrand=0,maxProtrusion=0,maxFaceWidth=0,minVisibleY=Infinity;
  let sampledCliffArea=0,authoredFaceArea=0,exposedFaceArea=0,buriedFaceArea=0;
  const normalUpBins={vertical:0,sloping:0,upward:0};let rejectedCrown=0;
  const patchNormalUpBins={west:{vertical:0,sloping:0,upward:0},centre:{vertical:0,sloping:0,upward:0},east:{vertical:0,sloping:0,upward:0}};
  const exposedFaceUpBins={vertical:0,sloping:0,upward:0};
  const triangle=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,shade:number)=>{
    for(const p of[a,b,c]){positions.push(p.x,p.y,p.z);colors.push(shade,shade*.995,shade*1.018);uvs.push(p.x*.2,p.y*.2);}
  };
  const slopeAt=(x:number,z:number,r=4)=>{
    const gx=(ground.heightAt(x+r,z)-ground.heightAt(x-r,z))/(2*r);
    const gz=(ground.heightAt(x,z+r)-ground.heightAt(x,z-r))/(2*r);
    return {gx,gz,magnitude:Math.hypot(gx,gz)};
  };
  const normal=new THREE.Vector3(),tangent=new THREE.Vector3(),vertical=new THREE.Vector3();
  for(let iz=0,z=bounds.minZ+14;z<bounds.maxZ-14;z+=stride,iz++)for(let ix=0,x=bounds.minX+14;x<bounds.maxX-14;x+=stride,ix++){
    if(positions.length/9+120>triangleLimit)break;
    const random=(seed:number)=>jointRandom(ix,iz,seed);
    const px=x+(random(13)-.5)*3.2,pz=z+(random(17)-.5)*3.2,y=ground.heightAt(px,pz);
    // sandAt describes the horizontal cove, including the tall west wall.
    // Apply it only at foot elevations, never to the entire vertical column.
    if(y<5 || y>56 || (y<9 && sandAt(px,pz)>.48))continue;
    const gradient=slopeAt(px,pz,2);
    const up=1/Math.hypot(1,gradient.magnitude);
    normalUpBins[up<.58?'vertical':up<.8?'sloping':'upward']++;
    patchNormalUpBins[px<-90?'west':px>90?'east':'centre'][up<.58?'vertical':up<.8?'sloping':'upward']++;
    if(up>.58 || slopeAt(px,pz,6).magnitude<.85)continue;
    const uphillX=gradient.gx/gradient.magnitude,uphillZ=gradient.gz/gradient.magnitude;
    // A real scarp rises behind its face. Ridge crowns and vegetation-facing
    // upper slopes must not acquire disconnected skyline blocks.
    if(ground.heightAt(px+uphillX*7,pz+uphillZ*7)<y+3){rejectedCrown++;continue;}
    eligible++;sampledCliffArea+=stride*stride*Math.hypot(1,gradient.magnitude);
    // Select only coast-facing scarps, leaving most of the larger coherent field visible.
    if(random(31)<.12)continue;
    // Use the *surface* normal. A purely horizontal extrusion with a vertical
    // panel buries its upper half in a DEM slope and barely changes the view.
    normal.set(-gradient.gx,1,-gradient.gz).normalize();
    tangent.set(-gradient.gz,0,gradient.gx).normalize();vertical.crossVectors(normal,tangent).normalize();
    const dip=(jointRandom(Math.floor(px/28),Math.floor(pz/22),11)-.5)*.24;
    tangent.applyAxisAngle(normal,dip);vertical.applyAxisAngle(normal,dip);
    const family=jointRandom(Math.floor(px/19),Math.floor(pz/23),37);
    const familyName=family<.44?'plates':family<.72?'columns':'buttresses';
    // Unequal metre-scale fracture groups affect form at beach-view distances.
    const width=familyName==='plates'?2.6+random(41)*1.9:familyName==='columns'?1.4+random(41)*1.3:2.8+random(41)*1.8;
    const height=familyName==='plates'?.8+random(43)*.9:familyName==='columns'?1.6+random(43)*1.5:1.3+random(43)*1.5;
    const depth=.5+random(47)*.75;
    const split=familyName==='plates'?3+(random(51)>.7?1:0):random(51)>.4?2:1;
    const gap=.22+random(53)*.38,shade=.58+random(81)*.16;
    const centre=new THREE.Vector3(px,y,pz);
    let emitted=0;
    const weights=Array.from({length:split},(_,part)=>.55+random(101+part)*.9);
    const totalWeight=weights.reduce((sum,weight)=>sum+weight,0);
    let edgeOffset=-width;
    for(let part=0;part<split;part++){
      const halfWidth=(width*2-gap*(split-1))*weights[part]/(2*totalWeight);
      const partOffset=edgeOffset+halfWidth;
      edgeOffset+=halfWidth*2+gap;
      const partCentre=centre.clone().addScaledVector(tangent,partOffset).addScaledVector(normal,(part%2?-.18:.12)*depth);
      // Unequal oblique fracture planes; no radially inflated rounded centre.
      const outline=familyName==='columns'
        ?[[-1,-.78],[-.68,-1],[.68,-.94],[1,-.54],[.92,.74],[.58,1],[-.72,.90],[-1,.49]]
        :familyName==='buttresses'
          ?[[-1,-.85],[-.43,-1],[.75,-.83],[1,-.34],[.64,.82],[.17,1],[-.81,.53],[-1,.04]]
          :[[-1,-.69],[-.69,-1],[.74,-.81],[1,-.44],[.85,.61],[.52,1],[-.77,.79],[-1,.30]];
      const back:THREE.Vector3[]=[],front:THREE.Vector3[]=[],bevel:THREE.Vector3[]=[];
      const tiltU=(random(61)-.5)*.30,tiltV=(random(67)-.5)*.24;
      const at=(u:number,v:number,d:number)=>partCentre.clone().addScaledVector(tangent,u)
        .addScaledVector(vertical,v).addScaledVector(normal,d);
      // Find a single support plane outside the irregular underlying scarp.
      // The face stays planar, but is guaranteed to stand out at every corner.
      let support=0,embed=4;
      for(const [uu,vv] of outline){
        const u=uu*halfWidth,v=vv*height;
        let d=0,p=at(u*.94,v*.96,d);
        while(p.y<ground.heightAt(p.x,p.z)+.28 && d<5){d+=.25;p=at(u*.94,v*.96,d);}
        support=Math.max(support,d);
        d=4;p=at(u,v,-d);
        while(p.y>ground.heightAt(p.x,p.z)-.5 && d<14){d+=.5;p=at(u,v,-d);}
        embed=Math.max(embed,d);
      }
      // Avoid unsupported fragments crossing a crest, rather than stretching a
      // giant artificial slab across a valley. Broad source shape stays intact.
      if(support>.5 || embed>=14)continue;
      for(let corner=0;corner<outline.length;corner++){
        const [uu,vv]=outline[corner];
        const u=uu*halfWidth,v=vv*height;
        // Unequal broken face angles, rather than one identical flat prism face.
        const planeDepth=depth*(1+uu*tiltU+vv*tiltV)+(random(131+corner+part*8)-.5)*.26;
        back.push(at(u,v,-embed));
        front.push(at(u*.94,v*.96,support+planeDepth*.68));
        bevel.push(at(u*.81,v*.87,support+planeDepth));
      }
      // No new body-height walls across the strand or the navigable sea.
      if([...front,...bevel].some(p=>p.y<2.2 || (sandAt(p.x,p.z)>.6 && ground.heightAt(p.x,p.z)<5))){rejectedStrand++;continue;}
      const exposed=[...front,...bevel];
      const proxy:CliffCollisionProxy={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
      // Include the backs so that slanted side faces cannot fall outside their proxy. They are embedded in land.
      for(const p of [...exposed,...back]){
        proxy.minX=Math.min(proxy.minX,p.x);proxy.maxX=Math.max(proxy.maxX,p.x);
        proxy.minY=Math.min(proxy.minY,p.y);proxy.maxY=Math.max(proxy.maxY,p.y);
        proxy.minZ=Math.min(proxy.minZ,p.z);proxy.maxZ=Math.max(proxy.maxZ,p.z);
      }
      for(const p of exposed){minVisibleY=Math.min(minVisibleY,p.y);maxProtrusion=Math.max(maxProtrusion,p.clone().sub(centre).dot(normal));}
      proxies.push(proxy);
      // A single planar central face plus shallow chamfers. Every winding faces outward.
      for(let i=1;i+1<bevel.length;i++){
        triangle(bevel[0],bevel[i],bevel[i+1],shade+.025);
        // Reverse winding closes the embedded back: collisions see a solid
        // watertight volume, including approaches from above and behind.
        triangle(back[0],back[i+1],back[i],shade-.10);
      }
      for(let i=0;i<outline.length;i++){
        const j=(i+1)%outline.length;
        triangle(back[i],back[j],front[j],shade-.085);triangle(back[i],front[j],front[i],shade-.085);
        triangle(front[i],front[j],bevel[j],shade-.015);triangle(front[i],bevel[j],bevel[i],shade-.015);
      }
      authoredFaceArea+=halfWidth*height*4*.82;
      for(let i=1;i+1<bevel.length;i++){
        const a=bevel[0],b=bevel[i],c=bevel[i+1];
        const faceNormal=b.clone().sub(a).cross(c.clone().sub(a));
        const area=faceNormal.length()*.5,faceUp=Math.abs(faceNormal.normalize().y);
        exposedFaceUpBins[faceUp<.58?'vertical':faceUp<.8?'sloping':'upward']++;
        const mid=a.clone().add(b).add(c).multiplyScalar(1/3);
        if(mid.y>ground.heightAt(mid.x,mid.z)+.05)exposedFaceArea+=area;else buriedFaceArea+=area;
      }
      pieces++;emitted++;
    }
    if(emitted){count++;familyCounts[familyName]++;regions[px<-90?'west':px>90?'east':'centre']++;maxFaceWidth=Math.max(maxFaceWidth,width*2);}
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  geometry.userData={outcropCount:count,rockPieces:pieces,triangleCount:positions.length/9,triangleLimit,familyCounts,regions,
    normalUpBins,patchNormalUpBins,exposedFaceUpBins,rejectedCrown,eligibleSteepFaceSamples:eligible,rejectedStrandPieces:rejectedStrand,sampledCliffAreaM2:sampledCliffArea,authoredFaceAreaM2:authoredFaceArea,
    exposedCentralFaceAreaM2:exposedFaceArea,buriedCentralFaceAreaM2:buriedFaceArea,closedVolumes:true,maxNormalProtrusionM:maxProtrusion,maxFaceWidthM:maxFaceWidth,minExposedVertexHeightM:Number.isFinite(minVisibleY)?minVisibleY:null,
    collisionProxies:proxies,collision:'Complete rock-volume AABBs; swept upright-body helper uses foot height in world metres',
    provenance:'Authored metre-scale fracture shelves, closed overhang volumes and embedded backs; source DEM unchanged, not surveyed rhyolite geometry'};
  return geometry;
}

