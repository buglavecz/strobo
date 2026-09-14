# Audio Strobe

A fullscreen, browser-based audio-reactive stroboscope. It listens to an
audio source — your microphone, or a browser tab/system audio (e.g. a
YouTube tab) — and turns sound into light: bass and beats drive flashes and
a soft glow across the whole screen.

> **⚠️ Photosensitivity warning**
> This application intentionally produces rapid flashing light synchronized
> to sound. Flashing lights can trigger seizures or other adverse reactions
> in people with photosensitive epilepsy or other conditions. Do not use it
> if that applies to you or anyone nearby, and stop immediately if you feel
> unwell. **Safe Mode is on by default** and limits flash frequency and
> brightness — see [Safety](#safety) below.

## Install & run

```bash
npm install
npm run dev
```

Then open the printed local URL (typically `http://localhost:5173`) in a
modern browser. To produce an optimized production build:

```bash
npm run build
npm run preview
```

## How it works

1. The landing screen shows the app name, a short description, the warning
   above, and a **Start** button. **No microphone or screen-sharing
   permission is requested on load.**
2. In **Settings**, pick an **Audio source** before starting:
   - **Microphone** (default) — uses `getUserMedia({ audio: true })`.
   - **Browser tab / system audio** — uses `getDisplayMedia({ video: true, audio: true })`.
     A browser share picker opens; choose the tab that's actually playing
     sound (e.g. a YouTube tab) and make sure "share tab audio" is checked.
     The video track from the picker is stopped and discarded immediately —
     only its audio is used.
3. Clicking **Start**:
   - Requests the selected audio source.
   - Creates an `AudioContext` and connects the resulting stream to an
     `AnalyserNode`.
   - Requests fullscreen via the Fullscreen API.
   - Switches to the fullscreen WebGL visualizer.
4. If permission is denied, unavailable, or (for tab sharing) no audio track
   was actually shared, a clear error is shown on the landing screen and you
   can try again or switch source.
5. While visualizing, the UI is hidden. Move the mouse (or tap) to reveal a
   small overlay with **Stop**, a **Safe Mode** toggle, an **Intensity**
   slider, and a live audio level meter; it fades out again after a few
   seconds.
6. Pressing **Escape** exits fullscreen, which immediately stops audio
   processing and releases the audio stream (microphone or shared tab). The
   **Stop** button does the same without requiring fullscreen exit first, and
   so does stopping the share from the browser's own "Stop sharing" control.

### Browser tab / system audio notes

- Best supported in Chromium-based browsers (Chrome, Edge): pick "Chrome
  Tab" (or equivalent) in the share dialog and enable "Share tab audio" to
  capture just that tab, e.g. a YouTube video.
- Firefox supports `getDisplayMedia` audio capture in some versions, but
  typically only for the whole screen/system audio, not a single tab.
- Safari does not currently support audio in `getDisplayMedia`; the option
  is hidden there and only Microphone is offered.
- This still respects the same Safe Mode and flash-rate limits as the
  microphone source — reacting to a different sound source doesn't change
  the safety behavior.

### KITT mode

A "KITT mód" toggle in Settings (and the in-session overlay) swaps the
default glow visual for a row of vertical red bars reminiscent of the
Knight Rider KITT voice display, growing symmetrically from a centerline.
It's driven by the same audio features and the same safety-limited
`uFlash` signal as the default visual, so Safe Mode's flash-rate and
brightness limits apply here too.

## Browser requirements

Requires a browser with `getUserMedia`, `AudioContext`/`AnalyserNode`, WebGL,
and the Fullscreen API — current Chrome, Edge, Firefox, and Safari all
qualify. Microphone access requires a secure context (`https://`, or
`localhost` during development).

## Safety

- **Safe Mode is enabled by default.** It caps flash frequency (max ~3
  flashes/sec) and brightness, and uses smoother, slower transitions to
  reduce rapid alternating flashes.
- Turning Safe Mode off requires an explicit extra confirmation dialog that
  restates the seizure risk.
- If your OS/browser reports `prefers-reduced-motion: reduce`, Safe Mode is
  forced on and the toggle to disable it is locked.
- The **Stop** button is always available in the overlay and immediately
  halts rendering and audio processing.
- Stopping the visualizer or exiting fullscreen always stops all audio
  tracks and releases the microphone — it is never left running in the
  background.
- The app never attempts to bypass or disable browser-level flashing/motion
  protections.

## Architecture

```
src/
  main.ts                 orchestrates state: landing → mic/audio setup → fullscreen visualizer → stop
  audio/
    AudioAnalyzer.ts       wraps AnalyserNode; computes volume/bass/mids/highs/beat, 0..1 normalized,
                            with an adaptive noise floor and a lightweight transient/beat detector
  visual/
    StrobeController.ts    turns audio features into a single, rate- and brightness-limited flash
                            intensity (Safe Mode vs. full profile live here)
    Visualizer.ts           Three.js fullscreen-quad renderer; owns the requestAnimationFrame loop
                            and feeds audio + strobe values into the shader as uniforms
    shader.vert / shader.frag   GLSL: mostly-black background, audio-reactive white flashes, subtle
                            per-band color tint, radial bass pulse, light film grain
  ui/
    UI.ts                   landing screen, auto-hiding in-session overlay, error/confirm dialogs
    styles.css               dark, minimal styling
```

Audio analysis, the strobe/safety logic, and the WebGL rendering are kept in
separate modules on purpose: `AudioAnalyzer` only ever describes what the
microphone is doing, `StrobeController` is the single place that decides how
bright/fast the strobe is allowed to be, and `Visualizer` just renders
whatever numbers it's given. New visual styles can be added by swapping or
extending the fragment shader without touching audio or safety code.

## Performance

The render loop uses `requestAnimationFrame`, reuses typed arrays (`Uint8Array`
FFT buffers, a `Float32Array` beat-detection history) instead of allocating
per frame, and does all per-pixel work on the GPU via a single fullscreen
shader — targeting 60 FPS on modern hardware.
