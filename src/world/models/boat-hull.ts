import * as THREE from 'three';

/** Existing station geometry with independent port/starboard panels, chines,
 * keel and planar end caps. Smoothing changes shading only, not the envelope. */
export function boatHullGeometry(bottom = false,smooth=true): THREE.BufferGeometry {
    const stations = [
      [-2.8, 0.035, 0.16], [-2.55, 0.38, 0.01], [-2.05, 0.75, -0.13], [-1.3, 0.99, -0.24],
      [-0.35, 1.07, -0.31], [0.65, 1.05, -0.33], [1.65, 0.99, -0.29], [2.5, 0.91, -0.24],
    ];
    const vertices: number[] = [], uv: number[] = [], groups:number[]=[];
    let surfaceGroup=0;
    const ring = (station: number[], side: number, level: number) => {
      const [z, width, keel] = station;
      if (bottom) return new THREE.Vector3(side * width * [0.91, 0.78, 0.64][level], [0.365, 0.085, 0.075][level], z);
      return new THREE.Vector3(side * width * (level === 0 ? 1 : level === 1 ? 0.86 : 0.16), level === 0 ? 0.39 : level === 1 ? -0.11 : keel - 0.27, z);
    };
    const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      groups.push(surfaceGroup,surfaceGroup,surfaceGroup);
      for (const p of [a, b, c]) uv.push((p.z + 2.8) / 1.7, p.y * 2 + Math.abs(p.x));
    };
    for (const side of [-1, 1]) for (let i = 1; i < stations.length; i++) for (let level = 0; level < 2; level++) {
      surfaceGroup=(side<0?0:2)+level;
      const a = ring(stations[i - 1], side, level), b = ring(stations[i], side, level);
      const c = ring(stations[i], side, level + 1), d = ring(stations[i - 1], side, level + 1);
      if ((side === 1) === bottom) { triangle(a, c, b); triangle(a, d, c); }
      else { triangle(a, b, c); triangle(a, c, d); }
    }
    for (let i = 1; i < stations.length; i++) {
      surfaceGroup=4;
      const a = ring(stations[i - 1], -1, 2), b = ring(stations[i], -1, 2);
      const c = ring(stations[i], 1, 2), d = ring(stations[i - 1], 1, 2);
      if (bottom) { triangle(a, b, c); triangle(a, c, d); }
      else { triangle(a, c, b); triangle(a, d, c); }
    }
    for (const index of [0, stations.length - 1]) {
      surfaceGroup=index===0?5:6;
      const a = ring(stations[index], -1, 0), b = ring(stations[index], 1, 0);
      const c = ring(stations[index], 1, 2), d = ring(stations[index], -1, 2);
      if ((index === 0) !== bottom) { triangle(a, b, c); triangle(a, c, d); }
      else { triangle(a, c, b); triangle(a, d, c); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals();
    if(smooth){
      const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),sums=new Map<string,THREE.Vector3>();
      const key=(i:number)=>`${groups[i]}:${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),face=new THREE.Vector3();
      for(let i=0;i<p.count;i+=3){
        a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
        face.crossVectors(b.sub(a),c.sub(a));
        for(let j=i;j<i+3;j++){const k=key(j),sum=sums.get(k)??new THREE.Vector3();sum.add(face);sums.set(k,sum);}
      }
      for(const sum of sums.values())sum.normalize();
      for(let i=0;i<p.count;i++){const v=sums.get(key(i))!;n.setXYZ(i,v.x,v.y,v.z);}
    }
    geometry.userData.hullSurfaceGroups=groups;return geometry;
  }

