export interface AudioFeatures {
  /** Overall loudness, roughly 0..1 */
  volume: number;
  /** Low frequency energy, roughly 0..1 */
  bass: number;
  /** Mid frequency energy, roughly 0..1 */
  mids: number;
  /** High frequency energy, roughly 0..1 */
  highs: number;
  /** Impulse strength of a just-detected beat/transient, 0..1, decays quickly */
  beat: number;
}

const FFT_SIZE = 2048;
const HISTORY_LENGTH = 43; // ~0.7s of history at 60fps, used for beat detection

// Adaptive noise-floor tuning. The floor rises slowly (so it tracks steady
// background hiss) and falls slowly (so it doesn't chase transients), which
// keeps constant mic noise from being reported as signal.
const FLOOR_RISE = 0.02;
const FLOOR_FALL = 0.004;

/** Tracks a slow-moving noise floor and rescales incoming samples above it into 0..1. */
class AdaptiveGate {
  private floor: number;

  constructor(initialFloor = 0.02) {
    this.floor = initialFloor;
  }

  normalize(raw: number): number {
    if (raw < this.floor) {
      this.floor += (raw - this.floor) * FLOOR_FALL;
    } else {
      this.floor += (raw - this.floor) * FLOOR_RISE;
    }
    const floor = this.floor;
    const denom = Math.max(1 - floor, 0.0001);
    const value = (raw - floor) / denom;
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }
}

export class AudioAnalyzer {
  readonly features: AudioFeatures = {
    volume: 0,
    bass: 0,
    mids: 0,
    highs: 0,
    beat: 0,
  };

  private readonly audioContext: AudioContext;
  private readonly analyser: AnalyserNode;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly stream: MediaStream;

  private readonly frequencyData: Uint8Array<ArrayBuffer>;
  private readonly timeDomainData: Uint8Array<ArrayBuffer>;

  private readonly volumeGate = new AdaptiveGate();
  private readonly bassGate = new AdaptiveGate();
  private readonly midsGate = new AdaptiveGate();
  private readonly highsGate = new AdaptiveGate();

  // Circular energy history for beat detection.
  private readonly energyHistory = new Float32Array(HISTORY_LENGTH);
  private historyIndex = 0;
  private historyFilled = 0;
  private lastBeatTime = -Infinity;

  private bassRange: [number, number] = [0, 0];
  private midsRange: [number, number] = [0, 0];
  private highsRange: [number, number] = [0, 0];

  constructor(stream: MediaStream, audioContext: AudioContext) {
    this.stream = stream;
    this.audioContext = audioContext;
    this.source = audioContext.createMediaStreamSource(stream);

    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.6;
    this.source.connect(this.analyser);

    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeDomainData = new Uint8Array(this.analyser.fftSize);

    this.computeFrequencyRanges();
  }

  private computeFrequencyRanges(): void {
    const nyquist = this.audioContext.sampleRate / 2;
    const binCount = this.analyser.frequencyBinCount;
    const hzPerBin = nyquist / binCount;

    const binFor = (hz: number) => Math.max(0, Math.min(binCount - 1, Math.round(hz / hzPerBin)));

    this.bassRange = [binFor(20), binFor(250)];
    this.midsRange = [binFor(250), binFor(2000)];
    this.highsRange = [binFor(2000), binFor(8000)];
  }

  private averageBand(from: number, to: number): number {
    const end = Math.max(from + 1, to);
    let sum = 0;
    for (let i = from; i < end; i++) {
      sum += this.frequencyData[i];
    }
    return sum / (end - from) / 255;
  }

  /** Reads the latest audio buffers and updates `features` in place. Call once per animation frame. */
  update(): AudioFeatures {
    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeDomainData);

    // RMS volume from time-domain samples.
    let sumSquares = 0;
    for (let i = 0; i < this.timeDomainData.length; i++) {
      const sample = (this.timeDomainData[i] - 128) / 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / this.timeDomainData.length);

    const rawBass = this.averageBand(this.bassRange[0], this.bassRange[1]);
    const rawMids = this.averageBand(this.midsRange[0], this.midsRange[1]);
    const rawHighs = this.averageBand(this.highsRange[0], this.highsRange[1]);

    this.features.volume = this.volumeGate.normalize(rms);
    this.features.bass = this.bassGate.normalize(rawBass);
    this.features.mids = this.midsGate.normalize(rawMids);
    this.features.highs = this.highsGate.normalize(rawHighs);

    this.features.beat = this.detectBeat(this.features.bass, this.features.volume);

    return this.features;
  }

  private detectBeat(bass: number, volume: number): number {
    const instantEnergy = bass * 0.7 + volume * 0.3;

    let historyAverage = 0;
    for (let i = 0; i < this.historyFilled; i++) {
      historyAverage += this.energyHistory[i];
    }
    historyAverage = this.historyFilled > 0 ? historyAverage / this.historyFilled : 0;

    this.energyHistory[this.historyIndex] = instantEnergy;
    this.historyIndex = (this.historyIndex + 1) % HISTORY_LENGTH;
    this.historyFilled = Math.min(this.historyFilled + 1, HISTORY_LENGTH);

    const now = this.audioContext.currentTime;
    const timeSinceLastBeat = now - this.lastBeatTime;

    const minimumLevel = 0.12; // ignore quiet room tone entirely
    const threshold = historyAverage * 1.35 + 0.05;
    const refractorySeconds = 0.1;

    const decayedPrevious = this.features.beat * 0.75;

    if (
      instantEnergy > minimumLevel &&
      instantEnergy > threshold &&
      timeSinceLastBeat > refractorySeconds &&
      this.historyFilled >= HISTORY_LENGTH / 2
    ) {
      this.lastBeatTime = now;
      return 1;
    }

    return decayedPrevious;
  }

  /** Stops analysis and releases the microphone stream. */
  dispose(): void {
    this.source.disconnect();
    this.analyser.disconnect();
    for (const track of this.stream.getTracks()) {
      track.stop();
    }
  }
}
