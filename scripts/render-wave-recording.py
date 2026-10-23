"""Decode the dev recording into actual game frames and a sound-equipped MP4.
No browser control. No generated/interpolated frames. Existing outputs are preserved.
"""
import argparse
import base64
import json
import math
import subprocess
import wave
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("recording", type=Path)
p.add_argument("output", type=Path)
a = p.parse_args()
if a.output.exists():
    raise SystemExit("Use a new output directory; existing evidence is preserved")
if a.recording.stat().st_size > 200 * 1024 * 1024:
    raise SystemExit("Recording exceeds the bounded capture limit")
d = json.loads(a.recording.read_text(encoding="utf-8"))
frames = d["frames"]
if not (2 <= len(frames) <= 181 and d["fps"] == 10):
    raise SystemExit("Expected a bounded 10fps game recording")
for i, f in enumerate(frames):
    if not math.isfinite(f["time"]) or abs(f["time"] - frames[0]["time"] - i / 10) > 1e-5:
        raise SystemExit("Non-uniform simulation clock")
a.output.mkdir(parents=True)
for i, f in enumerate(frames):
    prefix, data = f.pop("jpeg").split(",", 1)
    if prefix != "data:image/jpeg;base64":
        raise SystemExit("Unexpected frame encoding")
    (a.output / f"{i:04d}.jpg").write_bytes(base64.b64decode(data, validate=True))
prefix, data = d.pop("wav").split(",", 1)
if prefix != "data:audio/wav;base64":
    raise SystemExit("Unexpected audio encoding")
(a.output / "sound.wav").write_bytes(base64.b64decode(data, validate=True))
(a.output / "runtime.json").write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
with wave.open(str(a.output / "sound.wav")) as w:
    import array
    pcm = array.array("h", w.readframes(w.getnframes()))
    audio = {"channels": w.getnchannels(), "sampleRate": w.getframerate(),
             "seconds": len(pcm) / w.getnchannels() / w.getframerate(),
             "peak": max(abs(x) for x in pcm) / 32768,
             "rms": math.sqrt(sum(float(x)*x for x in pcm)/len(pcm))/32768}
summary = {"frames": len(frames), "fps": d["fps"], "realtime": False, "audio": audio,
           "maxAcrossGap": max((f["spray"]["geometryAudit"]["maxAcrossGap"] for f in frames if f["spray"]["geometryAudit"]), default=0),
           "maxAlongGap": max((f["spray"]["geometryAudit"]["maxAlongGap"] for f in frames if f["spray"]["geometryAudit"]), default=0),
           "lastSpray": frames[-1]["spray"]}
(a.output / "verification.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
subprocess.run(["ffmpeg", "-nostdin", "-v", "warning", "-framerate", "10", "-i", str(a.output / "%04d.jpg"),
               "-i", str(a.output / "sound.wav"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
               "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", str(a.output / "wave-lifecycle.mp4")], check=True)
print(json.dumps(summary, indent=2))
