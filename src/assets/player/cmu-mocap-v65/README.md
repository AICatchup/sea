# CMU motion capture gait (opt-in `?motion=cmu`)

`gait-clips.json` holds looping walk, run and breaststroke clips for the `FirstPersonBody`
skeleton, baked by `scripts/bake-cmu-mocap.ts` from the CMU Graphics Lab Motion Capture
Database (http://mocap.cs.cmu.edu). Per sample and bone: a local quaternion relative to
the game parent bone, plus the lowest foot's lift above the floor (flight phase).

| clip | trials | steady cycles | cycle |
|---|---|---|---|
| walk | 35_01–35_08 | 14 | 1.13 s |
| run | 35_17–35_24 | 8 | 0.74 s |
| swim (breaststroke, also dive) | 126_03–126_05 | 22 | 1.77 s |

Rebuild (deterministic, same sha256 on rerun): download `35.asf`, `126.asf` and the listed
`.amc` files from `http://mocap.cs.cmu.edu/subjects/<subject>/`, then
`node --experimental-strip-types scripts/bake-cmu-mocap.ts <folder>`.

The data used in this project was obtained from mocap.cs.cmu.edu. The database was created
with funding from NSF EIA-0196217. Free for all uses; not for resale as data.
