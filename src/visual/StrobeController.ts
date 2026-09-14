import type { AudioFeatures } from '../audio/AudioAnalyzer';

interface StrobeProfile {
  /** Hard cap on how many beat-triggered flashes can fire per second. */
  maxFlashesPerSecond: number;
  /** Ceiling applied to the final output intensity. */
  maxBrightness: number;
  /** How quickly a flash fades back to zero, as a per-second multiplier. */
  decayPerSecond: number;
  /** How much of a beat impulse becomes a flash, before maxBrightness is applied. */
  beatFlashStrength: number;
  /** How strongly continuous bass energy contributes a steady pulse (no flash needed). */
  bassPulseStrength: number;
  /** 0..1, how fast intensity snaps toward a new flash target. Lower = smoother/slower. */
  attack: number;
}

const SAFE_PROFILE: StrobeProfile = {
  maxFlashesPerSecond: 3,
  maxBrightness: 0.7,
  decayPerSecond: 0.06,
  beatFlashStrength: 0.85,
  bassPulseStrength: 0.5,
  attack: 0.45,
};

const FULL_PROFILE: StrobeProfile = {
  maxFlashesPerSecond: 8,
  maxBrightness: 1.0,
  decayPerSecond: 0.02,
  beatFlashStrength: 1.0,
  bassPulseStrength: 0.7,
  attack: 1.0,
};

/**
 * Turns raw audio features into a single, rate- and brightness-limited flash
 * intensity. Kept separate from the shader so safety limits live in one
 * obvious place.
 */
export class StrobeController {
  /** Current output intensity, 0..1. Read this after calling update(). */
  intensity = 0;

  /** User-controlled overall intensity multiplier, 0..1. */
  masterIntensity = 1;

  private safeMode = true;
  private lastFlashTime = -Infinity;

  setSafeMode(enabled: boolean): void {
    this.safeMode = enabled;
  }

  isSafeMode(): boolean {
    return this.safeMode;
  }

  private get profile(): StrobeProfile {
    return this.safeMode ? SAFE_PROFILE : FULL_PROFILE;
  }

  /**
   * @param features latest audio analysis
   * @param nowSeconds monotonic clock, seconds
   * @param dtSeconds time since previous update, seconds
   */
  update(features: AudioFeatures, nowSeconds: number, dtSeconds: number): number {
    const profile = this.profile;

    // Exponential decay toward zero, framerate independent.
    const decay = Math.pow(profile.decayPerSecond, Math.max(dtSeconds, 0));
    this.intensity *= decay;

    // Continuous bass pulse acts as a floor, independent of beat triggers.
    const bassPulse = features.bass * profile.bassPulseStrength * profile.maxBrightness;
    if (bassPulse > this.intensity) {
      this.intensity += (bassPulse - this.intensity) * profile.attack;
    }

    // A freshly detected beat can push intensity up, but only if the
    // configured max flash frequency allows it.
    const minInterval = 1 / profile.maxFlashesPerSecond;
    const isFreshBeat = features.beat > 0.99;
    if (isFreshBeat && nowSeconds - this.lastFlashTime >= minInterval) {
      this.lastFlashTime = nowSeconds;
      const target = profile.beatFlashStrength * profile.maxBrightness;
      this.intensity += (target - this.intensity) * profile.attack;
    }

    this.intensity = Math.min(this.intensity, profile.maxBrightness);
    if (this.intensity < 0) this.intensity = 0;

    return this.intensity * this.masterIntensity;
  }

  reset(): void {
    this.intensity = 0;
    this.lastFlashTime = -Infinity;
  }
}
