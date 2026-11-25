// Low-resolution render plus a VHS tape look.
//
// The scene is drawn into an off-screen buffer at a fraction of the screen resolution (each game
// pixel is about 2 screen points), then stretched to the screen with hard pixel edges through a
// shader that adds the tape artefacts: red/blue channels pulled apart, smeared colour, line wobble,
// grain, a slow rolling tracking band, scanlines and a slightly washed-out grade.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 res;       // size of the low-resolution buffer in pixels
  uniform float time;
  uniform float strength; // 0 = clean pixels only, 1 = full VHS
  uniform float barrel;   // wide-angle lens bend (0 = none): straight lines bow out toward the edges
  uniform float fish;     // 0..1: blend from a normal lens to a true (equidistant) fisheye
  uniform float hv;       // half the camera's vertical field of view (radians)
  uniform float hood;     // 0..1: a lens hood creeping into the corners
  uniform float circle;   // 0..1: the picture closes down to a round fisheye image
  uniform float zoom;     // fisheye crop: scales in so the bent picture still fills the frame
  varying vec2 vUv;

  float rand(vec2 c) {
    return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 sampleSRGB(vec2 uv) {
    return linearToOutputTexel(texture2D(tDiffuse, uv)).rgb;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = res.x / res.y;
    // Fisheye lens: each point on screen looks out at an angle in proportion to its distance from the
    // centre (instead of the tangent a normal lens uses), so the middle swells and the edges crowd in.
    float lensMask = 1.0;
    if (fish > 0.001 || circle > 0.001 || hood > 0.001) {
      vec2 p0 = (uv - 0.5) * 2.0 * vec2(aspect, 1.0); // units of half the screen height
      vec2 p = p0 * mix(zoom, 1.0, circle);
      float r = length(p);
      float theta = r * hv;
      vec2 eq = r > 1e-4 ? p / r * tan(min(theta, 1.5)) / tan(hv) : p;
      vec2 src = mix(p, eq, fish);
      // Beyond 86 degrees off-axis the lens sees nothing the picture holds: black.
      lensMask *= 1.0 - step(1.5, theta) * fish;
      // A round image circle, closing in to touch the top and bottom of the screen.
      float rc = mix(3.0, 1.0, circle);
      lensMask *= 1.0 - smoothstep(rc - 0.03, rc + 0.01, length(p0));
      // The lens hood: dark rounded corners growing inward.
      vec2 q = p0 / vec2(aspect, 1.0);
      float rh = mix(1.5, 1.0, hood);
      lensMask *= 1.0 - smoothstep(rh - 0.25, rh, length(q * vec2(1.0, 0.92))) * step(0.001, hood);
      uv = src / vec2(aspect, 1.0) * 0.5 + 0.5;
      lensMask *= step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    }
    // A very wide camcorder lens: the picture bows out, the corners fall off into black.
    vec2 cc = uv - 0.5;
    cc.x *= res.x / res.y;
    float r2 = dot(cc, cc);
    vec2 bent = 0.5 + (uv - 0.5) * (1.0 - barrel * 0.35) * (1.0 + barrel * r2);
    float inside = step(0.0, bent.x) * step(bent.x, 1.0) * step(0.0, bent.y) * step(bent.y, 1.0);
    uv = mix(uv, bent, step(0.001, barrel));
    float row = floor(uv.y * res.y);

    // Tracking band: a soft noisy stripe that rolls slowly up the picture.
    float bandPos = 1.0 - fract(time * 0.05);
    float band = smoothstep(0.045, 0.0, abs(uv.y - bandPos)) * strength;

    // Each line jitters sideways a little; inside the band it tears more.
    float wobble = (rand(vec2(row, floor(time * 24.0))) - 0.5) * 0.7 * strength;
    wobble += band * (rand(vec2(row * 1.7, time)) - 0.5) * 7.0;
    uv.x += wobble / res.x;

    // Snap to the low-resolution pixel grid.
    vec2 px = (floor(uv * res) + 0.5) / res;
    vec2 one = vec2(1.0 / res.x, 0.0);

    // Red and blue pulled apart, colour smeared to the right like a tape chroma signal.
    vec3 c = sampleSRGB(px);
    float r = sampleSRGB(px + one * 1.5 * strength).r;
    float b = sampleSRGB(px - one * 1.5 * strength).b;
    vec3 shifted = vec3(r, c.g, b);
    vec3 smear = (sampleSRGB(px - one) + sampleSRGB(px - one * 2.0)) * 0.5;
    const vec3 lumaW = vec3(0.299, 0.587, 0.114);
    float luma = dot(shifted, lumaW);
    vec3 chroma = mix(shifted, smear, 0.45 * strength) - dot(mix(shifted, smear, 0.45 * strength), lumaW);
    vec3 col = mix(c, luma + chroma, strength);

    // Tape grade: a touch warm with gently lifted blacks.
    vec3 graded = col * 0.95 + vec3(0.02, 0.016, 0.022);
    col = mix(col, graded, strength);
    // Punch: more contrast (deeper shadows, brighter highlights) and a little more colour.
    col = clamp((col - 0.5) * 1.16 + 0.5, 0.0, 1.0);
    col = mix(vec3(dot(col, lumaW)), col, 1.12);

    // Grain, band noise and scanlines.
    col += (rand(vUv * res + fract(time) * 100.0) - 0.5) * 0.05 * strength;
    col += band * 0.18 * rand(vec2(row * 3.1, floor(time * 30.0)));
    col *= 1.0 - 0.1 * strength * step(0.5, fract(uv.y * res.y * 0.5));

    col *= mix(1.0, inside * (1.0 - smoothstep(0.35, 0.75, r2) * barrel * 0.6), step(0.001, barrel));
    col *= lensMask;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

// How far to scale into a fisheye picture so its corners still land inside what was rendered (the
// largest zoom that keeps the screen's corner within the picture), found by halving the range.
function fishZoom(fish, hv, aspect) {
  const fits = (z) => {
    const px = aspect * z;
    const py = z;
    const r = Math.hypot(px, py);
    const th = r * hv;
    if (th >= 1.5 * fish + 10 * (1 - fish) && fish > 0.999) return false;
    const k = (Math.tan(Math.min(th, 1.5)) / Math.tan(hv)) / r;
    const sx = px + (px * k - px) * fish;
    const sy = py + (py * k - py) * fish;
    return sx <= aspect && sy <= 1 && th < 1.5;
  };
  let lo = 0.2;
  let hi = 1;
  if (fits(hi)) return 1;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (fits(m)) lo = m;
    else hi = m;
  }
  return lo;
}

export class VhsRenderer {
  constructor(renderer, pixelSize = 2) {
    this.renderer = renderer;
    this.pixelSize = pixelSize;
    this.strength = 1;
    this.barrel = 0; // wide-angle lens bend, for camcorder shots
    this.lens = { fish: 0, hood: 0, circle: 0 }; // fisheye lens (replay edit mode)
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        res: { value: new THREE.Vector2(4, 4) },
        time: { value: 0 },
        strength: { value: 1 },
        barrel: { value: 0 },
        fish: { value: 0 },
        hv: { value: 0.5 },
        hood: { value: 0 },
        circle: { value: 0 },
        zoom: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // Size in CSS pixels of the visible canvas.
  setSize(width, height) {
    const w = Math.max(1, Math.ceil(width / this.pixelSize));
    const h = Math.max(1, Math.ceil(height / this.pixelSize));
    this.target.setSize(w, h);
    this.material.uniforms.res.value.set(w, h);
  }

  render(scene, camera, time) {
    const r = this.renderer;
    this.material.uniforms.time.value = time;
    this.material.uniforms.strength.value = this.strength;
    this.material.uniforms.barrel.value = this.barrel;
    const u = this.material.uniforms;
    u.fish.value = this.lens.fish;
    u.hood.value = this.lens.hood;
    u.circle.value = this.lens.circle;
    const hv = ((camera.fov ?? 60) * Math.PI) / 360;
    u.hv.value = hv;
    u.zoom.value = this.lens.fish > 0.001 ? fishZoom(this.lens.fish, hv, u.res.value.x / u.res.value.y) : 1;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
