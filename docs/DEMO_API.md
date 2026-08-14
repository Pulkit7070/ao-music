# AO music visualizer demo API

Shared foundation for the mascot music-visualizer demos. Two modules, no build
step, no dependencies:

| Module | Exports |
| --- | --- |
| `src/rig.js` | `createRig` (default too), `JOINTS`, `JOINT_PIVOTS`, `JOINT_LIMITS`, `NEUTRAL_POSE`, `VIEW_BOX` |
| `src/console.js` | `createConsole` (default too), `BANDS`, `DETECTOR_DEFAULTS` |

Matching stylesheets: `src/rig.css`, `src/console.css`. Both are plain CSS with
custom properties you can override per version.

## Layout rule

Every version is one file:

```
versions/vN-slug.html
```

Standalone: its own markup, CSS and choreography live in that one file. The only
things it may import from outside itself are the shared modules and their
stylesheets:

```html
<link rel="stylesheet" href="../src/rig.css" />
<link rel="stylesheet" href="../src/console.css" />
<script type="module">
  import { createRig } from '../src/rig.js';
  import { createConsole } from '../src/console.js';
</script>
```

Do not edit `src/`, `assets/`, `index.html`, or another version's file. If you
need something the rig or console does not expose, say so instead of forking the
modules. Serve the repo root over any static server (`python3 -m http.server`)
and open `http://127.0.0.1:8000/versions/vN-slug.html`. `file://` will not work,
because ES modules need HTTP.

Claimed files, one per worker:

| File | Owner |
| --- | --- |
| `versions/v1-neon-grid.html` | version worker 1 |
| `versions/v2-paper-cutout.html` | version worker 2 |
| `versions/v3-crt-arcade.html` | version worker 3 |
| `versions/v4-orchestra-pit.html` | version worker 4 |
| `versions/v5-particle-storm.html` | version worker 5 |

Rename the slug part if your visual direction ends up somewhere else, keep the
`vN-` prefix, and update your own row in the table on `index.html`.

## createRig

```js
createRig(container: Element, opts?: {
  pose?:      Partial<Record<JointName, number>>, // degrees, merged over NEUTRAL_POSE
  scale?:     number,   // initial uniform scale, default 1
  clamp?:     boolean,  // clamp angles to JOINT_LIMITS, default true
  baton?:     boolean,  // draw the conductor baton, default true
  shadow?:    boolean,  // draw the ground shadow ellipse, default true
  replace?:   boolean,  // empty the container first, default true
  className?: string,   // extra class on the <svg>
  title?:     string,   // accessible name, default 'AO mascot'
}) => RigHandle
```

```ts
RigHandle = {
  svg: SVGSVGElement,            // the mounted <svg>
  element: SVGSVGElement,        // alias of svg
  parts: Record<JointName, SVGGElement>,
  joints: JointName[],           // === JOINTS
  pivots: typeof JOINT_PIVOTS,
  limits: typeof JOINT_LIMITS,

  setPose(pose: Partial<Record<JointName, number>>): RigHandle, // degrees, merges
  getPose(): Record<JointName, number>,
  reset(): RigHandle,            // NEUTRAL_POSE + identity body transform

  scale(sx: number, sy?: number): RigHandle,   // about the foot line, sy defaults to sx
  translate(x: number, y: number): RigHandle,  // viewBox user units
  squash(k: number): RigHandle,                // -1..1, + squashes, - stretches

  destroy(): void,
}
```

Every method returns the handle, so calls chain. `setPose` merges: omitted
joints keep their angle, unknown keys and non-finite numbers are ignored, and
values outside `JOINT_LIMITS` are clamped unless you passed `clamp: false`.

`scale`, `translate` and `squash` are the torso-level transforms: they act on
the whole body around the centre of the foot line (`x: 164, y: 312` in viewBox
units), so a squash reads as weight on the feet rather than a shrink in place.
They are independent of `setPose` and of each other; each call replaces the
previous value for that one transform.

The canvas is `viewBox="0 0 400 360"`. The `<svg>` is `width: 100%` with
`height: auto`, so size the rig by sizing its container.

### Joints

Rotation is in degrees and **positive is always clockwise on screen** (plain SVG
`rotate`). The character faces right, which is the side the baton arm is on.

| Joint | Pivot (x, y) | Positive rotation does | Sane range | Neutral |
| --- | --- | --- | --- | --- |
| `torso` | 164, 258 (hip line) | leans the whole upper body right, toward the baton | -25 .. 25 | 0 |
| `head` | 164, 139 (neck) | tips the top of the head right | -30 .. 30 | 0 |
| `armL_upper` | 82, 165 (left shoulder) | raises the left arm (-90 points it straight down) | -70 .. 140 | 0 |
| `armL_lower` | 46, 165 (left elbow) | folds the left forearm up | -30 .. 130 | 0 |
| `armR_upper` | 246, 165 (right shoulder) | lowers the baton arm (negative raises it) | -140 .. 70 | -18 |
| `armR_lower` | 286, 165 (right elbow) | lowers the baton forearm (negative raises it) | -130 .. 30 | -42 |
| `legL_upper` | 116, 258 (rear hip) | swings the rear leg backwards (negative = forward) | -55 .. 55 | 0 |
| `legL_lower` | 116, 285 (rear knee) | bends the knee, heel towards the back | -10 .. 70 | 0 |
| `legR_upper` | 212, 258 (front hip) | swings the front leg backwards (negative = forward) | -55 .. 55 | 0 |
| `legR_lower` | 212, 285 (front knee) | bends the knee, heel towards the back | -10 .. 70 | 0 |

Notes that matter when choreographing:

- The hierarchy is `root > { legL_upper, legR_upper, torso }`, and
  `torso > { armL_upper, head, armR_upper }`, with each `*_lower` nested inside
  its `*_upper`. So rotating `torso` moves the arms and head but leaves the feet
  planted, and rotating `armR_upper` carries the forearm and baton with it.
- `legL` is the rear pair of legs and `legR` the front pair. Each pair swings
  around one hip axle, which is how the four stubby legs of the original logo
  read as two limbs. Counter-rotate the two for a walk or march.
- The neutral pose reproduces the logo silhouette, baton up. `reset()` returns
  to it.
- The whole body is styled through CSS custom properties on `.ao-rig`
  (`--ao-body`, `--ao-body-light`, `--ao-body-shade`, `--ao-outline`, `--ao-eye`,
  `--ao-baton`, `--ao-baton-shade`, `--ao-ground`, `--ao-outline-width`).
  Re-skin per version there instead of touching `rig.css`.

`tools/rig-preview.html` is a slider panel for every joint if you want to find
angles by eye.

## createConsole

```js
createConsole(container: Element, opts?: {
  loopUrl?:    string,  // default '../assets/audio/ao-loop-120bpm.wav'
  loopBpm?:    number,  // BPM the bundled loop was rendered at, default 120
  fftSize?:    number,  // analyser FFT size, default 2048 (=> 1024 bins)
  volume?:     number,  // 0..1, default 0.8
  ui?:         boolean, // build the transport UI, default true
  dropTarget?: boolean, // accept audio files dropped on container, default true
  autoplay?:   boolean, // try to start the loop immediately, default true
  detector?:   Partial<typeof DETECTOR_DEFAULTS>,
}) => ConsoleHandle
```

```ts
ConsoleHandle = {
  element: HTMLElement | null,   // the UI root, null when ui: false
  context: AudioContext,
  analyser: AnalyserNode,        // the smoothed display analyser
  audio: HTMLAudioElement,       // loop/file element source

  subscribe(cb: (f: Features) => void): () => void,  // returns an unsubscribe fn
  unsubscribe(cb): boolean,
  getFeatures(): Features,

  play(): Promise<ConsoleHandle>,
  pause(): ConsoleHandle,
  toggle(): Promise<ConsoleHandle> | ConsoleHandle,
  seek(seconds: number): ConsoleHandle,
  setVolume(v: number): ConsoleHandle,               // 0..1, analysis unaffected
  setSource(src: 'loop' | 'file' | 'mic', fileOrUrl?: File | string): Promise<ConsoleHandle>,
  getState(): { source, playing, duration, volume, status, contextState },

  destroy(): void,
}
```

One `AudioContext`, one analyser pair, one `requestAnimationFrame` loop for the
whole page. Build one console per page and share it.

The UI gives play/pause, a seek slider with elapsed/total time, a volume
slider, a `Loop | File | Mic` source switcher, a live BPM readout, a beat
indicator that flashes on every detected onset, and a bass meter. Dropping an
mp3/wav/ogg on the container switches to it. `File` opens a picker; `Mic` asks
for `getUserMedia` and, if permission is refused, falls back to the loop and
reports it in the status line. The microphone is routed to the analyser only,
never to the speakers.

Browsers block audio before a user gesture. The console retries `resume()` on
the first pointer or key event anywhere in the page, so a version page does not
need its own unlock button.

### Features

`subscribe(cb)` calls `cb(features)` once per animation frame, in registration
order, with the source below. Same object identity every frame: read what you
need during the callback, and copy anything you want to keep.

```ts
Features = {
  time:      number,      // seconds into the loop/file, or seconds since the mic started
  rms:       number,      // 0..1 raw waveform RMS, typically 0.02..0.3 for music
  bass:      number,      // 0..1   20-140 Hz
  lowMid:    number,      // 0..1  140-420 Hz
  mid:       number,      // 0..1  420-2000 Hz
  high:      number,      // 0..1    2-12 kHz
  beat:      boolean,     // true only on the single frame an onset is detected
  beatPhase: number,      // 0..1 smooth, wraps once per beat, 0 on the beat
  bpm:       number,      // current tempo estimate, folded into 60..185
  spectrum:  Uint8Array,  // length fftSize/2 (1024 by default), 0..255 per bin
}
```

- The four band values are normalised per band by a slow-decaying running
  maximum, so a quiet microphone and a loud mp3 both land in 0..1.
- `beat` is real onset detection: spectral flux over the 20-140 Hz bins compared
  against an adaptive threshold (`mean * 1.35 + stddev * 0.9 + floor`) over a
  0.7 s history, with a 0.22 s refractory period. It is not a timer, so it
  follows tempo changes and stops firing in silence.
- `bpm` is the median of recent inter-onset intervals, octave-folded into
  60..185 and smoothed. It starts at `opts.loopBpm` before any beat is detected.
- `beatPhase` free-runs at `bpm` and is pulled back towards 0 on each detected
  beat. Ride phase for anything that should look locked and smooth, and use
  `beat` only for one-frame impulses (an envelope kick, a flash). Driving motion
  straight off `beat` will look jittery.
- `spectrum[i]` covers `i * context.sampleRate / fftSize` Hz.

Unsubscribe with either the returned function or `unsubscribe(cb)`.

## Version page skeleton

Copy-pasteable, 20 lines, drops the mascot on screen dancing to the bundled
loop. Replace the choreography with yours.

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>vN slug</title>
<link rel="stylesheet" href="../src/rig.css" /><link rel="stylesheet" href="../src/console.css" />
<style>body{margin:0;background:#0d1117;color:#c9d4e4;font:13px ui-monospace,monospace}
.wrap{max-width:640px;margin:32px auto;display:grid;gap:16px}</style></head>
<body><div class="wrap"><div id="stage"></div><div id="deck"></div></div>
<script type="module">
import { createRig } from '../src/rig.js';
import { createConsole } from '../src/console.js';
const rig = createRig(document.getElementById('stage'));
const deck = createConsole(document.getElementById('deck'));
let beats = 0, hit = 0;
deck.subscribe((f) => {
  if (f.beat) { beats++; hit = 1; } else { hit = Math.max(0, hit - 0.06); }
  const flow = beats + f.beatPhase, swing = Math.sin(Math.PI * flow);
  rig.setPose({ legL_upper: 24 * swing, legR_upper: -24 * swing, torso: 5 * swing,
    armR_upper: -30 + 22 * Math.sin(2 * Math.PI * f.beatPhase) });
  rig.translate(0, -12 * Math.sin(Math.PI * f.beatPhase)).squash(0.16 * hit + 0.08 * f.bass);
});
</script></body></html>
```

## Bundled loop

`assets/audio/ao-loop-120bpm.wav`: 2 bars of 4-on-the-floor at 120 BPM in A
minor, 4.000 s, mono, 44.1 kHz, kick on every beat, snare on 2 and 4, hats on
eighths, eighth-note bass. Rendered offline from Web Audio primitives by
`tools/loop-generator.js`, so there is no third-party audio in this repo. Re-render
it with `tools/generate-loop.html` (Download button, or `?save=1` when served by
`tools/save-server.py`). The generator is deterministic: the same code renders
the same bytes.
