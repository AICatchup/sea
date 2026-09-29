/** Local, synthesized surf. Audio is created only after an explicit user gesture. */
export class SurfAudio {
  enabled = false;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private timer = 0;
  private suspendTimer = 0;
  private wind = 7.5;
  private start = 0;

  async toggle(): Promise<boolean> {
    if (!this.context) this.create();
    const context = this.context!;
    clearTimeout(this.suspendTimer);
    if (!this.enabled) {
      await context.resume();
      this.enabled = true;
      this.modulate();
    } else {
      this.enabled = false;
      clearTimeout(this.timer);
      this.gain!.gain.setTargetAtTime(0, context.currentTime, 0.18);
      this.suspendTimer = window.setTimeout(() => void context.suspend(), 1000);
    }
    return this.enabled;
  }

  setWind(wind: number): void {
    this.wind = wind;
    if (this.filter && this.context) this.filter.frequency.setTargetAtTime(750 + wind * 95, this.context.currentTime, 1);
  }

  private create(): void {
    const context = new AudioContext();
    this.context = context;
    this.start = context.currentTime;
    const buffer = context.createBuffer(2, context.sampleRate * 16, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      let brown = 0;
      for (let i = 0; i < samples.length; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + white * 0.055) / 1.025;
        samples[i] = brown * 2.5 + white * 0.13;
      }
      // Crossfade the loop join; no periodic click or external audio download.
      const join = context.sampleRate / 4;
      for (let i = 0; i < join; i++) {
        const mix = i / join;
        samples[samples.length - join + i] = samples[samples.length - join + i] * (1 - mix) + samples[i] * mix;
      }
    }
    this.source = context.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.loopStart = 0.25;
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.4;
    this.filter.frequency.value = 750 + this.wind * 95;
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 65;
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.filter).connect(highpass).connect(this.gain).connect(context.destination);
    this.source.start();
  }

  private modulate = (): void => {
    if (!this.context || !this.gain || !this.enabled) return;
    const time = this.context.currentTime - this.start;
    const wave = 0.5 + 0.5 * Math.sin(time * 0.71 + Math.sin(time * 0.19) * 0.7);
    const volume = (0.06 + this.wind * 0.007) * (0.25 + wave ** 2 * 0.75);
    this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.15);
    this.timer = window.setTimeout(this.modulate, 150);
  };

  async setVisible(visible: boolean): Promise<void> {
    if (!this.context || !this.enabled) return;
    if (visible) await this.context.resume();
    else await this.context.suspend();
  }

  dispose(): void {
    clearTimeout(this.timer); clearTimeout(this.suspendTimer);
    this.source?.stop();
    void this.context?.close();
  }
}
