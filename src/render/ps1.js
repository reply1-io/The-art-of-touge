// PS1 / Gran Turismo 2 style materials.
//
// What makes it look like 1999 hardware:
//   - vertices snap to the low-resolution pixel grid (wobbly geometry)
//   - textures are interpolated affinely, without perspective correction (warping)
//   - lighting and fog are computed per vertex (Gouraud)
//   - output is quantised to 15-bit colour with an ordered dither
// Car paint additionally gets a per-vertex environment reflection, the signature GT2 shine.
import * as THREE from 'three';

// Uniforms shared by every material; update these once per frame.
export const globals = {
  uRes: { value: new THREE.Vector2(426, 240) },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uSunColor: { value: new THREE.Color(0.85, 0.82, 0.75) },
  uAmbient: { value: new THREE.Color(0.45, 0.47, 0.52) },
  uFogColor: { value: new THREE.Color(0.7, 0.78, 0.86) },
  uFogNear: { value: 60 },
  uFogFar: { value: 520 },
  uHeadPos: { value: new THREE.Vector3() },
  uHeadDir: { value: new THREE.Vector3(0, 0, 1) },
  uHeadOn: { value: 0 },
  uAffine: { value: 1 },
};

const common = /* glsl */ `
  uniform vec2 uRes;
  uniform float uAffine;
  vec4 snapToPixels(vec4 clip) {
    vec2 grid = uRes * 0.5;
    clip.xy = floor(clip.xy / clip.w * grid + 0.5) / grid * clip.w;
    return clip;
  }
`;

const lightingVert = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uHeadPos;
  uniform vec3 uHeadDir;
  uniform float uHeadOn;
  vec3 vertexLight(vec3 wp, vec3 n) {
    vec3 light = uAmbient + uSunColor * max(dot(n, uSunDir), 0.0);
    vec3 toV = wp - uHeadPos;
    float d = max(length(toV), 0.001);
    vec3 dir = toV / d;
    float cone = smoothstep(0.74, 0.95, dot(dir, uHeadDir));
    float att = uHeadOn * cone * clamp(1.0 - d / 85.0, 0.0, 1.0);
    // Flat surfaces (the road) catch the beam at a grazing angle, so keep a high floor.
    light += vec3(1.0, 0.94, 0.78) * att * 2.2 * (0.75 + 0.25 * max(dot(n, -dir), 0.0));
    return light;
  }
`;

const ditherFrag = /* glsl */ `
  float bayer4(vec2 p) {
    ivec2 i = ivec2(mod(p, 4.0));
    int idx = i.x + i.y * 4;
    float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return m[idx] / 16.0;
  }
  vec3 quantize15(vec3 c) {
    float d = bayer4(gl_FragCoord.xy) - 0.5;
    return clamp(floor(c * 31.0 + 0.5 + d * 0.9) / 31.0, 0.0, 1.0);
  }
`;

const worldVert = /* glsl */ `
  ${common}
  ${lightingVert}
  attribute vec3 color;
  uniform float uLit;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFogMax;
  varying vec3 vUvw;
  varying vec3 vLight;
  varying float vFog;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vec4 clip = snapToPixels(projectionMatrix * mv);
    gl_Position = clip;
    float w = mix(1.0, clip.w, uAffine);
    vUvw = vec3(uv * w, w);
    vLight = mix(vec3(1.0), vertexLight(wp.xyz, n), uLit) * color;
    float dist = length(mv.xyz);
    vFog = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0) * uFogMax;
  }
`;

const worldFrag = /* glsl */ `
  ${ditherFrag}
  uniform sampler2D map;
  uniform vec3 uFogColor;
  uniform vec3 uTint;
  varying vec3 vUvw;
  varying vec3 vLight;
  varying float vFog;
  void main() {
    vec4 tex = texture2D(map, vUvw.xy / vUvw.z);
    if (tex.a < 0.5) discard;
    vec3 c = tex.rgb * vLight * uTint;
    c = mix(c, uFogColor, vFog);
    gl_FragColor = vec4(quantize15(c), 1.0);
  }
`;

// opts: { map, lit = true, fog: { near, far, max } (own fog distances), side, tint }
export function worldMaterial(map, opts = {}) {
  const ownFog = opts.fog;
  return new THREE.ShaderMaterial({
    vertexShader: worldVert,
    fragmentShader: worldFrag,
    side: opts.side ?? THREE.FrontSide,
    uniforms: {
      ...globals,
      map: { value: map },
      uLit: { value: opts.lit === false ? 0 : 1 },
      uTint: { value: opts.tint ?? new THREE.Color(1, 1, 1) },
      uFogNear: ownFog ? { value: ownFog.near } : globals.uFogNear,
      uFogFar: ownFog ? { value: ownFog.far } : globals.uFogFar,
      uFogMax: { value: ownFog?.max ?? 1 },
    },
  });
}

const carVert = /* glsl */ `
  ${common}
  ${lightingVert}
  attribute vec3 color;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uLit;
  varying vec3 vUvw;
  varying vec3 vEnvw;
  varying vec3 vLight;
  varying float vFog;
  varying float vFresnel;
  varying float vSpec;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vec4 clip = snapToPixels(projectionMatrix * mv);
    gl_Position = clip;
    float w = mix(1.0, clip.w, uAffine);
    vUvw = vec3(uv * w, w);
    vec3 viewDir = normalize(wp.xyz - cameraPosition);
    vec3 r = reflect(viewDir, n);
    // Equirectangular lookup, computed per vertex like the original hardware.
    vec2 env = vec2(atan(r.x, r.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(r.y, -1.0, 1.0)) / 3.1415926);
    vEnvw = vec3(env * w, w);
    vFresnel = 0.35 + 0.65 * pow(1.0 - max(dot(-viewDir, n), 0.0), 3.0);
    vSpec = pow(max(dot(r, uSunDir), 0.0), 24.0);
    vLight = mix(vec3(1.0), vertexLight(wp.xyz, n), uLit) * color;
    float dist = length(mv.xyz);
    vFog = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  }
`;

const carFrag = /* glsl */ `
  ${ditherFrag}
  uniform sampler2D map;
  uniform sampler2D envMap;
  uniform vec3 uPaint;
  uniform float uReflect;
  uniform vec3 uFogColor;
  uniform vec3 uSunColor;
  uniform vec3 uEmissive;
  varying vec3 vUvw;
  varying vec3 vEnvw;
  varying vec3 vLight;
  varying float vFog;
  varying float vFresnel;
  varying float vSpec;
  void main() {
    vec3 base = texture2D(map, vUvw.xy / vUvw.z).rgb * uPaint;
    vec3 env = texture2D(envMap, vEnvw.xy / vEnvw.z).rgb;
    vec3 c = base * vLight;
    c = mix(c, env, uReflect * vFresnel) + uSunColor * vSpec * uReflect * 1.4;
    c += uEmissive;
    c = mix(c, uFogColor, vFog);
    gl_FragColor = vec4(quantize15(c), 1.0);
  }
`;

// opts: { map, envMap, paint: Color, reflect: 0..1, lit, emissive: Color }
export function carMaterial(opts) {
  return new THREE.ShaderMaterial({
    vertexShader: carVert,
    fragmentShader: carFrag,
    uniforms: {
      ...globals,
      map: { value: opts.map },
      envMap: { value: opts.envMap },
      uPaint: { value: opts.paint ?? new THREE.Color(1, 1, 1) },
      uReflect: { value: opts.reflect ?? 0 },
      uLit: { value: opts.lit === false ? 0 : 1 },
      uEmissive: { value: opts.emissive ?? new THREE.Color(0, 0, 0) },
    },
  });
}

// Sky: vertex-coloured dome, no fog, no lighting.
const skyVert = /* glsl */ `
  ${common}
  attribute vec3 color;
  varying vec3 vColor;
  void main() {
    vColor = color;
    gl_Position = snapToPixels(projectionMatrix * modelViewMatrix * vec4(position, 1.0));
  }
`;
const skyFrag = /* glsl */ `
  ${ditherFrag}
  uniform vec3 uTint;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(quantize15(vColor * uTint), 1.0);
  }
`;
export function skyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uRes: globals.uRes, uAffine: globals.uAffine, uTint: { value: new THREE.Color(1, 1, 1) } },
  });
}

// Ensures a geometry has a vertex colour attribute (the shaders always read one).
export function ensureColor(geometry, rgb = [1, 1, 1]) {
  if (geometry.getAttribute('color')) return geometry;
  const n = geometry.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(rgb, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}
