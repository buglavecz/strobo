precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform float uVolume;
uniform float uBass;
uniform float uMids;
uniform float uHighs;
uniform float uBeat;
uniform float uFlash;
uniform float uKitt;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}

// Knight Rider "KITT" voice display: a row of vertical red bars, symmetric
// about the centerline, driven by the same safety-limited audio signals as
// the rest of the shader (uFlash is already rate/brightness limited by
// StrobeController, so this mode never introduces its own flicker source —
// only a slow, smooth sine drift is added per bar for a bit of life).
const float KITT_BARS = 15.0;
const float KITT_GAP = 0.16;
const float KITT_MAX_HALF = 0.17;

vec3 kittColor(vec2 uv, float time, float volume, float bass, float flash) {
  float col = floor(uv.x * KITT_BARS);
  float cellX = fract(uv.x * KITT_BARS);
  float barMask = step(KITT_GAP, cellX) * step(cellX, 1.0 - KITT_GAP);

  float center = (KITT_BARS - 1.0) * 0.5;
  float p = (col - center) / center;

  float rnd = hash(vec2(col, 7.0));
  float wave = 0.85 + 0.15 * sin(time * 2.2 + col * 1.7);
  float envelope = volume * 0.75 + bass * 0.35;
  // Beat impulses are intentionally left out here: uFlash is the only
  // signal StrobeController rate-limits, so it's the sole source of sudden
  // "kicks" in KITT mode too — this keeps the same max-flash-frequency
  // guarantee that applies to the default visual.
  float level = envelope * (0.6 + rnd * 0.4) * wave + flash * 0.6;
  level *= mix(1.0, 0.55, abs(p));
  level = clamp(level, 0.0, 1.0);

  float halfHeight = level * KITT_MAX_HALF;
  float distFromCenter = abs(uv.y - 0.5);

  float lit = smoothstep(halfHeight + 0.01, halfHeight - 0.01, distFromCenter);
  float glow = exp(-max(distFromCenter - halfHeight, 0.0) * 40.0) * 0.35;

  float brightness = (lit + glow) * barMask;
  return vec3(1.0, 0.05, 0.02) * brightness;
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

  vec3 kitt = kittColor(vUv, uTime, uVolume, uBass, uFlash);
  color = mix(color, kitt, uKitt);

  float vignette = smoothstep(1.15, 0.15, dist);
  color *= vignette;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
