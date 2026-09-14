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
uniform float uIntensity;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}

// Knight Rider "KITT" voice display: three columns of stacked LED-style
// segments, brightest at the centerline and fading toward the ends —
// modeled after the dashboard voice indicator, not the front scanner bar.
// Driven mainly by mids/highs (the vocal range) rather than bass, per
// product direction, and kept independent of uFlash/uBeat so it never
// introduces its own uncontrolled flicker frequency — only a slow, smooth
// per-column sine drift is added for a bit of organic life.
const float KITT_COLUMNS = 3.0;
const float KITT_GROUP_START = 0.18;
const float KITT_GROUP_WIDTH = 0.64;
const float KITT_COL_GAP = 0.22;
const float KITT_SEGMENTS = 17.0;
const float KITT_SEG_GAP = 0.09;
const float KITT_EDGE_SOFTNESS = 0.07;

// Soft rectangular window over [lo, hi] with feathered (anti-aliased,
// glow-like) edges instead of a hard step.
float softBand(float x, float lo, float hi, float feather) {
  float a = smoothstep(lo - feather, lo + feather, x);
  float b = 1.0 - smoothstep(hi - feather, hi + feather, x);
  return a * b;
}

vec3 kittColor(vec2 uv, float time, float mids, float highs, float intensity) {
  float t = clamp((uv.x - KITT_GROUP_START) / KITT_GROUP_WIDTH, 0.0, 0.999999);
  float inGroup = smoothstep(KITT_GROUP_START - 0.01, KITT_GROUP_START + 0.01, uv.x)
    * (1.0 - smoothstep(KITT_GROUP_START + KITT_GROUP_WIDTH - 0.01, KITT_GROUP_START + KITT_GROUP_WIDTH + 0.01, uv.x));
  float colSpace = t * KITT_COLUMNS;
  float col = floor(colSpace);
  float cellX = fract(colSpace);
  float colMask = softBand(cellX, KITT_COL_GAP, 1.0 - KITT_COL_GAP, KITT_EDGE_SOFTNESS) * inGroup;

  // The center column is always the tallest, like the reference display —
  // not left to per-column randomness. Side columns cap out noticeably
  // lower than the center one regardless of jitter.
  float colCap = col == 1.0 ? 1.0 : 0.68;
  float jitter = 0.9 + 0.1 * hash(vec2(col, 3.0));
  float wave = 0.9 + 0.1 * sin(time * 1.8 + col * 2.1);
  // No uVolume/uBass here on purpose: overall loudness or a pure bass hit
  // must not move this display — only mids/highs (the vocal range) do.
  float envelope = mids * 2.6 + highs * 1.0;
  float raw = clamp(envelope * colCap * jitter * wave * intensity, 0.0, 1.0);
  // A gentle boost curve so quieter speech still makes the columns jump
  // noticeably tall, instead of only the loudest peaks reaching high up.
  float level = pow(raw, 0.55);

  float segIndex = floor(uv.y * KITT_SEGMENTS);
  float segY = fract(uv.y * KITT_SEGMENTS);
  float segGapMask = softBand(segY, KITT_SEG_GAP, 1.0 - KITT_SEG_GAP, KITT_EDGE_SOFTNESS);

  float maxSegHalf = (KITT_SEGMENTS - 1.0) * 0.5;
  float segCenterOffset = abs(segIndex - maxSegHalf);
  float litHalf = level * maxSegHalf;
  // Shifted smoothstep so a segment only lights once litHalf actually
  // reaches it — at level 0 every segment (including the center one) is
  // fully dark, instead of the centerline being permanently lit.
  float segBrightness = 1.0 - smoothstep(litHalf - 1.0, litHalf, segCenterOffset);

  float brightness = segBrightness * segGapMask * colMask;
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

  vec3 kitt = kittColor(vUv, uTime, uMids, uHighs, uIntensity);
  color = mix(color, kitt, uKitt);

  float vignette = smoothstep(1.15, 0.15, dist);
  color *= vignette;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
