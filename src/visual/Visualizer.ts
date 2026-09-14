import * as THREE from 'three';
import vertexShader from './shader.vert?raw';
import fragmentShader from './shader.frag?raw';
import { AudioAnalyzer } from '../audio/AudioAnalyzer';
import { StrobeController } from './StrobeController';

/**
 * Fullscreen Three.js shader visualizer. Owns the render loop and feeds
 * audio + strobe values into the shader as uniforms every frame.
 */
export class Visualizer {
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly material: THREE.ShaderMaterial;

  private readonly startTime = performance.now();
  private lastFrameTime = this.startTime;
  private rafId: number | null = null;

  private analyzer: AudioAnalyzer | null = null;
  private strobe: StrobeController | null = null;

  /** Latest flash intensity, exposed for the UI overlay (avoids re-reading uniforms). */
  lastFlash = 0;
  /** Latest overall volume, exposed for the UI overlay. */
  lastVolume = 0;

  private kittTarget = 0;
  private kittAmount = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'strobe-canvas';

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uVolume: { value: 0 },
        uBass: { value: 0 },
        uMids: { value: 0 },
        uHighs: { value: 0 },
        uBeat: { value: 0 },
        uFlash: { value: 0 },
        uKitt: { value: 0 },
        uIntensity: { value: 1 },
      },
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(mesh);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(width, height);
  };

  /** Smoothly crossfades into/out of the KITT voice-display look. */
  setKittMode(enabled: boolean): void {
    this.kittTarget = enabled ? 1 : 0;
  }

  start(analyzer: AudioAnalyzer, strobe: StrobeController): void {
    this.analyzer = analyzer;
    this.strobe = strobe;
    this.lastFrameTime = performance.now();
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);

    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.kittAmount += (this.kittTarget - this.kittAmount) * Math.min(1, dt * 4);
    this.material.uniforms.uKitt.value = this.kittAmount;

    if (this.analyzer && this.strobe) {
      const features = this.analyzer.update();
      const flash = this.strobe.update(features, now / 1000, dt);

      const u = this.material.uniforms;
      u.uVolume.value = features.volume;
      u.uBass.value = features.bass;
      u.uMids.value = features.mids;
      u.uHighs.value = features.highs;
      u.uBeat.value = features.beat;
      u.uFlash.value = flash;
      u.uIntensity.value = this.strobe.masterIntensity;
      u.uTime.value = (now - this.startTime) / 1000;

      this.lastFlash = flash;
      this.lastVolume = features.volume;
    }

    this.renderer.render(this.scene, this.camera);
  };

  /** Stops rendering and drops references to audio nodes; keeps the canvas/renderer for reuse. */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.analyzer = null;
    this.strobe = null;
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.resize);
    this.material.dispose();
    this.renderer.dispose();
  }
}
