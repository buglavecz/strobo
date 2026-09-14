import './ui/styles.css';
import { UI, type AudioSource } from './ui/UI';
import { AudioAnalyzer } from './audio/AudioAnalyzer';
import { StrobeController } from './visual/StrobeController';
import { Visualizer } from './visual/Visualizer';

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('Missing #app root element');
}

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let analyzer: AudioAnalyzer | null = null;
let visualizer: Visualizer | null = null;

// Settings persist across start/stop cycles within a session.
const strobe = new StrobeController();
let kittModeEnabled = false;

const ui = new UI(appRoot, {
  onStart: () => {
    void handleStart();
  },
  onStop: () => {
    handleStop();
  },
  onSafeModeChange: (enabled) => {
    strobe.setSafeMode(enabled);
  },
  onIntensityChange: (value) => {
    strobe.masterIntensity = value;
  },
  onKittModeChange: (enabled) => {
    kittModeEnabled = enabled;
    visualizer?.setKittMode(enabled);
  },
});

if (ui.isReducedMotion()) {
  strobe.setSafeMode(true);
}

/** Requests the chosen audio source and returns a stream containing only audio tracks. */
async function acquireAudioStream(source: AudioSource): Promise<MediaStream> {
  if (source === 'display') {
    // getDisplayMedia requires a video constraint in most browsers even
    // when only audio is needed; the video track is stopped and discarded
    // immediately below.
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    for (const track of displayStream.getVideoTracks()) {
      track.stop();
      displayStream.removeTrack(track);
    }

    if (displayStream.getAudioTracks().length === 0) {
      for (const track of displayStream.getTracks()) track.stop();
      throw new Error('NO_AUDIO_TRACK');
    }

    return displayStream;
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

async function handleStart(): Promise<void> {
  const source = ui.getAudioSource();

  try {
    mediaStream = await acquireAudioStream(source);
  } catch (err) {
    if (source === 'display' && err instanceof Error && err.message === 'NO_AUDIO_TRACK') {
      ui.showError(
        'Nem érkezett megosztott hang. A felugró ablakban válaszd ki a hangot lejátszó fület (pl. a YouTube-fülét), és győződj meg róla, hogy a „fül hangjának megosztása” be van pipálva, majd próbáld újra.'
      );
    } else {
      ui.showError(
        source === 'display'
          ? 'A képernyő-/fülhang megosztása megtagadva vagy nem elérhető. Engedélyezd és próbáld újra, vagy válts Mikrofonra a Beállításokban.'
          : 'A mikrofonhoz való hozzáférés megtagadva vagy nem elérhető. Az Audio Strobe-nak szüksége van a mikrofonra, hogy reagálni tudjon a hangra — engedélyezd, és próbáld újra.'
      );
    }
    return;
  }

  // If the user stops sharing from the browser's own UI (e.g. the "Stop
  // sharing" bar, or revoking mic permission), tear everything down.
  for (const track of mediaStream.getTracks()) {
    track.addEventListener('ended', () => handleStop());
  }

  audioContext = new AudioContext();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  analyzer = new AudioAnalyzer(mediaStream, audioContext);
  strobe.reset();

  visualizer = new Visualizer();
  visualizer.setKittMode(kittModeEnabled);
  ui.attachCanvas(visualizer.canvas);
  visualizer.start(analyzer, strobe);

  ui.showStage(() => ({
    volume: visualizer?.lastVolume ?? 0,
    flash: visualizer?.lastFlash ?? 0,
  }));

  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // Fullscreen may be unavailable/denied; the visualizer still works windowed.
  }
}

function handleStop(): void {
  visualizer?.dispose();
  visualizer = null;

  analyzer?.dispose();
  analyzer = null;

  mediaStream = null;

  if (audioContext) {
    void audioContext.close();
    audioContext = null;
  }

  if (document.fullscreenElement) {
    void document.exitFullscreen();
  }

  ui.showLanding();
}

document.addEventListener('fullscreenchange', () => {
  // Exiting fullscreen (Escape, browser chrome, etc.) must never leave the
  // microphone running in the background.
  if (!document.fullscreenElement && (analyzer || visualizer)) {
    handleStop();
  }
});
