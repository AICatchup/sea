// Minimal typing for the meshoptimizer simplifier that ships with three.
declare module 'three/examples/jsm/libs/meshopt_simplifier.module.js' {
  export const MeshoptSimplifier: {
    readonly ready: Promise<void>;
    /** Returns the reduced index list and the relative error actually reached. */
    simplify(indices: Uint32Array, positions: Float32Array, stride: number, targetIndexCount: number, targetError: number, flags?: string[]): [Uint32Array, number];
    /** Topology-free clustering; reaches budgets that seams or split vertices block. */
    simplifySloppy(indices: Uint32Array, positions: Float32Array, stride: number, lock: Uint8Array | null, targetIndexCount: number, targetError: number): [Uint32Array, number];
    getScale(positions: Float32Array, stride: number): number;
  };
}
