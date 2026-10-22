// Minimal DOM stand-ins so texture/canvas construction is inert under Node.
const noop = () => {};
const ctx2d = new Proxy({}, { get: (_, key) => key === 'canvas' ? fakeCanvas() :
  key === 'getImageData' || key === 'createImageData' ? (_x, _y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }) :
  key === 'measureText' ? () => ({ width: 0 }) : key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern' ? () => ({ addColorStop: noop }) : noop, set: () => true });
function fakeCanvas() { return { width: 1, height: 1, style: {}, getContext: () => ctx2d, addEventListener: noop, removeEventListener: noop }; }
const element = () => ({ style: {}, addEventListener: noop, removeEventListener: noop, setAttribute: noop, getContext: () => ctx2d, width: 1, height: 1, set src(_v) {} });
// oxlint-disable-next-line typescript/no-deprecated -- inert stand-in object, not the DOM API
globalThis.document = { createElement: (t) => t === 'canvas' ? fakeCanvas() : element(), createElementNS: () => element() };
globalThis.window = globalThis;
globalThis.self = globalThis;
