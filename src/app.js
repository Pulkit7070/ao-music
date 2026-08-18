// AO disco: one page, two routes (#dj and #party).
//
// The stage, the AudioContext and the animation loop are built exactly once,
// here. Routing only toggles which panel is visible, so switching routes never
// reloads, never re-asks for the microphone and never builds a second console.

import { createRig } from './rig.js';
import { createConsole } from './console.js';
import { createAsciiStage } from './ascii.js';
import { createChoreo } from './choreo.js';
import { createQueueStore, mountQueueUI, resolveQueueUrl } from './queue.js';
import { createNowPlaying } from './nowplaying.js';
import { createPulse } from './pulse.js';
import { createSpotify } from './spotify.js';
import { createPlaylist } from './playlist.js';
import { search as searchLibrary, trending as trendingLibrary } from './library.js';

const ROUTES = ['dj', 'party'];
// Spotify. Create an app at developer.spotify.com, put its Client ID here, and
// register this page's address as a Redirect URI on it. No secret is involved:
// the sign in is Authorization Code with PKCE, which is the flow meant for a
// page with no backend.
const SPOTIFY_CLIENT_ID = '';

/**
 * The requests layer: guests asking a DJ for a song from their phones.
 *
 * Off, because the page can now play the song itself. Asking someone else to
 * put a track on only made sense while the page could not, and once it can, the
 * request is a step between a person and the music rather than a way to reach
 * it. What is left is one person, one page: play something, watch him move.
 *
 * Nothing is deleted. Set this true and the party route, the queue, the request
 * page and the hosted store all come back exactly as they were.
 */
const REQUESTS = false;

// Declared here rather than beside the wiring below, because the render loop
// reads them on its first frame and a `let` is unreachable until its line runs.
const spotify = createSpotify({ clientId: SPOTIFY_CLIENT_ID });
let spotifyState = null;
let booth = null;


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

let localTrack = '';
let localFrom = '';

const micButton = $('mic-enable');
const micStatus = $('mic-status');
const micLevel = $('mic-level');
const micPeak = $('mic-peak');

function setMicStatus(text, tone) {
  micStatus.textContent = text;
  micStatus.dataset.tone = tone;
}

const driving = $('driving');

// The render loop rewrites this line several times a second, which wiped any
// message put here by a click before it could be read. A notice holds the line
// for long enough to read it, and the loop leaves it alone until it expires.
let noticeUntil = 0;

function setDriver(text, tone) {
  if (performance.now() < noticeUntil) return;
  driving.textContent = text;
  driving.dataset.tone = tone || 'idle';
}

/** Say something and make it stay, whatever the loop thinks is going on. */
function setNotice(text, tone, seconds = 20) {
  noticeUntil = 0;
  setDriver(text, tone);
  noticeUntil = performance.now() + seconds * 1000;
}

/** One line, in front of everything else, saying what is moving him and why. */
function describeDriver() {
  const listening = deck.getState().source === 'mic';
  const track = feedTrack();
  const state = deck.getState();
  const playingHere = state.source === 'file' && state.playing;
  if (track && playingHere) {
    // Straight into the analyser, so this is the real beat of the real track:
    // better than the microphone, which also hears the room. Tested by the deck
    // rather than by the label, which used to say "this device" for everything
    // and stopped matching the moment catalogue tracks credited their source.
    setDriver(`Playing ${track.title}. Moving to the track itself.`, 'ok');
  } else if (track && !hearing) {
    setDriver(`Moving to ${track.title}, from ${track.from}. Assumed tempo, nothing is being heard.`, 'ok');
  } else if (listening && hearing) {
    setDriver(track ? `Hearing the room. ${track.title} is on.` : 'Hearing the room.', 'ok');
  } else if (listening) {
    setDriver('Microphone on, waiting for something to hear.', 'idle');
  } else if (spotify.isConnected()) {
    setDriver('Spotify connected. Press play, or turn the microphone on for the real beat.', 'idle');
  } else {
    setDriver('Pick one and he starts.', 'idle');
  }
}

/** Whatever is playing, whichever source says so. */
function feedTrack() {
  if (spotifyState && spotifyState.current) return { ...spotifyState.current, from: 'Spotify' };
  if (booth && booth.current) return { ...booth.current, from: booth.source || 'djay Pro' };
  const state = deck.getState();
  if (state.source === 'file' && state.playing && localTrack) {
    return { title: localTrack, artist: '', from: localFrom || 'this device' };
  }
  return null;
}

/**
 * Write the microphone card.
 *
 * Not textContent: the button holds three spans, and setting text on the button
 * itself deletes all of them and leaves a bare string where the card was.
 */
function setMicCard(name, note, state) {
  micButton.querySelector('.source__name').textContent = name;
  micButton.querySelector('.source__note').textContent = note;
  micButton.dataset.state = state || 'off';
}

async function enableMic() {
  noticeUntil = 0;
  micButton.disabled = true;
  setMicCard('Microphone', 'Asking the browser...', 'off');
  setMicStatus('Asking the browser for the microphone...', 'wait');
  try {
    await deck.setSource('mic');
    setMicStatus('Listening to the room. Play something on the speakers.', 'ok');
    setMicCard('Listening', 'Hearing the room. Click to stop.', 'on');
  } catch (error) {
    const denied = /denied|not allowed|permission/i.test(String(error && error.message));
    setMicStatus(
      denied
        ? 'Microphone blocked. Allow it for this page in the browser address bar, then press Retry.'
        : `Microphone unavailable: ${error && error.message ? error.message : error}. ` +
            'You can still drive the demo from the audio source panel below.',
      'error',
    );
    setMicCard(
      'Retry microphone',
      denied ? 'Blocked. Allow it in the address bar, then click again.' : 'Could not start. Click to try again.',
      'off',
    );
  }
  micButton.disabled = false;
  describeDriver();
}

/**
 * Stop listening. There was no way to do this at all: the microphone stayed
 * open, and the browser's recording indicator with it, until the tab was
 * closed. Turning something on without a way to turn it off is worse when the
 * thing is a microphone.
 */
async function disableMic() {
  micButton.disabled = true;
  await deck.stopListening();
  setMicCard('Microphone', 'He hears the room and moves to the real beat', 'off');
  setMicStatus('Microphone off.', 'idle');
  micButton.disabled = false;
  describeDriver();
  // Whatever was on the deck before is still there, so pick it back up rather
  // than leaving him standing in silence.
  const current = playlist.current();
  if (current) playTrack(current);
}

micButton.addEventListener('click', () => {
  if (deck.getState().source === 'mic') return disableMic();
  return enableMic();
});


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

// Advancing the queue by hand, from the stage itself. The booth does this on
// its own when djay changes track, but with no booth connected, or with djay
// sitting idle between tracks, something has to move the list on, and the
// screen the floor is looking at is where the DJ is standing.
const nextButton = $('stage-advance');

function playNext() {
  const pending = store.pending();
  if (!pending.length) return;
  store.markPlayed(pending[0].id);
}

nextButton.addEventListener('click', playNext);

// N for next, so it works in full screen without hunting for a button. Ignored
// while a guest is typing their request.
window.addEventListener('keydown', (event) => {
  if (!REQUESTS) return;
  if (event.key !== 'n' && event.key !== 'N') return;
  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || event.metaKey || event.ctrlKey || event.altKey) return;
  playNext();
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
  // Nothing is coming in at all. Saying "looking around the room" here reads as
  // normal behaviour when the real answer is that he cannot hear anything.
  if (!drivenByBooth && deck.getState().source !== 'mic' && s.level < 0.004) {
    return 'no input: press Enable microphone';
  }
  if (!drivenByBooth && deck.getState().source === 'mic' && s.level < 0.004 && s.quietFor > 3) {
    return 'microphone on, but hearing nothing';
  }
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

// When the booth says a deck is running but nothing is reaching the microphone,
// the mascot is driven from a generated beat instead of standing through the
// whole set. Real audio always wins: the moment anything arrives at the input,
// this steps aside.
const pulse = createPulse();
const tempoInput = $('assumed-tempo');
let heardBpm = 0;
let hearing = false;
let drivenByBooth = false;

function assumedTempo() {
  const typed = Number(tempoInput.value);
  if (Number.isFinite(typed) && typed >= 60 && typed <= 200) return typed;
  return heardBpm || 120;
}

let lastFrame = performance.now();
let clock = 0;

deck.subscribe((live) => {
  const nowMs = performance.now();
  const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastFrame) / 1000));
  lastFrame = nowMs;
  clock += dt;

  const hearingSomething = live.rms > 0.006;
  hearing = hearingSomething;
  // Either source saying a track is on is enough to move him; the microphone
  // wins whenever it is actually hearing something, because that is the only
  // one of the three that knows where the beat is.
  const feedPlaying = Boolean(feedTrack());
  // The generated pulse exists for a feed that reports a title but carries no
  // audio. A track playing in this page carries its own, straight to the
  // analyser, so guessing a tempo over the top of it would be strictly worse
  // than reading it.
  const deckState = deck.getState();
  const playingHere = deckState.source === 'file' && deckState.playing;
  drivenByBooth = feedPlaying && !hearingSomething && !playingHere;
  if (hearingSomething && live.bpm) heardBpm = live.bpm;
  const f = drivenByBooth ? pulse.tick(dt, assumedTempo()) : live;

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
    const fed = feedTrack();
    const suffix = drivenByBooth
      ? ` (to ${fed ? fed.from : 'the feed'} at ${assumedTempo()} BPM, not listening)`
      : '';
    readState.textContent = label + suffix;
    partyState.textContent = label + suffix;
    describeDriver();
  }
});

// -- party queue --------------------------------------------------------------

// A shared queue when one is configured, so every phone that scans the QR code
// is writing to the same list the booth is reading.
// No shared store to poll when nobody is requesting anything: an empty remote
// keeps the queue in this browser, so the page makes no network calls it has no
// use for.
const store = createQueueStore({ remote: REQUESTS ? resolveQueueUrl() : '' });
const queueUI = mountQueueUI(store, {
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
const boothForm = $('booth-form');
const boothUrlInput = $('booth-url');


// The stage ticker: what is on and what is coming, readable from the floor on
// both routes.
const queueBadge = $('queue-badge');
const stageNow = $('stage-now');
const stageNext = $('stage-next');

function renderTicker() {
  const live = feedTrack();

  // Without the requests layer the ticker has one job: name what is on. There
  // is no queue to stand in for it and nothing to be up next.
  if (!REQUESTS) {
    stageNow.textContent = live ? live.title : 'Nothing playing';
    if (live) {
      const by = document.createElement('small');
      by.textContent = [live.artist, live.remaining].filter(Boolean).join('  ') || live.from;
      stageNow.appendChild(by);
    }
    return;
  }

  const pending = store.pending();
  const waiting = pending.length;
  queueBadge.textContent = waiting ? String(waiting) : '';
  queueBadge.hidden = waiting === 0;

  const queued = pending[0];
  nextButton.disabled = !queued;

  // While the monitor is answering, it is the only thing that says what is
  // playing, including when the answer is nothing. A request is something that
  // was asked for, not something that is on, and showing one as now playing is
  // what made the two panels disagree. The queue only stands in when there is
  // no monitor to ask.
  const onAir = nowPlaying.isReachable() || spotify.isConnected();
  const current = live
    ? { song: live.title, name: [live.artist, live.remaining].filter(Boolean).join('  '), fromApi: true }
    : onAir
      ? null
      : queued;

  stageNow.textContent = current
    ? current.song
    : onAir
      ? 'Nothing playing'
      : 'Nothing queued yet';
  if (current) {
    const by = document.createElement('small');
    by.textContent = current.fromApi ? current.name : `requested by ${current.name}`;
    stageNow.appendChild(by);
  } else if (onAir) {
    const by = document.createElement('small');
    by.textContent = spotify.isConnected() ? 'nothing playing on Spotify' : 'nothing on the decks';
    stageNow.appendChild(by);
  }

  stageNext.textContent = '';
  // The track cued on the other deck is genuinely next, ahead of anything that
  // was merely asked for, so it goes first and says where it came from.
  const cued = booth && booth.upcoming;
  if (cued) {
    const li = document.createElement('li');
    li.className = 'is-cued';
    li.textContent = `${cued.title}${cued.artist ? ` / ${cued.artist}` : ''} / cued on deck ${cued.deck}`;
    stageNext.appendChild(li);
  }
  // With a live track on, nothing in the queue has been played yet, so the
  // whole queue is still up next.
  const upNext = (live || onAir ? pending : pending.slice(1)).slice(0, cued ? 2 : 3);
  for (const row of upNext) {
    const li = document.createElement('li');
    li.textContent = `${row.song} / ${row.name}`;
    stageNext.appendChild(li);
  }
  if (!cued && !upNext.length) {
    const li = document.createElement('li');
    li.textContent = waiting ? 'nothing else yet' : 'take requests on the party page';
    stageNext.appendChild(li);
  }
}

/** "01:15" -> 75. Anything unparseable is 0. */
function seconds(stamp) {
  const parts = String(stamp || '').replace('-', '').split(':').map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 60 + parts[1];
}

/** Loose title match: case, punctuation and "artist - title" order all vary. */
function sameTrack(a, b) {
  const key = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const x = key(a);
  const y = key(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// Advance the request queue when a track actually finishes. The booth is the
// only thing that knows: it reports which deck is playing and what is on it,
// so a change of track means the last one is done. Marking it played here is
// what keeps the floor's list moving in order without the DJ touching it.
let playing = null; // { title, elapsed } of the booth track we last saw

function advanceQueue(next) {
  if (!REQUESTS) return;
  const finished = playing;
  playing = next ? { title: next.title, elapsed: seconds(next.elapsed) } : null;
  if (!finished || (next && sameTrack(finished.title, next.title))) return;
  // A few seconds of a track is a preview or a mistake, not a play.
  if (finished.elapsed < 20) return;

  const pending = store.pending();
  if (!pending.length) return;

  // Only a track that matches a request consumes one, along with anything the
  // DJ skipped over above it. A set is mostly the DJ's own records, and each of
  // those quietly marking somebody's request played would empty the queue of
  // songs nobody ever heard. When the DJ does play off-list, N moves the queue.
  const index = pending.findIndex((row) => sameTrack(row.song, finished.title));
  if (index === -1) return;
  for (let i = 0; i <= index; i++) store.markPlayed(pending[i].id);
}

nowPlaying.subscribe((state, status) => {
  booth = state;
  advanceQueue(feedTrack());
  queueUI.setLive(feedTrack(), nowPlaying.isReachable() || spotify.isConnected());
  const on = Boolean(state && state.current);
  feedStatus.dataset.live = on ? 'yes' : 'no';
  // Say what the feed is doing in its own words, naming whatever answered
  // rather than assuming djay, and only mention the queue standing in when it
  // actually is: with a feed answering, it is not.
  const app = (state && state.source) || 'djay Pro';
  feedStatus.textContent = !nowPlaying.isEnabled()
    ? 'Booth feed off. Now playing comes from the queue.'
    : on
      ? `${app}: ${state.current.title}${
          state.current.artist ? ` - ${state.current.artist}` : ''
        }${state.current.remaining ? ` (${state.current.remaining})` : ''}`
      : nowPlaying.isReachable()
        ? state && state.running
          ? `${app} is ${state.deckStatus || 'idle'}, nothing playing${
              state.upcoming ? `. Next up ${state.upcoming.title}` : ''
            }`
          : `Feed is up, but ${app} is not running.`
        : `Booth feed at ${nowPlaying.getUrl() || 'no address'}: ${status}. Showing the queue meanwhile.`;
  // Show the address in the field, not just as a placeholder: a feed pointed at
  // the wrong host looks exactly like a feed that is down.
  if (document.activeElement !== boothUrlInput) boothUrlInput.value = nowPlaying.getUrl();
  renderTicker();
});
nowPlaying.start();

boothForm.addEventListener('submit', (event) => {
  event.preventDefault();
  nowPlaying.configure({ url: boothUrlInput.value.trim() });
});

// Ask /api/health directly. Answers what the track feed cannot: is the monitor
// even up, and is djay running behind it.
$('booth-check').addEventListener('click', async () => {
  feedStatus.dataset.live = 'no';
  feedStatus.textContent = 'Checking the monitor...';
  const typed = boothUrlInput.value.trim();
  if (typed) nowPlaying.configure({ url: typed });
  const probe = await nowPlaying.checkHealth();
  feedStatus.dataset.live = probe.ok && probe.djayRunning ? 'yes' : 'no';
  feedStatus.textContent = `Health check: ${probe.note}`;
});

// -- a track off this device --------------------------------------------------
//
// The best beat available and the one with no dependencies: the file is decoded
// in the page and fed straight to the analyser, so onsets land on the actual
// transients rather than on whatever the microphone made of the room. No
// permission prompt, no network, nothing to be blocked.

const trackButton = $('track-open');
const trackFile = $('track-file');

const deckPanel = $('deck-panel');
const playlist = createPlaylist();
const playlistList = $('playlist');
const libraryQuery = $('library-query');
const libraryResults = $('library-results');
const libraryNote = $('library-note');

/** Open the deck and reveal it the first time a source is chosen. */
function openDeck() {
  noticeUntil = 0;
  deckPanel.hidden = false;
  trackButton.dataset.state = 'on';
}

trackButton.addEventListener('click', () => {
  openDeck();
  if (playlist.isEmpty()) trackFile.click();
  else libraryQuery.focus();
});

$('deck-add').addEventListener('click', () => trackFile.click());

trackFile.addEventListener('change', () => {
  const added = playlist.addFiles(trackFile.files);
  // Clear it, or picking the same file twice in a row fires no change event.
  trackFile.value = '';
  if (!added.length) {
    setNotice('Those did not look like audio files.', 'warn', 8);
    return;
  }
  openDeck();
  if (!playlist.current()) playTrack(playlist.playAt(playlist.tracks().length - added.length));
});

// Some catalogue tracks answer with application/octet-stream and nosniff, which
// a media element refuses to treat as audio. Fetching them and relabelling the
// bytes fixes it. Only used when the direct attempt fails, since it has to have
// the whole file before anything is heard.
let rescuedUrl = '';

async function rescue(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`stream ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (rescuedUrl) URL.revokeObjectURL(rescuedUrl);
  rescuedUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
  return rescuedUrl;
}

/** Did the clock move? A stalled element reports neither error nor progress. */
async function isReallyPlaying() {
  const audio = deck.getAudio();
  const started = audio.currentTime;
  await new Promise((resolve) => setTimeout(resolve, 1400));
  return !audio.paused && !audio.error && audio.currentTime > started;
}

/** Put a track on. Local file or catalogue URL, same path from here down. */
async function playTrack(track, depth = 0) {
  if (!track) return;
  // Cleared first: a failure must not leave the screen naming the track that
  // did not play.
  localTrack = '';
  localFrom = '';
  renderTicker();
  const label = track.artist ? `${track.title} - ${track.artist}` : track.title;
  try {
    await deck.setSource('file', track.url);
    // A playlist that loops one track never reaches the next one, unless repeat
    // is on, which is exactly the request to loop this one.
    deck.getAudio().loop = repeatOne;
    await deck.play();
    // A resolved play() is not the same as audio arriving. Catalogue tracks are
    // served by independent nodes and one measured resolving, reporting no
    // error, and then producing silence: the analyser saw a flat spectrum and
    // the mascot stood still while the screen named a track. So confirm the
    // clock actually moved before believing it.
    if (deck.getAudio().error) throw new Error(deck.getAudio().error.message || 'unsupported');
    if (!(await isReallyPlaying())) throw new Error('no audio arrived');
  } catch (error) {
    if (track.local) {
      setNotice(`Could not play ${track.title}: ${error && error.message ? error.message : error}`, 'error');
      return;
    }
    try {
      trackButton.querySelector('.source__note').textContent = `Loading ${track.title}...`;
      await deck.setSource('file', await rescue(track.url));
      deck.getAudio().loop = repeatOne;
      await deck.play();
      if (!(await isReallyPlaying())) throw new Error('no audio arrived');
    } catch (second) {
      // Catalogue tracks are served by a network of independent storage nodes
      // and some of them will not answer a browser, whatever the metadata says:
      // one measured serving 14 MB to curl with a permissive CORS header while
      // the same request from a page failed. Nothing here can fix that node, so
      // the track is marked and the next one starts. A dead link must never be
      // able to stop the music.
      track.unavailable = true;
      renderPlaylist();
      const skipTo = playlist.next();
      if (skipTo && depth < 4) {
        setNotice(`${track.title} would not load. Skipping to ${skipTo.title}.`, 'warn', 8);
        return playTrack(skipTo, depth + 1);
      }
      setNotice(
        `Could not play ${track.title}: ${second && second.message ? second.message : second}`,
        'error',
      );
      return;
    }
  }
  localTrack = label;
  localFrom = track.from || 'this device';
  trackButton.querySelector('.source__name').textContent = 'Playing';
  trackButton.querySelector('.source__note').textContent = localTrack;
  advanceQueue(feedTrack());
  queueUI.setLive(feedTrack(), true);
  describeDriver();
  renderTicker();
  renderPlaylist();
}

// The music keeps going. At a party, silence after the last queued track is the
// failure, not a state to rest in, so running out of playlist tops it up from
// the catalogue instead of stopping: more of whatever was searched for, and what
// is popular when there was no search.
let toppingUp = false;
let searchPage = 0;
let lastQuery = '';

async function topUp() {
  if (toppingUp) return false;
  toppingUp = true;
  try {
    const query = lastQuery.trim();
    let found = [];
    if (query) {
      searchPage += 1;
      found = await searchLibrary(query, { limit: 10, offset: searchPage * 10 });
    }
    // No search, or the search is exhausted: fall back to what is popular, and
    // stop paging so the next run does not ask for page fifty of nothing.
    if (!found.length) {
      searchPage = 0;
      found = await trendingLibrary({ limit: 20 });
    }
    const seen = new Set(playlist.tracks().map((t) => t.id));
    const fresh = found.filter((t) => !seen.has(t.id));
    if (!fresh.length) return false;
    playlist.add(fresh);
    return true;
  } catch (error) {
    setNotice(`Could not find anything else to play: ${error.message}`, 'warn', 10);
    return false;
  } finally {
    toppingUp = false;
  }
}

deck.getAudio().addEventListener('ended', async () => {
  const next = playlist.next();
  if (next) return playTrack(next);

  trackButton.querySelector('.source__note').textContent = 'Finding more music...';
  const more = (await topUp()) ? playlist.next() : null;
  if (more) return playTrack(more);

  localTrack = '';
  localFrom = '';
  trackButton.querySelector('.source__name').textContent = 'Play a track';
  trackButton.querySelector('.source__note').textContent = 'Nothing else to play. Search, or add files.';
  describeDriver();
  renderTicker();
});

// -- searching the catalogue ---------------------------------------------------

let searchRun = 0;
let searchTimer = 0;

libraryQuery.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const text = libraryQuery.value.trim();
  if (!text) {
    libraryResults.hidden = true;
    libraryNote.hidden = true;
    return;
  }
  // Typing is faster than the network: only the last query matters.
  searchTimer = setTimeout(() => runSearch(text), 300);
});

async function runSearch(text) {
  const run = ++searchRun;
  lastQuery = text;
  searchPage = 0;
  libraryNote.hidden = false;
  libraryNote.textContent = `Searching for ${text}...`;
  try {
    const found = await searchLibrary(text, { limit: 12 });
    if (run !== searchRun) return;
    renderResults(found, text);
  } catch (error) {
    if (run !== searchRun) return;
    libraryResults.hidden = true;
    libraryNote.textContent = `Could not reach the catalogue: ${
      error && error.message ? error.message : error
    }. Your own files still work.`;
  }
}

function renderResults(found, text) {
  libraryResults.textContent = '';
  if (!found.length) {
    libraryResults.hidden = true;
    libraryNote.textContent = `Nothing for "${text}" in the open catalogue. Add the file instead.`;
    return;
  }
  libraryNote.hidden = true;
  libraryResults.hidden = false;
  for (const track of found) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'results__name';
    name.textContent = track.artist ? `${track.title} - ${track.artist}` : track.title;
    const len = document.createElement('span');
    len.className = 'results__len';
    len.textContent = track.length;
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'results__add';
    add.textContent = playlist.isEmpty() ? 'Play' : 'Queue';
    add.addEventListener('click', () => {
      const [row] = playlist.add(track);
      if (!playlist.current()) playTrack(playlist.playAt(playlist.tracks().indexOf(row)));
    });
    li.append(artFor(track), name, len, add);
    libraryResults.appendChild(li);
  }
}

/**
 * A thumbnail for a row. Local files have no artwork and some catalogue images
 * are served by a node that will not answer, so the fallback is the same size as
 * the picture: a row must not change height depending on whether an image
 * arrived.
 */
function artFor(track) {
  const placeholder = () => {
    const span = document.createElement('span');
    span.className = 'art art--none';
    span.textContent = '\u266b';
    span.setAttribute('aria-hidden', 'true');
    return span;
  };
  if (!track.art) return placeholder();
  const img = document.createElement('img');
  img.className = 'art';
  img.src = track.art;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('error', () => img.replaceWith(placeholder()), { once: true });
  return img;
}

// -- the playlist --------------------------------------------------------------

function renderPlaylist() {
  const rows = playlist.tracks();
  const playing = playlist.current();
  playlistList.textContent = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'playlist__empty';
    li.textContent = 'Nothing on the deck. Add files, or search above.';
    playlistList.appendChild(li);
    return;
  }
  rows.forEach((track, i) => {
    const li = document.createElement('li');
    if (playing && track.id === playing.id) li.dataset.playing = 'yes';
    if (track.unavailable) li.dataset.dead = 'yes';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'playlist__name';
    name.textContent = track.artist ? `${track.title} - ${track.artist}` : track.title;
    name.addEventListener('click', () => playTrack(playlist.playAt(i)));
    const where = document.createElement('span');
    where.className = 'playlist__from';
    where.textContent = track.unavailable ? 'would not load' : track.from;
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'playlist__drop';
    drop.textContent = 'Remove';
    drop.addEventListener('click', () => playlist.remove(track.id));
    li.append(artFor(track), name, where, drop);
    playlistList.appendChild(li);
  });
}

// -- transport -----------------------------------------------------------------

const tPlay = $('t-play');
const tPlayIcon = $('t-play-icon');
const tPrev = $('t-prev');
const tNext = $('t-next');
const tShuffle = $('t-shuffle');
const tRepeat = $('t-repeat');
const tElapsed = $('t-elapsed');
const tTotal = $('t-total');
const tScrub = $('t-scrub');

const PLAY_PATH = 'M8 5l11 7-11 7z';
const PAUSE_PATH = 'M8 5h3v14H8zM13 5h3v14h-3z';

let repeatOne = false;
// While a finger is on the scrub bar the clock must not fight it back.
let scrubbing = false;

/** Seconds to m:ss, and "0:00" for anything not yet known. */
function stamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function renderTransport() {
  const audio = deck.getAudio();
  const onDeck = deck.getState().source === 'file' && Boolean(playlist.current());
  const playing = onDeck && !audio.paused;

  tPlayIcon.querySelector('path').setAttribute('d', playing ? PAUSE_PATH : PLAY_PATH);
  tPlay.title = playing ? 'Pause (space)' : 'Play (space)';
  // Never disabled: with an empty deck, play means find something and start.
  // Disabling it made the one control everybody reaches for do nothing at all.
  tPlay.disabled = false;
  tPrev.disabled = playlist.isEmpty();
  tNext.disabled = playlist.isEmpty();
  tScrub.disabled = !onDeck || !Number.isFinite(audio.duration) || audio.duration === 0;

  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const at = onDeck ? audio.currentTime : 0;
  tElapsed.textContent = stamp(at);
  tTotal.textContent = stamp(duration);

  const fraction = duration > 0 ? Math.min(1, at / duration) : 0;
  if (!scrubbing) tScrub.value = String(Math.round(fraction * 1000));
  // One element instead of three: the played part is painted into the track.
  const percent = (fraction * 100).toFixed(2);
  tScrub.style.setProperty(
    '--scrub',
    `linear-gradient(to right, var(--text) ${percent}%, #212b38 ${percent}%)`,
  );
}

tPlay.addEventListener('click', async () => {
  const audio = deck.getAudio();
  if (playlist.isEmpty()) {
    // Pressing play should start music. Nothing queued means find some.
    trackButton.querySelector('.source__note').textContent = 'Finding music...';
    if (await topUp()) playTrack(playlist.next());
    return;
  }
  // Nothing chosen yet: the obvious meaning of pressing play is start at the top.
  if (!playlist.current()) return playTrack(playlist.playAt(0));
  if (deck.getState().source !== 'file') return playTrack(playlist.current());
  if (audio.paused) await deck.play().catch(() => {});
  else deck.pause();
  renderTransport();
});

tNext.addEventListener('click', () => {
  const next = playlist.next();
  if (next) playTrack(next);
});

tPrev.addEventListener('click', () => {
  const audio = deck.getAudio();
  // Under three seconds in, back means the previous track; after that it means
  // the start of this one, which is what every player does.
  if (deck.getState().source === 'file' && audio.currentTime > 3) {
    deck.seek(0);
    renderTransport();
    return;
  }
  const previous = playlist.previous();
  if (previous) playTrack(previous);
  else deck.seek(0);
});

tShuffle.addEventListener('click', () => {
  const on = tShuffle.getAttribute('aria-pressed') !== 'true';
  tShuffle.setAttribute('aria-pressed', String(on));
  playlist.setShuffle(on);
});

tRepeat.addEventListener('click', () => {
  repeatOne = !repeatOne;
  tRepeat.setAttribute('aria-pressed', String(repeatOne));
  deck.getAudio().loop = repeatOne;
});

tScrub.addEventListener('pointerdown', () => {
  scrubbing = true;
});
tScrub.addEventListener('input', () => {
  const duration = deck.getAudio().duration;
  if (Number.isFinite(duration) && duration > 0) {
    tElapsed.textContent = stamp((Number(tScrub.value) / 1000) * duration);
  }
});
const endScrub = () => {
  if (!scrubbing) return;
  scrubbing = false;
  const duration = deck.getAudio().duration;
  if (Number.isFinite(duration) && duration > 0) deck.seek((Number(tScrub.value) / 1000) * duration);
  renderTransport();
};
tScrub.addEventListener('pointerup', endScrub);
tScrub.addEventListener('change', endScrub);

// Space is the play/pause key everywhere, but not while a search box has focus.
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
  event.preventDefault();
  tPlay.click();
});

for (const name of ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'ended']) {
  deck.getAudio().addEventListener(name, renderTransport);
}
renderTransport();

playlist.subscribe(renderPlaylist);
playlist.subscribe(renderTransport);
renderPlaylist();

// With requests gone this is the point of the page, not a panel to be found, so
// it is open from the start and the search field is the first thing to hand.
if (!REQUESTS) deckPanel.hidden = false;

// -- spotify ------------------------------------------------------------------

const spotifyButton = $('spotify-connect');

spotify.subscribe((state, status) => {
  spotifyState = state;
  advanceQueue(state && state.current);
  queueUI.setLive(feedTrack(), true);
  spotifyButton.dataset.state = spotify.isConnected() ? 'on' : 'off';
  // Spotify now sits on one line rather than in a card, so its state goes in
  // the line itself.
  spotifyButton.textContent = spotify.isConnected()
    ? status === 'playing' && state && state.current
      ? `Spotify: ${state.current.title}`
      : 'Spotify connected. Press play there.'
    : 'Connect Spotify instead';
  describeDriver();
  renderTicker();
});

spotifyButton.addEventListener('click', () => {
  if (!spotify.isConfigured()) {
    // Deliberately not a to-do. Since February 2026 a new Spotify app is capped
    // at five people, each allowlisted by email in the dashboard, and lifting
    // that needs a registered business with 250,000 monthly users. There is no
    // version of this that works for a room of guests, so the button says why
    // rather than sending anyone off to build something that cannot work.
    setNotice(
      'Spotify cannot work for a party. A new app is limited to five people, each ' +
        'added by email in the dashboard, and removing that limit needs a registered ' +
        'business with 250,000 monthly users. It also stopped giving out tempo in 2024, ' +
        'so it never knew the beat. Use Play a track, or the microphone.',
      'warn',
      30,
    );
    return;
  }
  if (spotify.isConnected()) {
    spotify.disconnect();
    return;
  }
  spotify.connect();
});

// Spotify sends the user back here with a code in the address.
spotify.completeSignIn();

store.subscribe(renderTicker);

// Another tab or window on the same laptop stays in sync.
window.addEventListener('storage', (event) => {
  if (event.key === 'ao.disco.queue.v1') location.reload();
});

// -- routing ------------------------------------------------------------------

function currentRoute() {
  const hash = location.hash.replace('#', '');
  if (!REQUESTS) return 'dj';
  return ROUTES.includes(hash) ? hash : 'dj';
}

function applyRoute() {
  const route = currentRoute();
  document.body.dataset.route = route;
  for (const name of ROUTES) {
    $(`route-${name}`).hidden = name !== route;
    const link = document.querySelector(`[data-route-link="${name}"]`);
    if (link) link.setAttribute('aria-current', name === route ? 'page' : 'false');
  }
  $('stage-caption').textContent =
    route === 'dj'
      ? 'Put something on and he moves to it.'
      : 'Same ears, same mascot: the floor can see what the queue is doing.';
}

// Everything the requests layer owns is hidden in the markup and revealed here,
// so switching REQUESTS back on needs no edit to index.html.
if (REQUESTS) {
  $('routes').hidden = false;
  $('ticker-next-label').hidden = false;
  $('stage-next').hidden = false;
  $('stage-advance').hidden = false;
}

window.addEventListener('hashchange', applyRoute);
applyRoute();

// Handy for poking at the demo from the console.
window.aoDisco = { rig, deck, store, choreo, view, nowPlaying };
