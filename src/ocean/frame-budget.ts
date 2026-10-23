export type FrameLimit = 30 | 60 | 0;

/** Schedule drawing without accumulating a backlog after a hidden tab or stall. */
export class FrameBudget {
  private next = 0;
  limit: FrameLimit;
  constructor(limit: FrameLimit = 30) { this.limit = limit; }
  reset(): void { this.next = 0; }
  due(stamp: number): boolean {
    if (!Number.isFinite(stamp)) return false;
    if (this.limit === 0) return true;
    const interval = 1000 / this.limit;
    if (stamp + .25 < this.next) return false;
    this.next = this.next === 0 || stamp - this.next > interval
      ? stamp + interval : this.next + interval;
    return true;
  }
}

export function parseFrameLimit(value: unknown): FrameLimit {
  return value === '60' || value === 60 ? 60 : value === '0' || value === 0 ? 0 : 30;
}

/** A deliberate 30 fps cap must not be mistaken for GPU overload. */
export function frameRateTargets(limit: FrameLimit): { lower: number; upper: number } {
  const target = limit || 60;
  return { lower: Math.min(28, target * .8), upper: target * .93 };
}
