/** Local stereo surf. The audio graph is created only after a user gesture. */
export class SurfAudio {
  enabled = false;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private foamGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private nodes: AudioNode[] = [];
  private timer = 0;
  private suspendTimer = 0;
  private wind = 7.5;
  private start = 0;
  private visible = !document.hidden;
  private paused = false;
  private disposed = false;
  private operation: Promise<void> = Promise.resolve();

  async toggle(): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.context) this.create();
    this.enabled = !this.enabled;
    try {
      await this.synchronize();
    } catch (error) {
      this.enabled = false;
      this.silence();
      throw error;
    }
    return this.enabled;
  }

  setWind(wind: number): void {
    this.wind = Math.max(2, Math.min(18, wind));
    if (this.filter && this.context) {
      this.filter.frequency.setTargetAtTime(650 + this.wind * 65, this.context.currentTime, 1);
    }
  }

  /** Discovery feedback respects the existing user-enabled audio switch. */
  cue():void {
    const context=this.context;if(!this.enabled||!this.visible||!context||context.state!=='running'||this.disposed)return;
    const gain=context.createGain();gain.connect(context.destination);const now=context.currentTime;
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.025,now+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+.42);
    [660,880].forEach((hz,i)=>{const tone=context.createOscillator();tone.type='sine';tone.frequency.value=hz;tone.connect(gain);tone.start(now+i*.09);tone.stop(now+.44);tone.onended=()=>{tone.disconnect();if(i===1)gain.disconnect();};});
  }

  setVisible(visible: boolean): Promise<void> {
    this.visible = visible;
    return this.synchronize();
  }

  setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    return this.synchronize();
  }

  private get playing(): boolean {
    return this.enabled && this.visible && !this.paused && !this.disposed;
  }

  private silence(): void {
    clearTimeout(this.timer);
    if (!this.context || !this.gain) return;
    this.gain.gain.cancelScheduledValues(this.context.currentTime);
    this.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
  }

  private synchronize(immediate = false): Promise<void> {
    clearTimeout(this.suspendTimer);
    if (!this.playing) this.silence();
    // Serialize browser resume/suspend promises, and recheck intent after resume.
    // A tab hidden while permission/resume is pending must never start playing.
    const operation = this.operation.catch(() => {}).then(async () => {
      const context = this.context;
      if (!context || this.disposed || context.state === 'closed') return;
      clearTimeout(this.suspendTimer);
      if (this.playing) {
        await context.resume();
        if (this.playing) {
          clearTimeout(this.timer);
          this.modulate();
        } else if (!this.disposed) {
          await context.suspend();
        }
      } else if (!this.visible || immediate) {
        await context.suspend();
      } else if (context.state === 'running') {
        this.suspendTimer = window.setTimeout(() => {
          void this.synchronize(true).catch(() => {});
        }, 450);
      }
    });
    this.operation = operation;
    return operation;
  }

  private create(): void {
    const context = new AudioContext();
    this.context = context;
    this.start = context.currentTime;
    const buffer = context.createBuffer(2, Math.floor(context.sampleRate * 24), context.sampleRate);
    const join = Math.max(2, Math.floor(context.sampleRate * 0.75));
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      let brown = 0;
      for (let i = 0; i < samples.length; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + white * 0.055) / 1.025;
        samples[i] = brown * 2.5 + white * 0.13;
      }
      // Tail fades into the lead-in, then continues at the very next sample.
      // Endpoints are exact; the source does not repeat the overlapping lead-in.
      for (let i = 0; i < join; i++) {
        const t = i / (join - 1);
        const mix = t * t * (3 - 2 * t);
        const index = samples.length - join + i;
        samples[index] = samples[index] * (1 - mix) + samples[i] * mix;
      }
    }
    this.source = context.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.loopStart = join / context.sampleRate;
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.4;
    this.filter.frequency.value = 650 + this.wind * 65;
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 65;
    const foam = context.createBiquadFilter();
    foam.type = 'bandpass';
    foam.frequency.value = 1850;
    foam.Q.value = 0.35;
    this.foamGain = context.createGain();
    this.foamGain.gain.value = 0;
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.filter).connect(highpass).connect(this.gain);
    this.source.connect(foam).connect(this.foamGain).connect(this.gain);
    this.gain.connect(context.destination);
    this.nodes = [this.source, this.filter, highpass, foam, this.foamGain, this.gain];
    this.source.start();
  }

  private modulate = (): void => {
    if (!this.context || !this.gain || !this.foamGain || !this.playing) return;
    const now = this.context.currentTime;
    const time = now - this.start;
    // Long, uneven sets, with a later bright wash and a quiet receding body.
    const phase = time * 0.58 + Math.sin(time * 0.137) * 0.72 + Math.sin(time * 0.071) * 0.38;
    const wave = 0.5 + 0.5 * Math.sin(phase);
    const wash = 0.5 + 0.5 * Math.sin(phase - 0.65);
    const volume = (0.065 + this.wind * 0.006) * (0.3 + wave ** 1.7 * 0.7);
    this.gain.gain.setTargetAtTime(volume, now, 0.22);
    this.foamGain.gain.setTargetAtTime(0.12 + wash ** 3 * (0.24 + this.wind * 0.012), now, 0.3);
    this.timer = window.setTimeout(this.modulate, 150);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    clearTimeout(this.timer);
    clearTimeout(this.suspendTimer);
    try { this.source?.stop(); } catch { /* Already stopped or not started. */ }
    this.nodes.forEach(node => node.disconnect());
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}
