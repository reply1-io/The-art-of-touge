// The picture as if filmed on a Sony VX1000 (MiniDV) and dubbed to a worn VHS tape.
//
// The scene is drawn with real light levels (bright things brighter than white) into a buffer of
// about 480 lines, like DV. A small blurred copy of its brightest parts makes the glow around the
// sun, lamps and headlights. Then one pass makes the video:
//   camera: highlights roll off then clip like a camcorder sensor; edges get the bright and dark
//     halos of camcorder sharpening (no grain: a clean picture)
//   DV: interlaced fields (every other line is from the frame before, so fast pans comb); colour
//     at a quarter of the detail, smeared and lagging to the right
//   VHS: lines wobble and the tape stretches; the bottom lines tear (head switching); white
//     dropout streaks; lifted, warm blacks (no rolling tracking band)
// Graded like '90s night touge tapes: the night crushed to black, whatever the headlights hit blown
// out to white, nearly no colour, lights glowing and smeared sideways, and bright things leaving
// trails as they move (the tape's lag).
// strength 0 is a clean picture at screen resolution (with the same light and glow); 1 is full.
// Also the wide-angle and fisheye lenses for replays.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// The glow: the brightest light, blurred, at a sixth of the size.
const bloomShader = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 texel; // one source pixel
  varying vec2 vUv;
  void main() {
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        vec2 o = vec2(float(x), float(y));
        float w = exp(-dot(o, o) / 6.0);
        // Stretched sideways: tape smears bright light along the lines.
        vec3 c = texture2D(tSrc, vUv + o * texel * vec2(4.5, 2.0)).rgb;
        sum += max(c - 0.6, 0.0) * w; // only the bright light
        wsum += w;
      }
    }
    gl_FragColor = vec4(sum / wsum, 1.0);
  }
`;

// The tape's lag: bright things fade out over a few frames instead of at once, so lights and lit
// road lines leave trails as they move.
const persistShader = /* glsl */ `
  uniform sampler2D tNew;
  uniform sampler2D tOld;
  uniform float keep;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tNew, vUv).rgb;
    vec3 o = texture2D(tOld, vUv).rgb;
    // Only the bright light lingers (lamps, the lit car ahead), not the whole lit road.
    float lum = dot(o, vec3(0.299, 0.587, 0.114));
    o *= keep * smoothstep(0.9, 1.8, lum);
    gl_FragColor = vec4(max(c, o), 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tCur;
  uniform sampler2D tPrev;
  uniform sampler2D tBloom;
  uniform vec2 res;       // size of the picture buffer in pixels
  uniform vec2 screen;    // size of the screen in pixels
  uniform float time;
  uniform float strength; // 0 = clean, 1 = full camcorder and tape
  uniform float field;    // 0 or 1: which lines are this frame's (interlacing)
  uniform float frame43;  // 0..1: black bars to a 4:3 picture
  uniform float exposure;
  uniform float grade;    // 0..1: the night tape grade (deep blue night, blown warm headlights, halation)
  uniform float barrel;   // wide-angle lens bend (0 = none): straight lines bow out toward the edges
  uniform float fish;     // 0..1: blend from a normal lens to a true (equidistant) fisheye
  uniform float hv;       // half the camera's vertical field of view (radians)
  uniform float hood;     // 0..1: a lens hood creeping into the corners
  uniform float circle;   // 0..1: the picture closes down to a round fisheye image
  uniform float zoom;     // fisheye crop: scales in so the bent picture still fills the frame
  uniform float cy;       // where the lens centre is on screen (0..1 up); 0.5 unless the view is shifted
  varying vec2 vUv;

  float rand(vec2 c) {
    return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
  }
  float noise1(float x) {
    float i = floor(x);
    return mix(rand(vec2(i, 1.7)), rand(vec2(i + 1.0, 1.7)), smoothstep(0.0, 1.0, fract(x)));
  }

  // The camera's response: straight up to 80% of white, then a soft shoulder into a hard clip.
  vec3 knee(vec3 x) {
    vec3 hi = 0.8 + 0.2 * (1.0 - exp(-(x - 0.8) * 5.0));
    return mix(x, hi, step(0.8, x));
  }
  // Light (linear) to the picture's levels (gamma), through the camera.
  vec3 develop(vec3 lin) {
    // Night tape: the camera's gain pushed up so the lit road blows out, and the dim moonlit world
    // under the noise floor goes to black.
    lin *= exposure * (1.0 + 1.5 * grade);
    lin = max(lin - 0.014 * grade, 0.0) / (1.0 - 0.014 * grade);
    return pow(clamp(knee(lin), 0.0, 1.0), vec3(1.0 / 2.2));
  }
  // One sample of the picture: this frame's lines, or (interlaced, on the other field's lines) the
  // frame before's, with the glow.
  vec3 pic(vec2 uv, float useField) {
    float row = floor(uv.y * res.y);
    float old = useField * step(0.5, mod(row + field, 2.0));
    vec3 c = mix(texture2D(tCur, uv).rgb, texture2D(tPrev, uv).rgb, old);
    // The glow, and a wider haze around it (halation: light spreading in the lens and the air).
    vec2 hz = vec2(10.0, 6.0) / res;
    vec3 haze = texture2D(tBloom, uv + hz).rgb + texture2D(tBloom, uv - hz).rgb + texture2D(tBloom, uv + hz * vec2(-1.0, 1.0)).rgb + texture2D(tBloom, uv + hz * vec2(1.0, -1.0)).rgb;
    c += texture2D(tBloom, uv).rgb * (0.9 + 0.9 * grade) + haze * 0.35 * grade;
    return develop(c);
  }
  const vec3 LW = vec3(0.299, 0.587, 0.114);
  vec3 toYC(vec3 c) {
    float y = dot(c, LW);
    return vec3(y, (c.b - y) * 0.564, (c.r - y) * 0.713);
  }
  vec3 fromYC(vec3 y) {
    return vec3(y.x + 1.403 * y.z, y.x - 0.344 * y.y - 0.714 * y.z, y.x + 1.773 * y.y);
  }

  void main() {
    vec2 uv = vUv;
    float s = strength;
    float aspect = screen.x / screen.y;

    // 4:3 picture in the middle of a wider screen.
    float bars = 1.0;
    if (frame43 > 0.001 && aspect > 4.0 / 3.0) {
      float w = (4.0 / 3.0) / aspect;
      float x = (uv.x - 0.5) / w;
      bars = step(abs(x), 0.5);
      uv.x = mix(uv.x, x + 0.5, frame43);
      aspect = mix(aspect, 4.0 / 3.0, frame43);
    }

    // Fisheye lens: each point on screen looks out at an angle in proportion to its distance from the
    // centre (instead of the tangent a normal lens uses), so the middle swells and the edges crowd in.
    float lensMask = 1.0;
    if (fish > 0.001 || circle > 0.001 || hood > 0.001) {
      vec2 cen = vec2(0.5, cy);
      vec2 p0 = (uv - cen) * 2.0 * vec2(aspect, 1.0); // units of half the screen height
      vec2 p = p0 * mix(zoom, 1.0, circle);
      float r = length(p);
      float theta = r * hv;
      vec2 eq = r > 1e-4 ? p / r * tan(min(theta, 1.5)) / tan(hv) : p;
      vec2 src = mix(p, eq, fish);
      lensMask *= 1.0 - step(1.5, theta) * fish;
      float rc = mix(3.0, 1.0, circle);
      lensMask *= 1.0 - smoothstep(rc - 0.03, rc + 0.01, length(p0));
      vec2 q = p0 / vec2(aspect, 1.0);
      float rh = mix(1.5, 1.0, hood);
      lensMask *= 1.0 - smoothstep(rh - 0.25, rh, length(q * vec2(1.0, 0.92))) * step(0.001, hood);
      uv = src / vec2(aspect, 1.0) * 0.5 + cen;
      lensMask *= step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    }
    // A very wide camcorder lens: the picture bows out, the corners fall off into black.
    vec2 cc = uv - 0.5;
    cc.x *= aspect;
    float r2 = dot(cc, cc);
    vec2 bent = 0.5 + (uv - 0.5) * (1.0 - barrel * 0.35) * (1.0 + barrel * r2);
    float inside = step(0.0, bent.x) * step(bent.x, 1.0) * step(0.0, bent.y) * step(bent.y, 1.0);
    uv = mix(uv, bent, step(0.001, barrel));

    float row = floor(uv.y * res.y);
    float t = time;
    // ---- Tape transport ----
    // Every line jitters sideways a little, and the whole picture sways as the tape stretches.
    float jit = (rand(vec2(row, floor(t * 30.0))) - 0.5) * 0.9;
    float sway = (noise1(uv.y * 6.0 + t * 1.3) - 0.5) * 2.2 + sin(t * 0.9 + uv.y * 2.0) * 0.6;
    // Head switching: the bottom lines are torn sideways and noisy.
    float hs = smoothstep(0.035, 0.0, uv.y);
    float hsShift = hs * (14.0 + rand(vec2(row, floor(t * 30.0))) * 10.0);
    uv.x += (jit + sway + hsShift) * s / res.x;

    vec2 one = vec2(1.0 / res.x, 0.0);
    float useField = step(0.2, s);
    // ---- The picture: sharp brightness, soft smeared colour ----
    vec3 c0 = pic(uv, useField);
    vec3 cl = pic(uv - one, useField);
    vec3 cr = pic(uv + one, useField);
    float y0 = dot(c0, LW);
    // Camcorder sharpening: bright and dark halos along edges.
    float yBlur = dot(cl + cr, LW) * 0.5;
    float yS = y0 + (y0 - yBlur) * mix(0.0, 1.3, s) * (1.0 - 0.6 * grade);
    // Colour at a quarter of the detail, smeared and lagging to the right (DV, then tape).
    vec3 ch = vec3(0.0);
    float wsum = 0.0;
    for (int k = -3; k <= 3; k++) {
      float w = 1.0 - abs(float(k)) / 4.0;
      vec3 yc = toYC(pic(uv + one * (float(k) * 1.6 - 2.5 * s), useField));
      ch += yc * w;
      wsum += w;
    }
    ch /= wsum;
    vec3 yc0 = toYC(c0);
    vec2 chroma = mix(yc0.yz, ch.yz, s);
    vec3 col = fromYC(vec3(yS, chroma));

    // ---- Grade ----
    // A little more colour, like the VX1000; then tape: lifted warm blacks, slightly soft whites.
    float yg = dot(col, LW);
    col = mix(vec3(yg), col, mix(1.0 + 0.15 * s, 0.8, grade));
    // Night tape colour: the dark goes deep blue, the headlight-lit road and the lights warm
    // halogen yellow; whites a touch soft.
    float lo = 1.0 - smoothstep(0.0, 0.3, yg);
    float hi = smoothstep(0.45, 0.95, yg);
    col += grade * (lo * vec3(0.004, 0.018, 0.05) + hi * vec3(0.06, 0.025, -0.05));
    col = mix(col, col * 0.95 + vec3(0.012, 0.014, 0.022), s);

    // ---- Tape damage ----
    col = mix(col, vec3(rand(vec2(uv.x * 300.0, row + t))), hs * 0.5 * s);
    // Dropouts: now and then a white streak along part of a line.
    float drop = step(0.9975, rand(vec2(floor(row / 2.0), floor(t * 15.0))));
    float dx = rand(vec2(row, floor(t * 15.0) + 3.0));
    drop *= step(dx, uv.x) * step(uv.x, dx + 0.05 + 0.15 * rand(vec2(row, 7.0)));
    col = mix(col, vec3(0.95), drop * s);
    // The lines of the picture, faintly.
    col *= 1.0 - 0.07 * s * (0.5 + 0.5 * cos(uv.y * res.y * 6.2832));
    // The lens darkens toward the corners.
    vec2 vq = (vUv - 0.5) * vec2(aspect / 1.5, 1.0);
    col *= 1.0 - dot(vq, vq) * (0.45 + 0.3 * grade) * s;

    col *= mix(1.0, inside * (1.0 - smoothstep(0.35, 0.75, r2) * barrel * 0.6), step(0.001, barrel));
    col *= lensMask * bars;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

// How far to scale into a fisheye picture so its corners still land inside what was rendered (the
// largest zoom that keeps the screen's corner within the picture), found by halving the range.
export function fishZoom(fish, hv, aspect, cy = 0.5) {
  // Room above and below the lens centre, in half-screen-heights.
  const up = (1 - cy) * 2;
  const down = cy * 2;
  const corner = (z, ey) => {
    const px = aspect * z;
    const py = ey * z;
    const r = Math.hypot(px, py);
    const th = r * hv;
    if (th >= 1.5) return false;
    const k = Math.tan(th) / Math.tan(hv) / r;
    const sx = px + (px * k - px) * fish;
    const sy = py + (py * k - py) * fish;
    return sx > 0 && sy > 0 && sx <= aspect && sy <= ey;
  };
  const fits = (z) => corner(z, up) && corner(z, down);
  let lo = 0.35;
  let hi = 1;
  if (fits(hi)) return 1;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (fits(m)) lo = m;
    else hi = m;
  }
  return lo;
}

// Lines in the picture when filmed (DV): about 480.
export const DV_LINES = 480;

export class VhsRenderer {
  constructor(renderer, pixelSize = 2) {
    this.renderer = renderer;
    this.pixelSize = pixelSize;
    this.strength = 1;
    this.barrel = 0; // wide-angle lens bend, for camcorder shots
    this.lens = { fish: 0, hood: 0, circle: 0, cy: 0.5 }; // fisheye lens; cy: lens centre height on screen
    this.frame43 = 0; // 1: a 4:3 picture with black bars, like the camcorder
    this.exposure = 1;
    this.grade = 1; // the night tape grade
    this.trail = 0.8; // how much of the last frame's light lingers (0: none)
    this.css = [4, 4];
    // Real light levels where the device can store them (bright things brighter than white).
    const gl = renderer.getContext();
    const hdr = renderer.capabilities.isWebGL2 && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    const opts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    };
    this.frames = [new THREE.WebGLRenderTarget(4, 4, opts), new THREE.WebGLRenderTarget(4, 4, opts)];
    // Without real light levels, keep the picture's precision in the dark (decoded when read).
    if (!hdr) for (const f of this.frames) f.texture.colorSpace = THREE.SRGBColorSpace;
    this.cur = 0;
    // The lingering light: this frame mixed with what is left of the last (ping-pong).
    this.persist = [new THREE.WebGLRenderTarget(4, 4, { ...opts, depthBuffer: false }), new THREE.WebGLRenderTarget(4, 4, { ...opts, depthBuffer: false })];
    if (!hdr) for (const f of this.persist) f.texture.colorSpace = THREE.SRGBColorSpace;
    this.persistMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: persistShader,
      uniforms: { tNew: { value: null }, tOld: { value: null }, keep: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.bloomTarget = new THREE.WebGLRenderTarget(4, 4, { ...opts, depthBuffer: false });
    this.bloomMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: bloomShader,
      uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tCur: { value: null },
        tPrev: { value: null },
        tBloom: { value: this.bloomTarget.texture },
        res: { value: new THREE.Vector2(4, 4) },
        screen: { value: new THREE.Vector2(4, 4) },
        time: { value: 0 },
        strength: { value: 1 },
        field: { value: 0 },
        frame43: { value: 0 },
        exposure: { value: 1 },
        grade: { value: 1 },
        barrel: { value: 0 },
        fish: { value: 0 },
        hv: { value: 0.5 },
        hood: { value: 0 },
        circle: { value: 0 },
        zoom: { value: 1 },
        cy: { value: 0.5 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.filmed = null;
  }

  // Size in CSS pixels of the visible canvas. Filmed (strength above 0): about 480 lines, like DV.
  // Clean: the screen's resolution (or half, with pixelSize 2).
  setSize(width, height) {
    this.css = [width, height];
    this.filmed = this.strength > 0.001;
    let h = Math.max(1, Math.ceil(height / this.pixelSize));
    if (this.filmed) h = Math.min(h * Math.min(2, window.devicePixelRatio || 1), DV_LINES / (this.pixelSize > 1 ? 1.4 : 1));
    h = Math.max(1, Math.round(h));
    const w = Math.max(1, Math.round((h * width) / height));
    for (const f of [...this.frames, ...this.persist]) f.setSize(w, h);
    this.bloomTarget.setSize(Math.max(1, Math.round(w / 6)), Math.max(1, Math.round(h / 6)));
    this.material.uniforms.res.value.set(w, h);
    const dpr = this.renderer.getPixelRatio();
    this.material.uniforms.screen.value.set(width * dpr, height * dpr);
  }

  render(scene, camera, time) {
    const r = this.renderer;
    // Switching between filmed and clean changes the picture's size.
    if (this.filmed !== this.strength > 0.001) this.setSize(...this.css);
    const u = this.material.uniforms;
    u.time.value = time;
    u.strength.value = this.strength;
    u.barrel.value = this.barrel;
    u.fish.value = this.lens.fish;
    u.hood.value = this.lens.hood;
    u.circle.value = this.lens.circle;
    u.frame43.value = this.frame43;
    u.exposure.value = this.exposure;
    u.grade.value = this.grade * Math.min(1, this.strength / 0.5);
    const hv = ((camera.fov ?? 60) * Math.PI) / 360;
    u.hv.value = hv;
    u.cy.value = this.lens.cy ?? 0.5;
    u.zoom.value = this.lens.fish > 0.001 ? fishZoom(this.lens.fish, hv, u.res.value.x / u.res.value.y, u.cy.value) : 1;
    // This frame into one buffer; the last frame stays in the other (for the interlaced lines).
    this.cur ^= 1;
    const cur = this.frames[this.cur];
    const prev = this.frames[this.cur ^ 1];
    r.setRenderTarget(cur);
    r.render(scene, camera);
    // The lingering light: what the picture is made from from here on.
    const pNew = this.persist[this.cur];
    const pOld = this.persist[this.cur ^ 1];
    this.persistMat.uniforms.tNew.value = cur.texture;
    this.persistMat.uniforms.tOld.value = pOld.texture;
    this.persistMat.uniforms.keep.value = this.strength > 0.2 ? this.trail : 0;
    this.quad.material = this.persistMat;
    r.setRenderTarget(pNew);
    r.render(this.scene, this.camera);
    // The glow.
    this.bloomMat.uniforms.tSrc.value = pNew.texture;
    this.bloomMat.uniforms.texel.value.set(1 / cur.width, 1 / cur.height);
    this.quad.material = this.bloomMat;
    r.setRenderTarget(this.bloomTarget);
    r.render(this.scene, this.camera);
    // The video.
    this.quad.material = this.material;
    u.tCur.value = pNew.texture;
    u.tPrev.value = prev.texture;
    u.field.value = this.cur;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
