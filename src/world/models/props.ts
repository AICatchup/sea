import * as THREE from 'three';
import { addBoatCushion, boatUpholsteryMaterial } from './boat-upholstery';
import { ModelBatch, ModelResources, rockGeometry, standard, surfaceTexture } from './procedural';

export class CoastalModels {
  readonly resources = new ModelResources();
  readonly stone: THREE.MeshStandardMaterial;
  readonly bark: THREE.MeshStandardMaterial;
  readonly needles: THREE.MeshStandardMaterial;
  readonly wood: THREE.MeshStandardMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly white: THREE.MeshStandardMaterial;
  readonly canvas: THREE.MeshStandardMaterial;
  readonly blue: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly orange: THREE.MeshStandardMaterial;
  readonly rope: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly rocks: THREE.BufferGeometry[];
  readonly chair: THREE.Group;
  readonly umbrella: THREE.Group;
  readonly buoy: THREE.Group;
  readonly tank: THREE.Group;
  readonly boarding: THREE.Group;
  readonly boat: THREE.Group;
  readonly propeller: THREE.Group;
  readonly outboard: THREE.Group;

  constructor() {
    const resources = this.resources;
    this.stone = standard(resources, '#e1e0d9');
    this.stone.map = surfaceTexture(resources, '#d1d0c6', 'stone', 902); this.stone.vertexColors = true;
    this.bark = standard(resources, '#b6aca0');
    this.bark.map = surfaceTexture(resources, '#807569', 'bark', 71);
    this.needles = standard(resources, '#36532d', 0.95); this.needles.vertexColors = true;
    this.wood = standard(resources, '#b29b78');
    this.wood.map = surfaceTexture(resources, '#b9a184', 'bark', 311);
    this.metal = standard(resources, '#b5c0c4', 0.27, 0.85);
    this.white = standard(resources, '#e9ece7', 0.32);
    this.white.map = surfaceTexture(resources, '#ecede7', 'paint', 203);
    this.canvas = standard(resources, '#dcdac8', 0.91);
    this.canvas.map = surfaceTexture(resources, '#eeebdb', 'cloth', 287);
    this.canvas.side = THREE.DoubleSide;
    this.blue = standard(resources, '#264e60', 0.72);
    this.rubber = standard(resources, '#20282b', 0.74);
    this.orange = standard(resources, '#d16e2e', 0.57);
    this.rope = standard(resources, '#a8a996', 0.96);
    this.glass = resources.material(new THREE.MeshPhysicalMaterial({ color: '#b5d1d3', metalness: 0,
      roughness: 0.12, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide,
      clearcoat: 1, clearcoatRoughness: 0.08 }));
    this.rocks = [491, 657, 819].map((seed) => rockGeometry(resources, seed));
    this.chair = this.buildChair();
    this.umbrella = this.buildUmbrella();
    this.buoy = this.buildBuoy();
    this.tank = this.buildTank();
    this.boarding = this.buildBoarding();
    const vessel = this.buildBoat(); this.boat = vessel.boat; this.propeller = vessel.propeller; this.outboard = vessel.outboard;
  }

  private buildChair(): THREE.Group {
    const batch = new ModelBatch();
    // Real tubular frame and separate cloth thickness; a reclined folding beach chair.
    for (const x of [-0.31, 0.31]) {
      batch.rod(this.metal, new THREE.Vector3(x, 0.06, -0.51), new THREE.Vector3(x, 0.78, 0.29), 0.015);
      batch.rod(this.metal, new THREE.Vector3(x, 0.06, 0.53), new THREE.Vector3(x, 0.57, -0.35), 0.015);
      batch.rod(this.metal, new THREE.Vector3(x, 0.37, 0.26), new THREE.Vector3(x, 1.09, 0.65), 0.017);
      batch.box(this.wood, x, 0.62, 0.05, 0.07, 0.035, 0.63, -0.1);
      for (const z of [-0.51, 0.53]) batch.box(this.rubber, x, 0.035, z, 0.06, 0.04, 0.075);
    }
    batch.rod(this.metal, new THREE.Vector3(-0.31, 0.4, -0.32), new THREE.Vector3(0.31, 0.4, -0.32), 0.017);
    batch.rod(this.metal, new THREE.Vector3(-0.31, 1.09, 0.65), new THREE.Vector3(0.31, 1.09, 0.65), 0.016);
    batch.box(this.canvas, 0, 0.395, -0.06, 0.58, 0.025, 0.66, 0.055);
    batch.box(this.canvas, 0, 0.74, 0.445, 0.57, 0.025, 0.8, -1.075);
    batch.box(this.blue, 0, 0.99, 0.573, 0.56, 0.028, 0.17, -1.075);
    const group = batch.finish(this.resources, 'folding beach chair');
    group.userData.footprint = { radius: 0.7, height: 1.1 }; return group;
  }

  private buildUmbrella(): THREE.Group {
    const batch = new ModelBatch();
    batch.rod(this.wood, new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 2.38, 0), 0.022);
    const panels: number[][] = [[], []];
    const sectors = 12, rows = 4, radius = 1.46;
    const canopy = (angle: number, t: number) => new THREE.Vector3(Math.cos(angle) * radius * t,
      2.31 - 0.51 * Math.pow(t, 1.25), Math.sin(angle) * radius * t);
    for (let i = 0; i < sectors; i++) {
      const start = i / sectors * Math.PI * 2, end = (i + 1) / sectors * Math.PI * 2;
      const panel = panels[i % 4 === 0 ? 1 : 0];
      for (let r = 0; r < rows; r++) {
        const a = canopy(start, r / rows), b = canopy(end, r / rows);
        const c = canopy(end, (r + 1) / rows), d = canopy(start, (r + 1) / rows);
        panel.push(...a.toArray(), ...c.toArray(), ...b.toArray(), ...a.toArray(), ...d.toArray(), ...c.toArray());
      }
      batch.tube(this.metal, [new THREE.Vector3(0, 2.23, 0), canopy(start, 0.55).add(new THREE.Vector3(0, -0.045, 0)), canopy(start, 1)], 0.008, 10);
      const hem = canopy(start, 1), hemEnd = canopy(end, 1);
      batch.rod(this.canvas, hem, hemEnd, 0.016);
    }
    panels.forEach((vertices, index) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals(); batch.add(geometry, index ? this.blue : this.canvas);
    });
    batch.add(new THREE.SphereGeometry(0.042, 10, 6), this.wood, new THREE.Vector3(0, 2.35, 0));
    const group = batch.finish(this.resources, 'woven sun umbrella');
    group.userData.footprint = { radius: 0.12, height: 2.4 }; return group;
  }

  private buildBuoy(): THREE.Group {
    const batch = new ModelBatch();
    batch.add(new THREE.SphereGeometry(0.27, 16, 12), this.orange, new THREE.Vector3(0, 0.09, 0), new THREE.Vector3(1, 0.93, 1));
    batch.add(new THREE.TorusGeometry(0.263, 0.027, 6, 20), this.white, new THREE.Vector3(0, 0.1, 0), undefined, new THREE.Euler(Math.PI / 2, 0, 0));
    batch.add(new THREE.TorusGeometry(0.045, 0.009, 6, 12), this.metal, new THREE.Vector3(0, 0.34, 0));
    batch.tube(this.rope, [new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0.06, -0.65, -0.07), new THREE.Vector3(0.01, -1.15, 0.04)], 0.009, 10);
    return batch.finish(this.resources, 'anchored marker buoy');
  }

  private buildTank(): THREE.Group {
    const batch = new ModelBatch();
    batch.add(new THREE.CapsuleGeometry(0.135, 0.53, 5, 16), this.metal, new THREE.Vector3(0, 0.41, 0));
    batch.add(new THREE.CylinderGeometry(0.141, 0.141, 0.09, 16), this.rubber, new THREE.Vector3(0, 0.06, 0));
    for (const y of [0.26, 0.56]) batch.add(new THREE.TorusGeometry(0.138, 0.022, 5, 16), this.rubber, new THREE.Vector3(0, y, 0), undefined, new THREE.Euler(Math.PI / 2, 0, 0));
    batch.rod(this.metal, new THREE.Vector3(0, 0.78, 0), new THREE.Vector3(0, 0.86, 0), 0.023);
    batch.rod(this.metal, new THREE.Vector3(-0.055, 0.855, 0), new THREE.Vector3(0.085, 0.855, 0), 0.015);
    batch.add(new THREE.CylinderGeometry(0.043, 0.043, 0.035, 10), this.rubber, new THREE.Vector3(-0.056, 0.854, 0), undefined, new THREE.Euler(0, 0, Math.PI / 2));
    for (const x of [-0.17, 0.17]) {
      batch.add(new THREE.SphereGeometry(1, 10, 8), this.rubber, new THREE.Vector3(x, 0.43, 0.115), new THREE.Vector3(0.09, 0.29, 0.095));
      batch.box(this.rubber, x * 0.85, 0.47, 0.205, 0.04, 0.51, 0.025);
    }
    batch.tube(this.rubber, [new THREE.Vector3(0.07, 0.85, 0), new THREE.Vector3(0.28, 0.88, 0.02), new THREE.Vector3(0.35, 0.49, 0.16), new THREE.Vector3(0.19, 0.31, 0.18)], 0.014, 22);
    batch.tube(this.orange, [new THREE.Vector3(-0.01, 0.84, 0), new THREE.Vector3(-0.25, 0.78, 0.02), new THREE.Vector3(-0.28, 0.37, 0.13)], 0.012, 18);
    batch.add(new THREE.CylinderGeometry(0.043, 0.043, 0.025, 12), this.metal, new THREE.Vector3(0.19, 0.31, 0.18), undefined, new THREE.Euler(Math.PI / 2, 0, 0));
    batch.box(this.rubber, 0.19, 0.32, 0.21, 0.052, 0.024, 0.06);
    // A pair of long, subtly curved fins laid beside the BCD/tank, recognizable while walking.
    for (const x of [0.36, 0.56]) {
      batch.add(new THREE.SphereGeometry(1, 10, 6), this.blue, new THREE.Vector3(x, 0.05, 0.15), new THREE.Vector3(0.083, 0.018, 0.32));
      batch.add(new THREE.TorusGeometry(0.055, 0.019, 5, 12), this.rubber, new THREE.Vector3(x, 0.058, 0.36), new THREE.Vector3(1, 1.45, 1), new THREE.Euler(Math.PI / 2, 0, 0));
    }
    const group = batch.finish(this.resources, 'scuba tank BCD regulator and fins');
    group.userData.footprint = { radius: 0.6, height: 0.9 }; return group;
  }

  private buildBoarding(): THREE.Group {
    const batch = new ModelBatch();
    for (let i = 0; i < 17; i++) batch.box(this.wood, 0, 0.115, (i - 8) * 0.205, 1.7, 0.07, 0.192);
    for (const x of [-0.57, 0.57]) batch.box(this.wood, x, 0.055, 0, 0.09, 0.08, 3.5);
    for (const x of [-0.76, 0.76]) for (const z of [-1.5, 1.5]) batch.box(this.wood, x, -0.19, z, 0.13, 0.65, 0.13);
    for (const z of [-1.27, 1.27]) batch.rod(this.metal, new THREE.Vector3(0.71, 0.14, z), new THREE.Vector3(0.71, 0.83, z), 0.018);
    batch.rod(this.metal, new THREE.Vector3(0.71, 0.83, -1.27), new THREE.Vector3(0.71, 0.83, 1.27), 0.019);
    batch.add(new THREE.TorusGeometry(0.26, 0.065, 8, 24), this.orange, new THREE.Vector3(0.73, 0.49, 0), undefined, new THREE.Euler(0, Math.PI / 2, 0));
    const group = batch.finish(this.resources, 'fictional shore boarding platform');
    group.userData.provenance = 'Authored adventure fixture; not a surveyed structure at Tomari beach.';
    return group;
  }

  private hullGeometry(bottom = false): THREE.BufferGeometry {
    const stations = [
      [-2.8, 0.035, 0.16], [-2.55, 0.38, 0.01], [-2.05, 0.75, -0.13], [-1.3, 0.99, -0.24],
      [-0.35, 1.07, -0.31], [0.65, 1.05, -0.33], [1.65, 0.99, -0.29], [2.5, 0.91, -0.24],
    ];
    const vertices: number[] = [], uv: number[] = [];
    const ring = (station: number[], side: number, level: number) => {
      const [z, width, keel] = station;
      if (bottom) return new THREE.Vector3(side * width * [0.91, 0.78, 0.64][level], [0.365, 0.085, 0.075][level], z);
      return new THREE.Vector3(side * width * (level === 0 ? 1 : level === 1 ? 0.86 : 0.16), level === 0 ? 0.39 : level === 1 ? -0.11 : keel - 0.27, z);
    };
    const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      for (const p of [a, b, c]) uv.push((p.z + 2.8) / 1.7, p.y * 2 + Math.abs(p.x));
    };
    for (const side of [-1, 1]) for (let i = 1; i < stations.length; i++) for (let level = 0; level < 2; level++) {
      const a = ring(stations[i - 1], side, level), b = ring(stations[i], side, level);
      const c = ring(stations[i], side, level + 1), d = ring(stations[i - 1], side, level + 1);
      if ((side === 1) === bottom) { triangle(a, c, b); triangle(a, d, c); }
      else { triangle(a, b, c); triangle(a, c, d); }
    }
    for (let i = 1; i < stations.length; i++) {
      const a = ring(stations[i - 1], -1, 2), b = ring(stations[i], -1, 2);
      const c = ring(stations[i], 1, 2), d = ring(stations[i - 1], 1, 2);
      if (bottom) { triangle(a, b, c); triangle(a, c, d); }
      else { triangle(a, c, b); triangle(a, d, c); }
    }
    for (const index of [0, stations.length - 1]) {
      const a = ring(stations[index], -1, 0), b = ring(stations[index], 1, 0);
      const c = ring(stations[index], 1, 2), d = ring(stations[index], -1, 2);
      if ((index === 0) !== bottom) { triangle(a, b, c); triangle(a, c, d); }
      else { triangle(a, c, b); triangle(a, d, c); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals(); return geometry;
  }

  private buildBoat(): { boat: THREE.Group; outboard: THREE.Group; propeller: THREE.Group } {
    const batch = new ModelBatch();
    batch.add(this.hullGeometry(), this.white);
    const inner = this.hullGeometry(true); // Inner liner is separated from the outer skin by a real gunnel.
    inner.scale(0.94, 1, 0.985); batch.add(inner, this.white);
    batch.box(this.white, 0, 0.075, 0.15, 1.74, 0.075, 4.0);
    for (const side of [-1, 1]) {
      const gunwale = [new THREE.Vector3(side * 0.07, 0.42, -2.69), new THREE.Vector3(side * 0.77, 0.42, -1.98),
        new THREE.Vector3(side * 1.04, 0.42, -0.5), new THREE.Vector3(side * 1.03, 0.42, 0.65), new THREE.Vector3(side * 0.91, 0.42, 2.46)];
      batch.tube(this.white, gunwale, 0.067, 32);
      batch.tube(this.blue, gunwale.map((p) => p.clone().add(new THREE.Vector3(side * 0.017, -0.115, 0))), 0.035, 32);
      const rail = gunwale.slice(0, 4).map((p) => p.clone().add(new THREE.Vector3(0, 0.43, 0)));
      batch.tube(this.metal, rail, 0.017, 32);
      for (const i of [1, 2, 3]) batch.rod(this.metal, gunwale[i], rail[i], 0.015);
      for (const z of [-0.25, 1.45]) {
        batch.add(new THREE.CapsuleGeometry(0.088, 0.33, 4, 12), this.white, new THREE.Vector3(side * 1.085, 0.085, z));
        batch.rod(this.rope, new THREE.Vector3(side * 1.085, 0.34, z), new THREE.Vector3(side * 1.03, 0.52, z), 0.008);
      }
    }
    // Independent boat upholstery keeps shared beach chair and umbrella cloth unchanged.
    const upholstery = boatUpholsteryMaterial(this.resources);
    // Bow casting seat and aft bench, thick cushions with a restrained blue piping line.
    batch.box(this.white, 0, 0.23, -1.77, 1.32, 0.23, 0.8);
    addBoatCushion(batch, upholstery, this.blue, new THREE.Vector3(0, 0.37, -1.77), 1.32, 0.075, 0.8);
    batch.box(this.white, 0, 0.28, 1.89, 1.64, 0.28, 0.57);
    addBoatCushion(batch, upholstery, this.blue, new THREE.Vector3(0, 0.45, 1.89), 1.66, 0.08, 0.58);
    addBoatCushion(batch, upholstery, this.blue, new THREE.Vector3(0, 0.69, 2.18), 1.6, 0.08, 0.28, new THREE.Euler(Math.PI / 2, 0, 0), 2);
    for (const x of [-0.48, 0.48]) {
      batch.rod(this.metal, new THREE.Vector3(x, 0.1, 0.89), new THREE.Vector3(x, 0.62, 0.89), 0.048);
      addBoatCushion(batch, upholstery, this.blue, new THREE.Vector3(x, 0.64, 0.89), 0.54, 0.115, 0.52, undefined, x * 7);
      addBoatCushion(batch, upholstery, this.blue, new THREE.Vector3(x, 0.87, 1.11), 0.51, 0.105, 0.44, new THREE.Euler(Math.PI / 2 - 0.12, 0, 0), x * 11);
    }
    batch.box(this.white, 0.35, 0.57, -0.15, 0.7, 0.84, 0.64);
    batch.box(this.blue, 0.35, 1.015, -0.105, 0.62, 0.05, 0.56, 0.13);
    batch.box(this.rubber, 0.51, 1.06, -0.19, 0.18, 0.035, 0.13, 0.13);
    batch.box(this.glass, 0.51, 1.083, -0.19, 0.145, 0.008, 0.095, 0.13);
    for (const x of [0.21, 0.31]) batch.add(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 12), this.white, new THREE.Vector3(x, 1.064, -0.23));
    const wheelCenter = new THREE.Vector3(0.26, 1.065, 0.23);
    batch.add(new THREE.TorusGeometry(0.15, 0.017, 8, 24), this.rubber, wheelCenter, undefined, new THREE.Euler(-0.26, 0, 0));
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      batch.rod(this.metal, wheelCenter, wheelCenter.clone().add(new THREE.Vector3(Math.cos(angle) * 0.13, Math.sin(angle) * 0.125, Math.sin(angle) * -0.035)), 0.007);
    }
    batch.rod(this.metal, new THREE.Vector3(0.76, 0.69, 0.2), new THREE.Vector3(0.76, 0.93, 0.15), 0.012);
    batch.add(new THREE.SphereGeometry(0.029, 8, 6), this.rubber, new THREE.Vector3(0.76, 0.93, 0.15));
    // Sloping windscreen with a solid frame and correctly transparent individual panes.
    batch.box(this.glass, 0.24, 1.25, -0.5, 1.02, 0.54, 0.016, -0.2);
    for (const x of [-0.28, 0.76]) batch.rod(this.metal, new THREE.Vector3(x, 1.0, -0.45), new THREE.Vector3(x, 1.51, -0.55), 0.014);
    batch.rod(this.metal, new THREE.Vector3(-0.28, 1.51, -0.55), new THREE.Vector3(0.76, 1.51, -0.55), 0.015);
    // Light canvas bimini, with tubular support arcs rather than a heavy roof.
    for (const x of [-0.87, 0.87]) {
      batch.tube(this.metal, [new THREE.Vector3(x, 0.47, 1.36), new THREE.Vector3(x, 1.38, 1.14), new THREE.Vector3(x, 2.11, 0.85), new THREE.Vector3(x, 2.16, -0.66)], 0.019, 18);
      batch.rod(this.metal, new THREE.Vector3(x, 0.45, -0.21), new THREE.Vector3(x, 2.1, -0.55), 0.017);
    }
    batch.box(this.canvas, 0, 2.16, 0.12, 1.84, 0.027, 1.74);
    batch.box(this.blue, 0, 2.15, 0.99, 1.85, 0.062, 0.025);
    for (const z of [-0.67, 0.92]) batch.rod(this.metal, new THREE.Vector3(-0.88, 2.125, z), new THREE.Vector3(0.88, 2.125, z), 0.016);
    // Bow cleat, stern cleats, coiled mooring rope, hatch hinges, and ladder.
    for (const [x, z] of [[0, -2.33], [-0.77, 2.23], [0.77, 2.23]]) {
      batch.box(this.metal, x, 0.44, z, 0.16, 0.026, 0.042);
      for (const dx of [-0.052, 0.052]) batch.rod(this.metal, new THREE.Vector3(x + dx, 0.39, z), new THREE.Vector3(x + dx, 0.45, z), 0.013);
    }
    for (let i = 0; i < 4; i++) batch.add(new THREE.TorusGeometry(0.13 + i * 0.014, 0.008, 5, 24), this.rope, new THREE.Vector3(-0.3, 0.433 + i * 0.008, -1.8), undefined, new THREE.Euler(Math.PI / 2, 0, 0));
    batch.box(this.white, -0.75, 0.18, 2.66, 0.42, 0.07, 0.39);
    for (const x of [-0.92, -0.58]) batch.rod(this.metal, new THREE.Vector3(x, 0.16, 2.78), new THREE.Vector3(x, -0.59, 2.94), 0.017);
    for (const y of [-0.07, -0.31, -0.54]) batch.rod(this.metal, new THREE.Vector3(-0.92, y, 2.92), new THREE.Vector3(-0.58, y, 2.92), 0.017);
    const boat = batch.finish(this.resources, '5.6 metre coastal motorboat');
    boat.userData.provenance = 'Authored adventure vessel; not a reconstruction of a photographed local boat.';
    boat.userData.footprint = { radius: 1.13, halfLength: 2.8, height: 2.18 };

    const motor = new ModelBatch();
    motor.add(new THREE.SphereGeometry(1, 16, 12), this.rubber, new THREE.Vector3(0, 0.1, 0.04), new THREE.Vector3(0.26, 0.39, 0.28));
    motor.box(this.blue, 0, 0.12, 0.27, 0.39, 0.08, 0.021);
    motor.box(this.metal, 0, -0.38, 0.11, 0.1, 0.47, 0.15);
    motor.box(this.rubber, 0, -0.51, 0.14, 0.41, 0.035, 0.23);
    motor.add(new THREE.ConeGeometry(0.06, 0.27, 10), this.metal, new THREE.Vector3(0, -0.64, 0.18), undefined, new THREE.Euler(Math.PI / 2, 0, 0));
    const outboard = motor.finish(this.resources, 'outboard steering assembly'); outboard.position.set(0.27, 0.02, 2.65);
    const rotor = new ModelBatch();
    rotor.add(new THREE.CylinderGeometry(0.046, 0.046, 0.095, 12), this.metal, undefined, undefined, new THREE.Euler(Math.PI / 2, 0, 0));
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      rotor.box(this.metal, Math.sin(angle) * 0.078, Math.cos(angle) * 0.078, 0, 0.076, 0.145, 0.017, 0.24, 0, -angle);
    }
    const propeller = rotor.finish(this.resources, 'outboard propeller'); propeller.position.set(0, -0.64, 0.32);
    outboard.add(propeller); boat.add(outboard);
    return { boat, outboard, propeller };
  }
}
