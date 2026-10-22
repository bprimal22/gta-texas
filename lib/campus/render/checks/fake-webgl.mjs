// Minimal recording WebGL2 stub: enough for three r185 WebGLRenderer to build
// real shader programs in Node. It captures every gl.shaderSource() so the
// exact GLSL three would send to the driver can be validated with glslang.
export function createRecordingContext() {
  const sources = [];
  const consts = new Proxy({}, { get: (_, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) ? hash(k) : undefined });
  function hash(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 0x1000 + (h % 0xfffff); }
  let id = 1;
  const object = () => ({ __id: id++ });
  const params = {
    VERSION: 'WebGL 2.0', SHADING_LANGUAGE_VERSION: 'WebGL GLSL ES 3.00', VENDOR: 'stub', RENDERER: 'stub',
  };
  const shaders = new Map();
  const handlers = {
    getParameter: p => {
      for (const [k, v] of Object.entries(params)) if (p === hash(k)) return v;
      if (p === hash('VIEWPORT') || p === hash('SCISSOR_BOX')) return new Int32Array([0, 0, 1, 1]);
      if (p === hash('MAX_SAMPLES')) return 4;
      return 16384;
    },
    getExtension: name => /debug_renderer_info|multisampled_render_to_texture|multiview|disjoint_timer/i.test(name) ? null : ({ __ext: name }),
    getSupportedExtensions: () => ['EXT_color_buffer_float', 'OES_texture_float_linear', 'KHR_parallel_shader_compile'],
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }),
    createShader: type => { const s = object(); shaders.set(s, { type }); return s; },
    shaderSource: (s, src) => { const info = shaders.get(s); info.source = src; sources.push({ type: info.type === hash('VERTEX_SHADER') ? 'vert' : 'frag', source: src }); },
    getShaderParameter: () => true,
    getProgramParameter: (_p, k) => (k === hash('ACTIVE_UNIFORMS') || k === hash('ACTIVE_ATTRIBUTES')) ? 0 : true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', getShaderSource: s => shaders.get(s)?.source ?? '',
    getActiveUniform: () => null, getActiveAttrib: () => null, getAttribLocation: () => -1, getUniformLocation: () => null,
    getError: () => 0, isContextLost: () => false, checkFramebufferStatus: () => hash('FRAMEBUFFER_COMPLETE'),
    createProgram: object, createTexture: object, createFramebuffer: object, createRenderbuffer: object, createBuffer: object,
    createVertexArray: object, createQuery: object,
  };
  const gl = new Proxy({}, {
    get: (_, k) => {
      if (k in handlers) return handlers[k];
      if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return consts[k];
      if (k === 'canvas') return canvas;
      if (k === 'drawingBufferWidth' || k === 'drawingBufferHeight') return 1;
      if (k === 'drawingBufferColorSpace') return 'srgb';
      return () => undefined;
    },
    set: () => true,
  });
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext: () => gl, setAttribute() {} };
  return { gl, canvas, sources };
}
