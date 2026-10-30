/** Render deadlines are independent of the fixed 60 Hz physics clock. Keep
 * fractional deadlines (rather than resetting to now) on 90/120/144 Hz screens.
 * Pausing and changing modes discard time debt, so refocus never fast-forwards.
 *
 * rAF timestamps jitter around vsync (callbacks 15.6–17.8 ms apart on a measured 60 Hz display). Comparing them with
 * a sub-millisecond deadline tolerance alternately ran a 30 fps budget on one and three refreshes (16/50 ms judder).
 * Once the refresh period is measured, the budget is kept in whole display refreshes counted between callbacks
 * (jitter cannot change the rounded count); a budget within 5% of a whole number of refreshes uses exactly that many.
 */
export class FramePacing {
  private next = 0;
  /** Refreshes until the next frame is due (set once the refresh period is known; null until then / after resets). */
  private due: number | null = null;
  private previous: number | null = null;
  private rate = -1;
  /** Recent consecutive callback times (a gap of 50 ms or more starts a new window). */
  private callbacks: number[] = [];
  /** Measured display refresh period (ms); 0 until enough callbacks were seen. */
  refreshMs = 0;
  rendered = 0;
  skipped = 0;
  playFps: number;
  constructor(search = '') {
    this.playFps = new URLSearchParams(search).get('fps') === '60' ? 60 : 30;
  }
  /** The median callback interval only counts refreshes per interval (robust to jitter and the odd missed
   * refresh); the period is the window's span over that count, so per-callback jitter averages out. */
  private measureRefresh(now: number) {
    const times = this.callbacks, delta = times.length ? now - times[times.length - 1] : 0;
    if (delta <= 2 || delta >= 50) times.length = 0;
    times.push(now);
    if (times.length > 31) times.shift();
    if (times.length < 9) return delta;
    const deltas = times.slice(1).map((t, i) => t - times[i]), coarse = [...deltas].sort((a, b) => a - b)[deltas.length >> 1];
    let refreshes = 0;
    for (const d of deltas) refreshes += Math.max(1, Math.round(d / coarse));
    this.refreshMs = (times[times.length - 1] - times[0]) / refreshes;
    return delta;
  }
  sample(now: number, state: { hidden: boolean; focused: boolean; quiet: boolean }) {
    const delta = this.measureRefresh(now);
    const rate = state.hidden || !state.focused ? 0 : state.quiet ? 5 : this.playFps;
    if (rate !== this.rate) {
      this.rate = rate;
      this.next = now;
      this.due = null;
      this.previous = null;
    }
    if (!rate) { this.skipped++; return null; }
    const interval = 1000 / rate, refresh = this.refreshMs;
    if (refresh) {
      const whole = Math.round(interval / refresh);
      const budget = whole >= 1 && Math.abs(interval / refresh - whole) < .05 ? whole : interval / refresh;
      this.due = this.due === null ? (this.next - now) / refresh : this.due - Math.round(delta / refresh);
      if (this.due > .5) { this.skipped++; return null; }
      this.due += Math.max(1, Math.floor((.5 - this.due) / budget) + 1) * budget; // skip missed frames, no burst
    } else {
      if (now + .5 < this.next) { this.skipped++; return null; }
      this.next += Math.max(1, Math.floor((now - this.next) / interval) + 1) * interval;
    }
    const elapsed = this.previous === null ? 0 : Math.min(.1, Math.max(0, (now - this.previous) / 1000));
    this.previous = now;
    this.rendered++;
    return elapsed;
  }
  setPowerSaving(enabled: boolean) { this.playFps = enabled ? 30 : 60; this.reset(); }
  reset() { this.rate = -1; this.previous = null; }
  snapshot() { return { playFps: this.playFps, targetFps: Math.max(0, this.rate), refreshMs: +this.refreshMs.toFixed(2), rendered: this.rendered, skipped: this.skipped }; }
}
