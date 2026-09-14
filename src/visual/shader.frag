precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float uVolume;
uniform float uBass;
uniform float uMids;
uniform float uHighs;
uniform float uBeat;
uniform float uFlash;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float dist = length(uv);

  // Hue drifts with which frequency band currently dominates, rather than
  // drawing discrete bars per band.
  vec3 bassColor = vec3(1.0, 0.22, 0.1);
  vec3 midColor = vec3(0.15, 1.0, 0.45);
  vec3 highColor = vec3(0.25, 0.55, 1.0);
  vec3 tint = normalize(bassColor * uBass + midColor * uMids + highColor * uHighs + vec3(0.0005));

  // Soft radial glow that swells with bass, with a small extra kick on beats.
  float pulse = smoothstep(0.95, 0.0, dist) * uBass * (0.45 + uBeat * 0.4);

  // Low-level ambient brightness so the screen never goes completely inert.
  float bandEnergy = uBass * 0.6 + uMids * 0.3 + uHighs * 0.3;
  float ambient = bandEnergy * uVolume * 0.15;

  vec3 subtleColor = tint * (ambient + pulse);

  // The controlled strobe flash, already rate- and brightness-limited
  // upstream by StrobeController. This is the primary light source.
  vec3 flashColor = vec3(1.0) * uFlash;

  // Fine grain keeps the image alive at low intensity and adds texture to
  // flashes, without reading as a conventional spectrum visualizer.
  float grain = hash(uv * uResolution.xy * 0.5 + uTime * 60.0) - 0.5;
  grain *= 0.025 + uFlash * 0.05 + uBeat * 0.03;

  vec3 color = subtleColor + flashColor + vec3(grain);

  float vignette = smoothstep(1.15, 0.15, dist);
  color *= vignette;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
