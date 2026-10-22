import * as THREE from 'three';

/** Coalesced viewport sizing. Resize events, host-element size changes
 * (ResizeObserver) and devicePixelRatio changes only mark the viewport dirty;
 * `apply()` performs at most one renderer.setSize per animation frame, right
 * before rendering. Dragging a window edge therefore no longer reallocates the
 * canvas and the 4x MSAA half-float AO targets dozens of times per second, and
 * moving between displays updates the pixel ratio (the legacy code read it once). */
export class ViewportSync {
  private dirty = true;
  private readonly observer?: ResizeObserver;
  private dprQuery?: MediaQueryList;
  private readonly markDirty = () => { this.dirty = true; };
  private readonly onDpr = () => { this.dirty = true; this.watchDpr(); };
  applied = 0;
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly host: HTMLElement,
    private readonly onResize: () => void = () => {},
    private readonly maxPixelRatio = 1.5,
  ) {
    window.addEventListener('resize', this.markDirty);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.markDirty);
      this.observer.observe(host);
    }
    this.watchDpr();
  }

  private watchDpr() {
    this.dprQuery?.removeEventListener('change', this.onDpr);
    if (typeof matchMedia === 'undefined') return;
    this.dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onDpr, { once: true });
  }

  /** Call at the top of each rendered frame. Returns true when the size changed. */
  apply() {
    if (!this.dirty) return false;
    this.dirty = false;
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const size = this.renderer.getSize(this.size);
    if (size.x === w && size.y === h && this.renderer.getPixelRatio() === ratio) return false;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applied++;
    this.onResize();
    return true;
  }

  dispose() {
    window.removeEventListener('resize', this.markDirty);
    this.observer?.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDpr);
  }
}
