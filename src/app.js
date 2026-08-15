// AO school disco: one page, two routes (#dj and #party).
//
// The stage, the AudioContext and the animation loop are built exactly once,
// here. Routing only toggles which panel is visible, so switching routes never
// reloads, never re-asks for the microphone and never builds a second console.

import { createRig } from './rig.js';
import { createConsole } from './console.js';
import { createAsciiStage } from './ascii.js';
import { createChoreo } from './choreo.js';
import { createQueueStore, mountQueueUI } from './queue.js';
import { createNowPlaying } from './nowplaying.js';

const ROUTES = ['dj', 'party'];
const $ = (id) => document.getElementById(id);

// -- stage --------------------------------------------------------------------

const stage = $('stage');
const view = createAsciiStage(stage);
const rig = createRig(view.rigHost, {
  headphones: true,
  paws: 'both',
  baton: false,
  shadow: false,
  title: 'AO mascot DJing',
});
const choreo = createChoreo(rig);

// -- audio --------------------------------------------------------------------

// autoplay is off: this demo is supposed to listen to the room, not to fill it.
const deck = createConsole($('deck'), {
  loopUrl: 'assets/audio/ao-loop-120bpm.wav',
  autoplay: false,
});

const micButton = $('mic-enable');
const micStatus = $('mic-status');
const micLevel = $('mic-level');
const micPeak = $('mic-peak');

function setMicStatus(text, tone) {
  micStatus.textContent = text;
  micStatus.dataset.tone = tone;
}

async function enableMic() {
  micButton.disabled = true;
  setMicStatus('Asking the browser for the microphone...', 'wait');
  try {
    await deck.setSource('mic');
    setMicStatus('Listening to the room. Play something on the speakers.', 'ok');
    micButton.textContent = 'Microphone live';
  } catch (error) {
    const denied = /denied|not allowed|permission/i.test(String(error && error.message));
    setMicStatus(
      denied
        ? 'Microphone blocked. Allow it for this page in the browser address bar, then press Retry.'
        : `Microphone unavailable: ${error && error.message ? error.message : error}. ` +
            'You can still drive the demo from the audio source panel below.',
      'error',
    );
    micButton.textContent = 'Retry microphone';
    micButton.disabled = false;
  }
}

micButton.addEventListener('click', enableMic);

// A microphone-free way to tell a broken page from a broken input: this plays
// the bundled loop out of the speakers and feeds the same analysis chain. If he
// dances to this and not to the room, the problem is the microphone.
const demoButton = $('demo-loop');
demoButton.addEventListener('click', async () => {
  try {
    await deck.setSource('loop');
    setMicStatus('Playing the bundled loop through your speakers, not the microphone.', 'ok');
    demoButton.textContent = 'Loop playing';
  } catch (error) {
    setMicStatus(`Could not start the bundled loop: ${error && error.message}`, 'error');
  }
});

// Full screen for the floor to look at. The stage drops its aspect ratio while
// it is full screen and the ASCII grid rebuilds itself from the new size.
const fullButton = $('stage-full');
fullButton.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen().catch((error) => setMicStatus(`Full screen refused: ${error.message}`, 'warn'));
});
document.addEventListener('fullscreenchange', () => {
  fullButton.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
});

// -- controls and diagnosis ----------------------------------------------------

const gainSlider = $('mic-gain');
const gainValue = $('mic-gain-value');
gainSlider.addEventListener('input', () => {
  const value = Number(gainSlider.value);
  deck.setMicGain(value);
  gainValue.textContent = `${value}x`;
});

$('react-all').addEventListener('change', (event) => {
  choreo.setBypass(event.target.checked);
});

// Samples the internals for eight seconds and prints where the chain is
// breaking down. Written to be pasted back to me verbatim.
const reportBox = $('report');
const diagnoseButton = $('diagnose');
let sampling = null;

diagnoseButton.addEventListener('click', () => {
  if (sampling) return;
  sampling = { frames: [], until: performance.now() + 8000 };
  diagnoseButton.disabled = true;
  reportBox.hidden = false;
  reportBox.textContent = 'Listening for 8 seconds. Play music now.';
});

function finishReport() {
  const rows = sampling.frames;
  sampling = null;
  diagnoseButton.disabled = false;
  if (!rows.length) {
    reportBox.textContent = 'No frames captured: the animation loop is not running.';
    return;
  }
  const mean = (fn) => rows.reduce((a, r) => a + fn(r), 0) / rows.length;
  const peak = (fn) => Math.max(...rows.map(fn));
  const onsets = rows.filter((r) => r.beat).length;
  const rms = mean((r) => r.f.rms);
  const music = mean((r) => r.s.music);
  const energy = mean((r) => r.s.energy);
  const d = rows[rows.length - 1].s.detail;

  let verdict;
  if (peak((r) => r.f.rms) < 0.004) {
    verdict = 'FAULT: the microphone is delivering silence. Wrong input device, or muted.';
  } else if (onsets < 6) {
    verdict = `FAULT: only ${onsets} onsets in 8 seconds. It hears sound but finds no beat in it.`;
  } else if (music < 0.35) {
    verdict = 'FAULT: onsets found but they are not regular enough to pass as music. Tick "react to any sound".';
  } else if (energy < 0.25) {
    verdict = 'FAULT: it knows it is music but has no level to move with. Raise input sensitivity.';
  } else {
    verdict = 'OK: it is hearing music and driving the mascot. If he still looks wrong the problem is the motion, not the audio.';
  }

  reportBox.textContent = [
    `source        ${deck.getState().source}   status: ${deck.getState().status}`,
    `mic gain      ${gainSlider.value}x        bypass: ${$('react-all').checked}`,
    `rms           mean ${rms.toFixed(4)}  peak ${peak((r) => r.f.rms).toFixed(4)}`,
    `bands         bass ${mean((r) => r.f.bass).toFixed(2)}  lowMid ${mean((r) => r.f.lowMid).toFixed(2)}  mid ${mean((r) => r.f.mid).toFixed(2)}  high ${mean((r) => r.f.high).toFixed(2)}`,
    `onsets        ${onsets} in 8s   bpm ${rows[rows.length - 1].f.bpm.toFixed(0)}`,
    `pulse         mean ${music.toFixed(2)}  peak ${peak((r) => r.s.music).toFixed(2)}`,
    `  regularity  ${d.regularity.toFixed(2)}   density ${d.density.toFixed(2)}   lowLead ${d.lowLead.toFixed(2)}   pumping ${d.pumping.toFixed(2)}`,
    `energy        ${energy.toFixed(2)}   level ${d.level.toFixed(2)}   autoGainPeak ${d.loudMax.toFixed(3)}   trust ${d.trust.toFixed(2)}`,
    `frames        ${rows.length} in 8s`,
    '',
    verdict,
  ].join('\n');
}

// -- readouts -----------------------------------------------------------------

const bars = {
  bass: $('bar-bass'),
  lowMid: $('bar-lowMid'),
  mid: $('bar-mid'),
  high: $('bar-high'),
};
const readEnergy = $('read-energy');
const readBpm = $('read-bpm');
const readBeats = $('read-beats');
const readState = $('read-state');
const readPulse = $('read-pulse');
const beatDot = $('beat-dot');
const partyState = $('party-state');
const partyLevel = $('party-level');

let beats = 0;
let beatFlash = 0;
let peak = 0;
let lastText = 0;

// camelCase gesture keys read as plain words in the state line, which also
// makes it obvious from the page that he has more than one move.
const GESTURE_WORDS = {
  jogNudge: 'nudging the jog wheel',
  crossfade: 'riding the crossfader',
  eqTweak: 'working the EQ',
  pitchRide: 'trimming the pitch',
  cueNext: 'cueing the next track',
  lookUp: 'looking up at the floor',
  handUp: 'hand in the air',
  bothHandsUp: 'both hands up on the drop',
  fistPump: 'pumping the drop',
  pointCrowd: 'pointing out at the crowd',
  wave: 'waving at the floor',
  palmOut: 'palm out through the build',
  adjustPhones: 'adjusting the headphones',
  checkDeck: 'checking the deck',
  lookAround: 'looking around the room',
};

function stateLabel(s) {
  if (s.gesture && GESTURE_WORDS[s.gesture]) return GESTURE_WORDS[s.gesture];
  if (!s.live && s.quietFor > 0.6) return s.gesture ? 'idle gesture' : 'still, waiting for sound';
  // Loud but arrhythmic is a room, not a track, and he ignores it on purpose.
  if (s.music < 0.25) return s.level > 0.05 ? 'noise, not music: holding still' : 'listening for a beat';
  if (s.kick > 0.3) return `riding the beat at ${s.bpm.toFixed(0)}`;
  if (s.energy > 0.55) return 'full energy';
  if (s.energy > 0.15) return 'working the deck';
  return 'settling';
}

// -- one loop for the page ----------------------------------------------------

let lastFrame = performance.now();
let clock = 0;

deck.subscribe((f) => {
  const nowMs = performance.now();
  const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastFrame) / 1000));
  lastFrame = nowMs;
  clock += dt;

  const state = choreo.update(f, dt, clock);
  view.update(f, state, dt, rig);

  if (f.beat) {
    beats += 1;
    beatFlash = 1;
  } else {
    beatFlash = Math.max(0, beatFlash - dt * 5);
  }

  peak = Math.max(peak * (1 - dt * 0.8), state.level);
  const meter = Math.min(1, state.level * 5);
  micLevel.style.width = `${(meter * 100).toFixed(1)}%`;
  micPeak.style.left = `${(Math.min(1, peak * 5) * 100).toFixed(1)}%`;
  partyLevel.style.width = `${(meter * 100).toFixed(1)}%`;
  beatDot.classList.toggle('is-on', beatFlash > 0.35);

  for (const key in bars) bars[key].style.width = `${(f[key] * 100).toFixed(1)}%`;

  if (sampling) {
    sampling.frames.push({ f: { rms: f.rms, bass: f.bass, lowMid: f.lowMid, mid: f.mid, high: f.high, bpm: f.bpm }, s: state, beat: f.beat });
    if (nowMs > sampling.until) finishReport();
  }

  if (nowMs - lastText > 70) {
    lastText = nowMs;
    const label = stateLabel(state);
    readEnergy.textContent = state.energy.toFixed(2);
    readBpm.textContent = `${f.bpm.toFixed(0)} BPM`;
    readBeats.textContent = String(beats);
    readPulse.textContent = state.music.toFixed(2);
    readState.textContent = label;
    partyState.textContent = label;
  }
});

// -- party queue --------------------------------------------------------------

const store = createQueueStore();
mountQueueUI(store, {
  form: $('request-form'),
  name: $('request-name'),
  song: $('request-song'),
  link: $('request-link'),
  feedback: $('request-feedback'),
  now: $('queue-now'),
  list: $('queue-list'),
  count: $('queue-count'),
  clear: $('queue-clear'),
});

// What is playing, straight from the booth when the API is connected. Until
// then the head of the queue stands in, so the stage reads the same either way
// and nobody has to type the track by hand.
const nowPlaying = createNowPlaying();
const feedStatus = $('feed-status');
let liveTrack = null;


// The stage ticker: what is on and what is coming, readable from the floor on
// both routes.
const queueBadge = $('queue-badge');
const stageNow = $('stage-now');
const stageNext = $('stage-next');

function renderTicker() {
  const pending = store.pending();
  const waiting = pending.length;
  queueBadge.textContent = waiting ? String(waiting) : '';
  queueBadge.hidden = waiting === 0;

  const queued = pending[0];
  // The booth wins when it is reporting: it knows what is actually on the
  // speakers, the queue only knows what was asked for.
  const current = liveTrack
    ? { song: liveTrack.title, name: liveTrack.artist || 'live from the booth', fromApi: true }
    : queued;

  stageNow.textContent = current ? current.song : 'Nothing queued yet';
  if (current) {
    const by = document.createElement('small');
    by.textContent = current.fromApi
      ? current.name
      : `requested by ${current.name}`;
    stageNow.appendChild(by);
  }

  stageNext.textContent = '';
  // With a live track on, nothing in the queue has been played yet, so the
  // whole queue is still up next.
  const upNext = (liveTrack ? pending : pending.slice(1)).slice(0, 3);
  if (!upNext.length) {
    const li = document.createElement('li');
    li.textContent = waiting ? 'nothing else yet' : 'take requests on the party page';
    stageNext.appendChild(li);
  } else {
    for (const row of upNext) {
      const li = document.createElement('li');
      li.textContent = `${row.song} / ${row.name}`;
      stageNext.appendChild(li);
    }
  }
}

nowPlaying.subscribe((track, status) => {
  liveTrack = track && track.playing ? track : null;
  feedStatus.dataset.live = liveTrack ? 'yes' : 'no';
  feedStatus.textContent = nowPlaying.isEnabled()
    ? liveTrack
      ? `Live from the booth: ${liveTrack.title}${liveTrack.artist ? ` - ${liveTrack.artist}` : ''}`
      : `Booth feed connected, ${status}. Showing the queue meanwhile.`
    : 'Now playing is taken from the queue. Connect the booth API in src/nowplaying.js and it will report the live track instead.';
  renderTicker();
});
nowPlaying.start();

store.subscribe(renderTicker);

// Another tab or window on the same laptop stays in sync.
window.addEventListener('storage', (event) => {
  if (event.key === 'ao.disco.queue.v1') location.reload();
});

// -- routing ------------------------------------------------------------------

function currentRoute() {
  const hash = location.hash.replace('#', '');
  return ROUTES.includes(hash) ? hash : 'dj';
}

function applyRoute() {
  const route = currentRoute();
  document.body.dataset.route = route;
  for (const name of ROUTES) {
    const panel = $(`route-${name}`);
    panel.hidden = name !== route;
    const link = document.querySelector(`[data-route-link="${name}"]`);
    link.setAttribute('aria-current', name === route ? 'page' : 'false');
  }
  $('stage-caption').textContent =
    route === 'dj'
      ? 'He is reading the room through the microphone.'
      : 'Same ears, same mascot: the floor can see what the queue is doing.';
}

window.addEventListener('hashchange', applyRoute);
applyRoute();

// Handy for poking at the demo from the console.
window.aoDisco = { rig, deck, store, choreo, view, nowPlaying };
