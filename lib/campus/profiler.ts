// Read-only diagnostic timings. GPU samples are asynchronous and optional;
// unsupported or disjoint results are never reported as zero-cost rendering.
export class FrameProfiler {
  cpu: number[] = [];
  gpu: number[] = [];
  private query: WebGLQuery | null = null;
  private queryStartFrame: number | null = null;
  private gpuSampleFrames: number[] = [];
  private validGpuSamplesTotal = 0;
  private gpuDisjointCount = 0;
  private running = false;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  // Per-frame draw statistics (read-only copies of renderer.info.render).
  private calls: number[] = [];
  private triangles: number[] = [];
  private frameIntervals: number[] = [];
  private lastFrameAt = 0;
  private markWindow: { startedAt: number; frames: number; cpu: number[]; gpu: number[]; calls: number[]; triangles: number[]; intervals: number[]; label: string } | null = null;
  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  begin(frame: number) {
    const { gl, ext } = this;
    if (!ext) return;
    if (this.query) {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ready = gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE);
      if (disjoint) {
        this.gpu = [];
        this.gpuSampleFrames = [];
        this.gpuDisjointCount++;
      }
      if (ready && !disjoint) {
        const ms = gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6;
        this.gpu.push(ms);
        this.markWindow?.gpu.push(ms);
        this.gpuSampleFrames.push(this.queryStartFrame!);
        this.validGpuSamplesTotal++;
        if (this.gpu.length > 120) {
          this.gpu.shift();
          this.gpuSampleFrames.shift();
        }
      }
      if (ready || disjoint) {
        gl.deleteQuery(this.query);
        this.query = null;
        this.queryStartFrame = null;
      }
    }
    if (!this.query && frame % 20 === 0) {
      this.query = gl.createQuery();
      if (this.query) {
        this.queryStartFrame = frame;
        gl.beginQuery(ext.TIME_ELAPSED_EXT, this.query);
        this.running = true;
      }
    }
  }
  end(cpuMs: number) {
    if (this.running && this.ext) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.running = false;
    }
    this.cpu.push(cpuMs);
    if (this.cpu.length > 600) this.cpu.shift();
    this.markWindow?.cpu.push(cpuMs);
  }
  /** Record the finished frame's renderer.info.render (all passes when the AO
   * pipeline aggregates them). Call after rendering; never alters rendering. */
  recordRender(render: { calls: number; triangles: number }, now = performance.now()) {
    const push = (list: number[], v: number) => { list.push(v); if (list.length > 600) list.shift(); };
    push(this.calls, render.calls);
    push(this.triangles, render.triangles);
    if (this.lastFrameAt) push(this.frameIntervals, now - this.lastFrameAt);
    const w = this.markWindow;
    if (w) {
      w.frames++; w.calls.push(render.calls); w.triangles.push(render.triangles);
      if (this.lastFrameAt && w.frames > 1) w.intervals.push(now - this.lastFrameAt);
    }
    this.lastFrameAt = now;
  }
  resetClock() { this.lastFrameAt = 0; }
  /** Start a fresh measurement window (e.g. after activating a camera shot). */
  mark(label = '') {
    this.markWindow = { startedAt: performance.now(), frames: 0, cpu: [], gpu: [], calls: [], triangles: [], intervals: [], label };
    return { label, startedAt: this.markWindow.startedAt };
  }
  snapshot() {
    const summary = (values: number[]) => {
      const s = [...values].sort((a, b) => a - b);
      return s.length
        ? {
            median: s[Math.floor(s.length * 0.5)],
            p95: s[Math.floor(s.length * 0.95)],
            sampleCount: s.length,
          }
        : null;
    };
    const w = this.markWindow;
    const intervals = summary(w ? w.intervals : this.frameIntervals);
    return {
      // Steady-state rendering cost; cold shader compilation shows up as large
      // early intervals, so mark() after warm-up for a clean window.
      fps: intervals ? { median: 1000 / intervals.median, p05: 1000 / intervals.p95 } : null,
      drawCalls: summary(this.calls),
      triangles: summary(this.triangles),
      window: w ? { label: w.label, seconds: (performance.now() - w.startedAt) / 1000, frames: w.frames,
        frameIntervalMs: summary(w.intervals), cpuFrameMs: summary(w.cpu), gpuRenderMs: summary(w.gpu),
        drawCalls: summary(w.calls), triangles: summary(w.triangles) } : null,
      cpuFrameMs: summary(this.cpu),
      gpuRenderMs: summary(this.gpu),
      gpuTimerSupported: !!this.ext,
      // Query-start frames identify which rendered poses the retained timings
      // belong to. Lifetime count lets read-only diagnostics await fresh data.
      gpuSampling: {
        validSamplesTotal: this.validGpuSamplesTotal,
        retainedSamples: this.gpuSampleFrames.length,
        firstRenderFrame: this.gpuSampleFrames[0] ?? null,
        lastRenderFrame: this.gpuSampleFrames.at(-1) ?? null,
        pendingStartFrame: this.queryStartFrame,
        disjointCount: this.gpuDisjointCount,
      },
    };
  }
  dispose() {
    if (this.query) this.gl.deleteQuery(this.query);
    this.query = null;
    this.queryStartFrame = null;
  }
}
