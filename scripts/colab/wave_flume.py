"""Bounded CUDA wave-flume experiment, separate from SEA's production renderer.

3D weakly-compressible SPH, SI units, fixed particle mass and gravity.
Method reference: NVIDIA Warp's Apache-2.0 core/example_sph.py and
Mueller et al., Particle-Based Fluid Simulation for Interactive Applications (2003).
This independent implementation is a diagnostic, not a calibrated Niijima model.
"""
import argparse
import hashlib
import json
import math
import time
from pathlib import Path

import numpy as np
import warp as wp


@wp.kernel
def density(grid: wp.uint64, x: wp.array(dtype=wp.vec3), rho: wp.array(dtype=float),
            h: float, coefficient: float):
    i = wp.tid()
    total = float(0.0)
    for j in wp.hash_grid_query(grid, x[i], h):
        r = x[i] - x[j]
        q = wp.max(0.0, h*h - wp.dot(r, r))
        total += q*q*q
    rho[i] = wp.max(100.0, coefficient*total)


@wp.kernel
def acceleration(grid: wp.uint64, x: wp.array(dtype=wp.vec3), v: wp.array(dtype=wp.vec3),
                 rho: wp.array(dtype=float), a: wp.array(dtype=wp.vec3),
                 h: float, mass: float, sound: float):
    i = wp.tid()
    ri = rho[i]
    # Positive pressure avoids tensile clumping at an under-resolved free surface.
    pi = sound*sound*wp.max(0.0, ri - 1000.0)
    force = wp.vec3(0.0, -9.81, 0.0)
    kernel = -45.0 / (3.141592653589793*h*h*h*h*h*h)
    for j in wp.hash_grid_query(grid, x[i], h):
        r = x[i] - x[j]
        distance = wp.length(r)
        if j != i and distance > 0.00001 and distance < h:
            rj = rho[j]
            pj = sound*sound*wp.max(0.0, rj - 1000.0)
            approach = wp.dot(v[i]-v[j], r)
            viscosity = float(0.0)
            if approach < 0.0:
                mu = h*approach/(distance*distance + 0.01*h*h)
                viscosity = -0.08*sound*mu/(0.5*(ri+rj))
            gradient = kernel*(h-distance)*(h-distance)*r/distance
            force -= mass*(pi/(ri*ri) + pj/(rj*rj) + viscosity)*gradient
    a[i] = force


@wp.kernel
def integrate(x: wp.array(dtype=wp.vec3), v: wp.array(dtype=wp.vec3),
              a: wp.array(dtype=wp.vec3), dt: float, radius: float):
    i = wp.tid()
    velocity = v[i] + a[i]*dt
    p = x[i] + velocity*dt
    # Impermeable tank, open top. Beach starts at x=4m, slope=1:4.
    floor = wp.max(0.0, (p[0]-4.0)*0.25) + radius
    if p[1] < floor:
        normal = wp.vec3(0.0, 1.0, 0.0)
        if p[0] > 4.0:
            normal = wp.normalize(wp.vec3(-0.25, 1.0, 0.0))
        p += normal*((floor-p[1])/normal[1])
        velocity -= normal*wp.min(0.0, wp.dot(velocity, normal))
    if p[0] < radius:
        p[0] = radius
        velocity[0] = wp.max(0.0, velocity[0])
    if p[0] > 9.0-radius:
        p[0] = 9.0-radius
        velocity[0] = wp.min(0.0, velocity[0])
    if p[2] < radius:
        p[2] = radius
        velocity[2] = wp.max(0.0, velocity[2])
    if p[2] > 1.2-radius:
        p[2] = 1.2-radius
        velocity[2] = wp.min(0.0, velocity[2])
    x[i] = p
    v[i] = velocity


def initial_conditions(spacing):
    axes = [np.arange(spacing*.5, bound, spacing) for bound in (8.0, 1.5, 1.2)]
    p = np.stack(np.meshgrid(*axes, indexing='ij'), axis=-1).reshape(-1, 3)
    depth, amplitude, center = 1.0, .38, 2.0
    k = math.sqrt(3*amplitude/(4*depth**3))
    eta = amplitude/np.cosh(k*(p[:, 0]-center))**2
    bed = np.maximum(0, (p[:, 0]-4)*.25)
    mask = (p[:, 1] > bed+spacing*.35) & (p[:, 1] < depth+eta)
    p, eta = p[mask], eta[mask]
    speed = math.sqrt(9.81*(depth+amplitude))
    v = np.zeros_like(p)
    v[:, 0] = speed*eta/(depth+eta)
    deta = -2*k*eta*np.tanh(k*(p[:, 0]-center))
    v[:, 1] = -p[:, 1]*speed*depth*deta/(depth+eta)**2
    return p.astype(np.float32), v.astype(np.float32)


def run(args):
    wp.init()
    device = wp.get_device('cuda:0')
    if not device.is_cuda:
        raise RuntimeError('CUDA GPU required; no silent local CPU fallback')
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    p, velocities = initial_conditions(args.spacing)
    count, h = len(p), args.spacing*2
    mass, sound = 1000*args.spacing**3, 30.0
    # Acoustic CFL < 0.2 for the intended velocity range.
    dt = min(1/2400, .15*h/(sound+10))
    substeps = math.ceil(1/(args.fps*dt))
    dt = 1/(args.fps*substeps)
    frames = round(args.seconds*args.fps)
    with wp.ScopedDevice(device):
        x = wp.array(p, dtype=wp.vec3)
        v = wp.array(velocities, dtype=wp.vec3)
        rho, a = wp.zeros(count, dtype=float), wp.zeros(count, dtype=wp.vec3)
        grid = wp.HashGrid(128, 32, 32)
        snapshots, checks = [p.copy()], []
        started = time.monotonic()
        for frame in range(frames):
            if time.monotonic()-started > args.wall_seconds:
                raise TimeoutError('GPU experiment wall-time budget reached')
            for _ in range(substeps):
                grid.build(x, h)
                wp.launch(density, count, [grid.id, x, rho, h, 315*mass/(64*math.pi*h**9)])
                wp.launch(acceleration, count, [grid.id, x, v, rho, a, h, mass, sound])
                wp.launch(integrate, count, [x, v, a, dt, args.spacing*.35])
            positions, speeds, densities = x.numpy(), v.numpy(), rho.numpy()
            if not all(np.isfinite(q).all() for q in (positions, speeds, densities)):
                raise FloatingPointError('Nonfinite fluid state')
            vmax = float(np.linalg.norm(speeds, axis=1).max())
            if vmax > 15:
                raise FloatingPointError(f'Unstable velocity {vmax:.2f}m/s; experiment rejected')
            snapshots.append(positions)
            checks.append({'time': (frame+1)/args.fps, 'maxSpeed': vmax,
                           'maxHeight': float(positions[:, 1].max()),
                           'densityP99': float(np.quantile(densities, .99))})
            if frame % args.fps == 0:
                print(f'frame {frame+1}/{frames}: maxSpeed={vmax:.3f}', flush=True)
    array = np.asarray(snapshots)
    np.savez_compressed(out/'particles.npz', positions=array, fps=args.fps, spacing=args.spacing)
    report = dict(device=device.name, particles=count, massKg=mass*count, gravity=9.81,
                  simulatedSeconds=frames/args.fps, wallSeconds=time.monotonic()-started,
                  dt=dt, spacing=args.spacing, frames=len(array), checks=checks,
                  positionSha256=hashlib.sha256(array.tobytes()).hexdigest(),
                  calibratedToNiijima=False, productionIntegrated=False,
                  limitations=['coarse single-phase SPH', 'projected wall boundary',
                               'no resolved air entrainment or bubbles', 'idealized solitary pulse and beach'])
    (out/'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='checks'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='/content/sea-wave-output')
    parser.add_argument('--seconds', type=float, default=3.0)
    parser.add_argument('--spacing', type=float, default=.1)
    parser.add_argument('--fps', type=int, default=12)
    parser.add_argument('--wall-seconds', type=float, default=240)
    args = parser.parse_args()
    if not (.06 <= args.spacing <= .2 and 0 < args.seconds <= 8 and 4 <= args.fps <= 30 and 0 < args.wall_seconds <= 600):
        parser.error('Experiment exceeds the bounded configuration')
    run(args)
