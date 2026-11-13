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
  varying vec2 vUv;

  float rand(vec2 c) {
    return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 sampleSRGB(vec2 uv) {
    return linearToOutputTexel(texture2D(tDiffuse, uv)).rgb;
  }

  void main() {
    vec2 uv = vUv;
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

    // Tape grade: slightly lower saturation, lifted blacks, a touch warm.
    vec3 graded = mix(vec3(dot(col, lumaW)), col, 0.86) * 0.93 + vec3(0.03, 0.025, 0.035);
    col = mix(col, graded, strength);

    // Grain, band noise and scanlines.
    col += (rand(vUv * res + fract(time) * 100.0) - 0.5) * 0.05 * strength;
    col += band * 0.18 * rand(vec2(row * 3.1, floor(time * 30.0)));
    col *= 1.0 - 0.1 * strength * step(0.5, fract(uv.y * res.y * 0.5));

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export class VhsRenderer {
  constructor(renderer, pixelSize = 2) {
    this.renderer = renderer;
    this.pixelSize = pixelSize;
    this.strength = 1;
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
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
