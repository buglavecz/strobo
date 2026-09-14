export type AudioSource = 'microphone' | 'display';

export interface UICallbacks {
  onStart: () => void;
  onStop: () => void;
  /** Called only after the user has confirmed disabling Safe Mode (or when re-enabling it, immediately). */
  onSafeModeChange: (enabled: boolean) => void;
  onIntensityChange: (value: number) => void;
}

const OVERLAY_HIDE_DELAY_MS = 2500;

export class UI {
  private readonly root: HTMLElement;
  private readonly callbacks: UICallbacks;
  private readonly reducedMotion: boolean;

  private landingEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private confirmEl!: HTMLElement;
  private safeModeToggle!: HTMLInputElement;
  private intensityInput!: HTMLInputElement;
  private levelBar!: HTMLElement;
  private canvasHost!: HTMLElement;
  private sourceRadios!: HTMLInputElement[];
  private readonly displayCaptureSupported: boolean;

  private overlayHideTimer: number | null = null;
  private meterInterval: number | null = null;
  private getMeterValues: (() => { volume: number; flash: number }) | null = null;

  constructor(root: HTMLElement, callbacks: UICallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.displayCaptureSupported = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
    this.build();
  }

  private build(): void {
    this.root.innerHTML = '';

    this.landingEl = document.createElement('div');
    this.landingEl.className = 'landing';
    this.landingEl.innerHTML = `
      <div class="landing-card">
        <h1 class="title">Audio Strobe</h1>
        <p class="subtitle">Turn sound into light.</p>

        <div class="warning">
          <strong>Photosensitivity warning:</strong> this app produces rapid
          flashing light synchronized to sound. Flashing lights can trigger
          seizures or other adverse reactions in people with photosensitive
          epilepsy or other conditions. Do not use if that applies to you or
          anyone nearby. Stop immediately if you feel unwell.
        </div>

        <button class="start-button" type="button">Start</button>

        <div class="error hidden"></div>

        <details class="settings" open>
          <summary>Settings</summary>

          <p class="group-label">Audio source</p>
          <label class="row radio-row">
            <span>
              Microphone
              <span class="hint-inline">reacts to whatever the mic picks up in the room</span>
            </span>
            <input type="radio" name="audio-source" class="source-radio" value="microphone" checked />
          </label>
          <label class="row radio-row ${this.displayCaptureSupported ? '' : 'disabled'}">
            <span>
              Browser tab / system audio
              <span class="hint-inline">e.g. a YouTube tab — no external mic needed</span>
            </span>
            <input type="radio" name="audio-source" class="source-radio" value="display" ${this.displayCaptureSupported ? '' : 'disabled'} />
          </label>
          <p class="hint">
            ${this.displayCaptureSupported
              ? "For tab audio, pick the tab that's playing sound in the browser's share dialog and make sure “share tab audio” is checked."
              : 'Tab/system audio capture is not supported in this browser — microphone only.'}
          </p>

          <p class="group-label">Safety</p>
          <label class="row">
            <span>Safe Mode</span>
            <input type="checkbox" class="safe-mode-toggle" checked />
          </label>
          <p class="hint">
            Safe Mode limits flash frequency and brightness and smooths
            transitions. ${this.reducedMotion ? 'Your system is set to reduce motion, so Safe Mode is locked on.' : 'Turning it off requires an extra confirmation.'}
          </p>
          <label class="row">
            <span>Intensity</span>
            <input type="range" class="intensity-input" min="0" max="1" step="0.01" value="1" />
          </label>
          <p class="hint">Microphone/tab audio access is requested only after you press Start, and is released whenever you stop or leave fullscreen.</p>
        </details>
      </div>
    `;

    this.stageEl = document.createElement('div');
    this.stageEl.className = 'stage hidden';

    this.canvasHost = document.createElement('div');
    this.canvasHost.className = 'canvas-host';
    this.stageEl.appendChild(this.canvasHost);

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'overlay hidden';
    this.overlayEl.innerHTML = `
      <button type="button" class="stop-button">Stop</button>
      <label class="row">
        <span>Safe Mode</span>
        <input type="checkbox" class="overlay-safe-mode-toggle" checked />
      </label>
      <label class="row">
        <span>Intensity</span>
        <input type="range" class="overlay-intensity-input" min="0" max="1" step="0.01" value="1" />
      </label>
      <div class="level-meter"><div class="level-bar"></div></div>
    `;
    this.stageEl.appendChild(this.overlayEl);

    this.confirmEl = document.createElement('div');
    this.confirmEl.className = 'confirm hidden';
    this.confirmEl.innerHTML = `
      <div class="confirm-card">
        <p>
          Disabling Safe Mode allows faster, brighter, less smoothed
          flashing. This increases the risk of triggering seizures in
          photosensitive people. Continue only if you understand the risk.
        </p>
        <div class="confirm-actions">
          <button type="button" class="confirm-cancel">Keep Safe Mode</button>
          <button type="button" class="confirm-accept">Disable Anyway</button>
        </div>
      </div>
    `;

    this.root.appendChild(this.landingEl);
    this.root.appendChild(this.stageEl);
    this.root.appendChild(this.confirmEl);

    this.errorEl = this.landingEl.querySelector('.error') as HTMLElement;
    this.safeModeToggle = this.landingEl.querySelector('.safe-mode-toggle') as HTMLInputElement;
    this.intensityInput = this.landingEl.querySelector('.intensity-input') as HTMLInputElement;
    this.levelBar = this.overlayEl.querySelector('.level-bar') as HTMLElement;
    this.sourceRadios = Array.from(this.landingEl.querySelectorAll('.source-radio'));

    const overlaySafeModeToggle = this.overlayEl.querySelector('.overlay-safe-mode-toggle') as HTMLInputElement;
    const overlayIntensityInput = this.overlayEl.querySelector('.overlay-intensity-input') as HTMLInputElement;

    if (this.reducedMotion) {
      this.safeModeToggle.disabled = true;
      overlaySafeModeToggle.disabled = true;
    }

    (this.landingEl.querySelector('.start-button') as HTMLButtonElement).addEventListener('click', () => {
      this.hideError();
      this.callbacks.onStart();
    });

    (this.overlayEl.querySelector('.stop-button') as HTMLButtonElement).addEventListener('click', () => {
      this.callbacks.onStop();
    });

    const wireSafeModeToggle = (input: HTMLInputElement, sync: HTMLInputElement) => {
      input.addEventListener('change', () => {
        if (input.checked) {
          sync.checked = true;
          this.callbacks.onSafeModeChange(true);
          return;
        }
        // Disabling requires confirmation; revert until confirmed.
        input.checked = true;
        this.confirmDisableSafeMode().then((confirmed) => {
          if (confirmed) {
            input.checked = false;
            sync.checked = false;
            this.callbacks.onSafeModeChange(false);
          }
        });
      });
    };
    wireSafeModeToggle(this.safeModeToggle, overlaySafeModeToggle);
    wireSafeModeToggle(overlaySafeModeToggle, this.safeModeToggle);

    const wireIntensity = (input: HTMLInputElement, sync: HTMLInputElement) => {
      input.addEventListener('input', () => {
        sync.value = input.value;
        this.callbacks.onIntensityChange(parseFloat(input.value));
      });
    };
    wireIntensity(this.intensityInput, overlayIntensityInput);
    wireIntensity(overlayIntensityInput, this.intensityInput);

    this.stageEl.addEventListener('mousemove', () => this.showOverlay());
    this.stageEl.addEventListener('touchstart', () => this.showOverlay(), { passive: true });
  }

  showLanding(): void {
    this.stopMeter();
    this.landingEl.classList.remove('hidden');
    this.stageEl.classList.add('hidden');
    this.overlayEl.classList.add('hidden');
  }

  showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.classList.remove('hidden');
  }

  private hideError(): void {
    this.errorEl.classList.add('hidden');
  }

  attachCanvas(canvas: HTMLCanvasElement): void {
    this.canvasHost.innerHTML = '';
    this.canvasHost.appendChild(canvas);
  }

  showStage(getMeterValues: () => { volume: number; flash: number }): void {
    this.getMeterValues = getMeterValues;
    this.landingEl.classList.add('hidden');
    this.stageEl.classList.remove('hidden');
    this.showOverlay();
    this.startMeter();
  }

  private showOverlay(): void {
    this.overlayEl.classList.remove('hidden');
    if (this.overlayHideTimer !== null) {
      window.clearTimeout(this.overlayHideTimer);
    }
    this.overlayHideTimer = window.setTimeout(() => {
      this.overlayEl.classList.add('hidden');
    }, OVERLAY_HIDE_DELAY_MS);
  }

  private startMeter(): void {
    this.stopMeter();
    this.meterInterval = window.setInterval(() => {
      if (!this.getMeterValues) return;
      const { volume, flash } = this.getMeterValues();
      const level = Math.max(volume, flash);
      this.levelBar.style.transform = `scaleX(${Math.min(1, level)})`;
    }, 100);
  }

  private stopMeter(): void {
    if (this.meterInterval !== null) {
      window.clearInterval(this.meterInterval);
      this.meterInterval = null;
    }
    if (this.overlayHideTimer !== null) {
      window.clearTimeout(this.overlayHideTimer);
      this.overlayHideTimer = null;
    }
  }

  private confirmDisableSafeMode(): Promise<boolean> {
    if (this.reducedMotion) return Promise.resolve(false);
    this.confirmEl.classList.remove('hidden');
    return new Promise((resolve) => {
      const cancelBtn = this.confirmEl.querySelector('.confirm-cancel') as HTMLButtonElement;
      const acceptBtn = this.confirmEl.querySelector('.confirm-accept') as HTMLButtonElement;
      const cleanup = (result: boolean) => {
        this.confirmEl.classList.add('hidden');
        cancelBtn.removeEventListener('click', onCancel);
        acceptBtn.removeEventListener('click', onAccept);
        resolve(result);
      };
      const onCancel = () => cleanup(false);
      const onAccept = () => cleanup(true);
      cancelBtn.addEventListener('click', onCancel);
      acceptBtn.addEventListener('click', onAccept);
    });
  }

  isReducedMotion(): boolean {
    return this.reducedMotion;
  }

  getAudioSource(): AudioSource {
    const checked = this.sourceRadios.find((radio) => radio.checked);
    return (checked?.value as AudioSource) ?? 'microphone';
  }
}
