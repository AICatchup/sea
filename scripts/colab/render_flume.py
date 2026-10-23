"""Render diagnostic particle sections, never a replacement SEA beauty render."""
import argparse
from pathlib import Path

import imageio.v2 as imageio
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np


def render(directory):
    directory = Path(directory)
    data = np.load(directory/'particles.npz')
    positions, fps = data['positions'], int(data['fps'])
    fig, (side, top) = plt.subplots(2, 1, figsize=(10, 5.6), dpi=100,
                                   gridspec_kw={'height_ratios': [2, 1]})
    xx = np.linspace(0, 9, 300)
    bed = np.maximum(0, (xx-4)*.25)
    selected = abs(positions[0, :, 2]-.6) < .16
    side.fill_between(xx, 0, bed, color='#cbb995')
    side.axhline(1, color='#8d9aa9', lw=.6, ls='--')
    points = side.scatter([], [], s=5, vmin=0, vmax=4, cmap='viridis', linewidths=0)
    surface = top.scatter([], [], s=2, vmin=0, vmax=1.5, cmap='Blues', linewidths=0)
    side.set(xlim=(0, 9), ylim=(0, 2.3), ylabel='Height (m)')
    top.set(xlim=(0, 9), ylim=(0, 1.2), ylabel='Width (m)', xlabel='Shoreward distance (m)')
    fig.colorbar(points, ax=side, label='Particle speed (m/s)', fraction=.025)
    fig.suptitle('SEA / 3D SPH wave-flume diagnostic — not a game render', fontsize=12)
    fig.text(.5, .01, 'Idealized beach; no resolved air or foam; not calibrated to Niijima', ha='center', fontsize=8)
    fig.tight_layout(rect=(0, .025, 1, .94))
    with imageio.get_writer(directory/'wave-flume-diagnostic.mp4', fps=fps, codec='libx264',
                            quality=8, macro_block_size=2, ffmpeg_params=['-threads', '1']) as movie:
        for frame, p in enumerate(positions):
            speed = np.linalg.norm(p-positions[max(0, frame-1)], axis=1)*fps
            points.set_offsets(p[selected, :2]); points.set_array(speed[selected])
            surface.set_offsets(p[:, [0, 2]]); surface.set_array(p[:, 1])
            side.set_title(f't = {frame/fps:.2f} s | center-strip particle IDs', loc='left', fontsize=10)
            fig.canvas.draw()
            movie.append_data(np.asarray(fig.canvas.buffer_rgba())[:, :, :3])
            if frame in (0, len(positions)//2, len(positions)-1):
                fig.savefig(directory/f'flume-{frame:03d}.png')
    plt.close(fig)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory')
    render(parser.parse_args().directory)
