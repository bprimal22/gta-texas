/** Render deadlines are independent of the fixed 60 Hz physics clock. Keep
 * fractional deadlines (rather than resetting to now) on 90/120/144 Hz screens.
 * Pausing and changing modes discard time debt, so refocus never fast-forwards.
 */
export class FramePacing {
  private next = 0;
  private previous: number | null = null;
  private rate = -1;
  rendered = 0;
  skipped = 0;
  playFps: number;
  constructor(search = '') {
    this.playFps = new URLSearchParams(search).get('fps') === '60' ? 60 : 30;
  }
  sample(now: number, state: { hidden: boolean; focused: boolean; quiet: boolean }) {
    const rate = state.hidden || !state.focused ? 0 : state.quiet ? 5 : this.playFps;
    if (rate !== this.rate) {
      this.rate = rate;
      this.next = now;
      this.previous = null;
    }
    if (!rate || now + .5 < this.next) { this.skipped++; return null; }
    const interval = 1000 / rate;
    this.next += Math.max(1, Math.floor((now - this.next) / interval) + 1) * interval;
    const elapsed = this.previous === null ? 0 : Math.min(.1, Math.max(0, (now - this.previous) / 1000));
    this.previous = now;
    this.rendered++;
    return elapsed;
  }
  setPowerSaving(enabled: boolean) { this.playFps = enabled ? 30 : 60; this.reset(); }
  reset() { this.rate = -1; this.previous = null; }
  snapshot() { return { playFps: this.playFps, targetFps: Math.max(0, this.rate), rendered: this.rendered, skipped: this.skipped }; }
}
