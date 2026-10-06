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
export function cliffOutcrops(ground:GroundSampler,bounds:{minX:number;minZ:number;maxX:number;maxZ:number},candidate=false,connectedForm=false):THREE.BufferGeometry {
  if(connectedForm)return connectedCliffSkin(ground,bounds);
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
    const familyName=family<(candidate?.72:.44)?'plates':family<(candidate?.9:.72)?'columns':'buttresses';
    // Unequal metre-scale fracture groups affect form at beach-view distances.
    const width=candidate?(familyName==='plates'?1.6+random(41)*1.4:familyName==='columns'?.65+random(41)*.6:1.4+random(41)*1.0)
      :familyName==='plates'?2.6+random(41)*1.9:familyName==='columns'?1.4+random(41)*1.3:2.8+random(41)*1.8;
    const height=candidate?(familyName==='plates'?.35+random(43)*.35:familyName==='columns'?.75+random(43)*.65:.6+random(43)*.55)
      :familyName==='plates'?.8+random(43)*.9:familyName==='columns'?1.6+random(43)*1.5:1.3+random(43)*1.5;
    const depth=candidate?.18+random(47)*.25:.5+random(47)*.75;
    const split=familyName==='plates'?3+(random(51)>.7?1:0):random(51)>.4?2:1;
    // Shared rock albedo already carries natural dark mineral/fissure detail.
    // Let geometric sunlight and occlusion shade ledges instead of multiplying
    // every separate rock piece by an additional near-black authored tint.
    const gap=candidate?.035+random(53)*.075:.22+random(53)*.38,shade=.89+random(81)*.10;
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
      let support=0,embed=candidate?.45:4;
      // Short ledges must also be supported through their middle, rather than
      // bridging a cleft with a thin plate whose corners alone happen to touch.
      const supportSamples=candidate?[...outline,[0,0],...outline.map(([u,v],i)=>{
        const next=outline[(i+1)%outline.length];return [(u+next[0])*.5,(v+next[1])*.5];
      })]:outline;
      for(const [uu,vv] of supportSamples){
        const u=uu*halfWidth,v=vv*height;
        let d=0,p=at(u*.94,v*.96,d);
        while(p.y<ground.heightAt(p.x,p.z)+(candidate?.06:.28) && d<5){d+=candidate?.08:.25;p=at(u*.94,v*.96,d);}
        support=Math.max(support,d);
        d=candidate?.45:4;p=at(u,v,-d);
        while(p.y>ground.heightAt(p.x,p.z)-(candidate?.12:.5) && d<(candidate?3:14)){d+=candidate?.15:.5;p=at(u,v,-d);}
        embed=Math.max(embed,d);
      }
      // Avoid unsupported fragments crossing a crest, rather than stretching a
      // giant artificial slab across a valley. Broad source shape stays intact.
      if(support>(candidate?.24:.5) || embed>=(candidate?3:14))continue;
      for(let corner=0;corner<outline.length;corner++){
        const [uu,vv]=outline[corner];
        const u=uu*halfWidth,v=vv*height;
        // Unequal broken face angles, rather than one identical flat prism face.
        const planeDepth=depth*(1+uu*tiltU+vv*tiltV)+(random(131+corner+part*8)-.5)*(candidate?.04:.26);
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
    ...(candidate?{coherentCandidate:true}:{}),
    provenance:candidate?'Authored qualitative thin erosion ledges with local embedded support; not surveyed rhyolite geometry'
      :'Authored metre-scale fracture shelves, closed overhang volumes and embedded backs; source DEM unchanged, not surveyed rhyolite geometry'};
  return geometry;
}


/** One indexed terrain-attached shell per connected steep region. Adjacent faces
 * share vertices; edges close into embedded backs, not detached shelf prisms. */
function connectedCliffSkin(ground:GroundSampler,bounds:{minX:number;minZ:number;maxX:number;maxZ:number}):THREE.BufferGeometry {
  const step=2.4,positions:number[]=[],uvs:number[]=[],colors:number[]=[],indices:number[]=[];
  const proxies:CliffCollisionProxy[]=[];
  const vertices=new Map<string,number>();
  const edges=new Map<string,{a:number;b:number;count:number}>();
  const selectedCells:{ix:number;iz:number}[]=[],selected=new Set<string>();
  let splitCorners=0;
  let cells=0,minY=Infinity,maxRelief=0,minRelief=Infinity;
  // Two oblique, unequal joint families in world-space, warped by a broader
  // weathering field. Nearest-cell boundaries produce clefts, not strata;
  // the second family breaks the first family's long continuous grooves.
  const fractureRelief=(x:number,y:number,z:number)=>{
    const warp=Math.sin(x*.047+z*.061)*.43+Math.sin(y*.093-z*.038)*.27;
    const joint=(u:number,v:number,seed:number)=>{
      const iu=Math.floor(u),iv=Math.floor(v);let first=Infinity,second=Infinity;
      for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
        const a=iu+i,b=iv+j,du=u-a-.18-jointRandom(a,b,seed)*.64,
          dv=v-b-.18-jointRandom(a,b,seed+7)*.64,d=du*du+dv*dv;
        if(d<first){second=first;first=d;}else second=Math.min(second,d);
      }
      // A narrow angular trough with sloping shoulders, rather than separate
      // plates or a painted black line. Relief remains supported by the DEM.
      return Math.min(1,Math.max(0,(Math.sqrt(second)-Math.sqrt(first))/.26));
    };
    const main=joint(x*.23+z*.16+warp,y*.115+z*.052-x*.031,211);
    const cross=joint(z*.31-x*.09+warp*.36,y*.22+x*.071,251);
    const weather=.76+.24*Math.sin(x*.081-z*.057+y*.12);
    return .08+weather*(.62*main+.28*cross);
  };
  // The skin must disappear inside the source face at eligibility boundaries.
  // Closing a raised front directly to its buried back exposed a triangular
  // wall at every boundary cell. Compute a metric apron around the whole patch.
  const boundaryWeight=(ix:number,iz:number)=>{
    let distance=step;
    for(let z=Math.floor(iz)-1;z<=Math.floor(iz)+1;z++)for(let x=Math.floor(ix)-1;x<=Math.floor(ix)+1;x++){
      if(selected.has(`${x}:${z}`))continue;
      const dx=Math.max(x-ix,0,ix-x-1),dz=Math.max(z-iz,0,iz-z-1);
      distance=Math.min(distance,Math.hypot(dx,dz)*step);
    }
    const t=Math.min(1,distance/step);return t*t*(3-2*t);
  };
  const point=(ix:number,iz:number,cellX?:number,cellZ?:number):number=>{
    const mask=Number.isInteger(ix)&&Number.isInteger(iz)?[[ix-1,iz-1],[ix,iz-1],[ix,iz],[ix-1,iz]].reduce((m,[x,z],i)=>m|(selected.has(`${x}:${z}`)?1<<i:0),0):0;
    const split=(mask===5||mask===10)&&cellX!==undefined&&cellZ!==undefined;
    const key=`${ix}:${iz}:${split?`${cellX}:${cellZ}`:''}`,known=vertices.get(key);if(known!==undefined)return known;
    // Diagonal-only patches need separate vertices AND a small physical gap.
    // Welding their corner made one vertical edge incident to four walls.
    const x=bounds.minX+14+ix*step+(split?(cellX===ix?.025:-.025):0),z=bounds.minZ+14+iz*step+(split?(cellZ===iz?.025:-.025):0),y=ground.heightAt(x,z);
    if(split)splitCorners++;
    // Shared, faceted metre-scale relief follows the parent DEM. The major
    // buttress and cleft shape comes from structuralCoastHeight's same flag.
    const relief=-.045+(fractureRelief(x,y,z)+.045)*boundaryWeight(ix,iz);
    maxRelief=Math.max(maxRelief,relief);minRelief=Math.min(minRelief,relief);
    const index=positions.length/3;
    positions.push(x,y+relief,z,x,y-1.4,z);
    uvs.push(x*.2,(y+relief)*.2,x*.2,(y-1.4)*.2);
    const shade=.94+.045*Math.sin(x*.071+z*.039+y*.11);
    colors.push(shade,shade*.995,shade*1.015,.87,.865,.885);
    vertices.set(key,index);minY=Math.min(minY,y+relief);return index;
  };
  const edge=(a:number,b:number)=>{
    const key=a<b?`${a}:${b}`:`${b}:${a}`,old=edges.get(key);
    if(old)old.count++;else edges.set(key,{a,b,count:1});
  };
  for(let iz=0;bounds.minZ+14+(iz+1)*step<bounds.maxZ-14;iz++){
    for(let ix=0;bounds.minX+14+(ix+1)*step<bounds.maxX-14;ix++){
      // Four front and back facets plus four walls: strict worst-case cap.
      if((selectedCells.length+1)*16>80000)break;
      const corners=[[ix,iz],[ix,iz+1],[ix+1,iz+1],[ix+1,iz]];
      const samples=[...corners,[ix+.5,iz+.5]].map(([i,j])=>{const x=bounds.minX+14+i*step,z=bounds.minZ+14+j*step;
        const y=ground.heightAt(x,z),gx=(ground.heightAt(x+2,z)-ground.heightAt(x-2,z))/4,
          gz=(ground.heightAt(x,z+2)-ground.heightAt(x,z-2))/4;
        return {x,z,y,gx,gz,slope:Math.hypot(gx,gz)};});
      // Entire footprint must be dry steep land. Low sand and crown gaps are
      // intentionally left bare, so this shell cannot cross a beach/boat route.
      if(samples.some(p=>!Number.isFinite(p.y)||p.y<3.5||p.y>52||p.slope<1.05||
        (p.y<10&&sandAt(p.x,p.z)>.3)))continue;
      if(samples.some(p=>ground.heightAt(p.x+p.gx/p.slope*7,p.z+p.gz/p.slope*7)<p.y+3))continue;
      selectedCells.push({ix,iz});selected.add(`${ix}:${iz}`);
    }
  }
  for(const {ix,iz} of selectedCells){
      const corners=[[ix,iz],[ix,iz+1],[ix+1,iz+1],[ix+1,iz]];
      const ids=corners.map(([i,j])=>point(i,j,ix,iz));
      // A shared center samples the joint field between corners. This creates
      // genuine transverse normal changes without tessellating the whole DEM.
      const centre=point(ix+.5,iz+.5);
      for(let i=0;i<4;i++){
        const next=ids[(i+1)%4];
        indices.push(ids[i],next,centre,ids[i]+1,centre+1,next+1);
      }
      for(let i=0;i<4;i++)edge(ids[i],ids[(i+1)%4]);
      const proxy:CliffCollisionProxy={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
      for(const id of [...ids,centre])for(const k of [id,id+1]){
        proxy.minX=Math.min(proxy.minX,positions[k*3]);proxy.maxX=Math.max(proxy.maxX,positions[k*3]);
        proxy.minY=Math.min(proxy.minY,positions[k*3+1]);proxy.maxY=Math.max(proxy.maxY,positions[k*3+1]);
        proxy.minZ=Math.min(proxy.minZ,positions[k*3+2]);proxy.maxZ=Math.max(proxy.maxZ,positions[k*3+2]);
      }
      proxies.push(proxy);cells++;
  }
  let boundaryEdges=0;
  for(const {a,b,count} of edges.values())if(count===1){
    indices.push(a,a+1,b+1,a,b+1,b);boundaryEdges++;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  geometry.userData={connectedFormCandidate:true,coherentCandidate:true,triangleCount:indices.length/3,triangleLimit:80000,
    outcropCount:cells,rockPieces:0,connectedCells:cells,boundaryEdges,closedVolumes:true,
    splitCorners,cornerSeparationM:.025,
    // Vertical relief bounds are measured; surface-normal distance depends on
    // the local source slope and must not be advertised as this vertical value.
    maxVerticalReliefM:maxRelief,minVerticalReliefM:Number.isFinite(minRelief)?minRelief:null,boundaryApronMeters:step,boundaryEmbedMeters:.045,
    fractureFamilies:2,fractureGeometry:'Oblique warped cellular clefts with four center-sampled facets per cell',
    maxFaceWidthM:step,minExposedVertexHeightM:Number.isFinite(minY)?minY:null,
    collisionProxies:proxies,collision:'Terrain-attached indexed shell with full per-cell volume AABBs',
    provenance:'Authored connected angular skin and DEM-bound buttress/cleft field; inferred geology, not measured scan'};
  return geometry;
}
