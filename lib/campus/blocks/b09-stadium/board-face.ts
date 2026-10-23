// Authored face for the 2021 South End Zone videoboard (160 x 44 ft screen + name header; tools/scans/stadium-references.json
// ref-ut-facility, ref-ut-dkr2). The layout follows the completed board as photographed (orange score panel at the left,
// live field view in the middle, stats column at the right, "DARRELL K ROYAL / TEXAS MEMORIAL STADIUM" header above), drawn
// procedurally: no photographic pixels, no logos or likenesses. One canvas, shared by the screen and header quads.
import * as THREE from 'three';

/** Fraction of the canvas height used by the header band (the rest is the 160 x 44 ft screen). */
export const BOARD_HEADER_FRACTION = 0.13;

export function createBoardFace(renderer: THREE.WebGLRenderer) {
  const w = 1024, h = 336, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const head = Math.round(h * BOARD_HEADER_FRACTION), sy = head, sh = h - head;
  // Header: charcoal band with the stadium name in pale caps, split by the centre.
  g.fillStyle = '#1b1d20'; g.fillRect(0, 0, w, head);
  g.fillStyle = '#e8e4da'; g.font = `bold ${Math.round(head * 0.62)}px sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText('DARRELL K ROYAL', w * 0.3, head / 2); g.fillText('TEXAS MEMORIAL STADIUM', w * 0.72, head / 2);
  g.fillStyle = '#bf5700'; g.fillRect(w * 0.49, head * 0.25, w * 0.02, head * 0.5);
  // Screen: dark surround.
  g.fillStyle = '#0c0e11'; g.fillRect(0, sy, w, sh);
  // Left: burnt-orange score panel with two score boxes and a clock.
  const lx = w * 0.035, lw = w * 0.17;
  g.fillStyle = '#c85a12'; g.fillRect(lx, sy + sh * 0.08, lw, sh * 0.84);
  g.fillStyle = '#f4efe6'; g.font = `bold ${Math.round(sh * 0.14)}px sans-serif`; g.fillText('TEXAS', lx + lw / 2, sy + sh * 0.2);
  g.fillStyle = '#1b1d20';
  for (const k of [0, 1]) g.fillRect(lx + lw * (0.08 + k * 0.5), sy + sh * 0.36, lw * 0.34, sh * 0.26);
  g.fillStyle = '#f4efe6'; g.font = `bold ${Math.round(sh * 0.17)}px sans-serif`;
  g.fillText('21', lx + lw * 0.25, sy + sh * 0.49); g.fillText('14', lx + lw * 0.75, sy + sh * 0.49);
  g.font = `bold ${Math.round(sh * 0.12)}px sans-serif`; g.fillText('2:43', lx + lw / 2, sy + sh * 0.76);
  // Centre: live field view (turf gradient, receding yard lines, orange end zone).
  const cx = w * 0.225, cw = w * 0.585, top = sy + sh * 0.06, bot = sy + sh * 0.94;
  const turf = g.createLinearGradient(0, top, 0, bot); turf.addColorStop(0, '#2e5a2a'); turf.addColorStop(1, '#4c8a3c');
  g.fillStyle = turf; g.fillRect(cx, top, cw, bot - top);
  g.fillStyle = '#9e4a12'; g.fillRect(cx, top, cw, (bot - top) * 0.16);
  g.strokeStyle = '#e9efe4'; g.lineWidth = 2;
  for (let k = 0; k <= 10; k++) {
    const f = k / 10, xb = cx + cw * (0.04 + f * 0.92), xt = cx + cw * (0.3 + f * 0.4);
    g.beginPath(); g.moveTo(xb, bot); g.lineTo(xt, top + (bot - top) * 0.16); g.stroke();
  }
  // Right: stats column (pale rows on charcoal).
  const rx = w * 0.825, rw = w * 0.14;
  g.fillStyle = '#16181b'; g.fillRect(rx, sy + sh * 0.08, rw, sh * 0.84);
  g.fillStyle = '#c85a12'; g.fillRect(rx, sy + sh * 0.08, rw, sh * 0.1);
  g.fillStyle = '#cfcac0';
  for (let k = 0; k < 8; k++) g.fillRect(rx + rw * 0.08, sy + sh * (0.24 + k * 0.085), rw * (0.5 + 0.3 * ((k * 37) % 5) / 5), sh * 0.035);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return map;
}
