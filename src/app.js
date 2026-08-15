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
  handsUp: 'both hands up on the drop',
  pointUp: 'pointing at the ceiling',
  fistPump: 'pumping the drop',
  wave: 'waving at the floor',
  crowdPoint: 'pointing out at the crowd',
  workDeck: 'working the deck',
  leanBack: 'leaning back',
  bounce: 'bouncing on the beat',
  rollHands: 'rolling his hands',
  swagger: 'shifting his weight',
  adjust: 'adjusting the headphones',
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
  feedback: $('request-feedback'),
  now: $('queue-now'),
  list: $('queue-list'),
  count: $('queue-count'),
  clear: $('queue-clear'),
});

// The stage ticker: what is on and what is coming, readable from the floor on
// both routes.
const queueBadge = $('queue-badge');
const stageNow = $('stage-now');
const stageNext = $('stage-next');

store.subscribe(() => {
  const pending = store.pending();
  const waiting = pending.length;
  queueBadge.textContent = waiting ? String(waiting) : '';
  queueBadge.hidden = waiting === 0;

  const current = pending[0];
  stageNow.textContent = current ? current.song : 'Nothing queued yet';
  if (current) {
    const by = document.createElement('small');
    by.textContent = `requested by ${current.name}`;
    stageNow.appendChild(by);
  }

  stageNext.textContent = '';
  const upNext = pending.slice(1, 4);
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
});

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
window.aoDisco = { rig, deck, store, choreo, view };
