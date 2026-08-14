// Bundled-loop generator.
//
// Renders assets/audio/ao-loop-120bpm.wav entirely from Web Audio primitives in
// an OfflineAudioContext: kick, snare, hat and bass, straight 4-on-the-floor.
// Nothing is sampled or downloaded, so the committed file has no licensing
// question attached to it.
//
// Run tools/generate-loop.html from a static server to re-render it.

export const LOOP = {
  bpm: 120,
  bars: 2,
  beatsPerBar: 4,
  sampleRate: 44100,
  channels: 1,
  key: 'A minor',
  fileName: 'ao-loop-120bpm.wav',
};

/** Deterministic PRNG so every render produces a byte-identical file. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBuffer(ctx, seconds, seed) {
  const random = mulberry32(seed);
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return buffer;
}

function env(gainNode, t, peak, attack, decay, floor = 0.0008) {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(floor, t + attack + decay);
  g.setValueAtTime(0, t + attack + decay + 0.001);
}

function kick(ctx, out, t, peak = 1) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(46, t + 0.085);
  const gain = ctx.createGain();
  env(gain, t, peak, 0.004, 0.3);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 0.34);

  // Short click so the kick reads on small speakers.
  const click = ctx.createOscillator();
  click.type = 'triangle';
  click.frequency.setValueAtTime(1100, t);
  const clickGain = ctx.createGain();
  env(clickGain, t, peak * 0.22, 0.001, 0.02);
  click.connect(clickGain).connect(out);
  click.start(t);
  click.stop(t + 0.03);
}

function snare(ctx, out, noise, t, peak = 0.7) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1900;
  band.Q.value = 0.7;
  const gain = ctx.createGain();
  env(gain, t, peak, 0.002, 0.17);
  source.connect(band).connect(gain).connect(out);
  source.start(t, 0, 0.25);

  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(190, t);
  body.frequency.exponentialRampToValueAtTime(150, t + 0.08);
  const bodyGain = ctx.createGain();
  env(bodyGain, t, peak * 0.45, 0.002, 0.09);
  body.connect(bodyGain).connect(out);
  body.start(t);
  body.stop(t + 0.12);
}

function hat(ctx, out, noise, t, peak = 0.25, decay = 0.035) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 8200;
  const gain = ctx.createGain();
  env(gain, t, peak, 0.001, decay);
  source.connect(high).connect(gain).connect(out);
  source.start(t, 0.1, decay + 0.05);
}

function bassNote(ctx, out, t, freq, length, peak = 0.5) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t);
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(freq, t);

  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.Q.value = 6;
  low.frequency.setValueAtTime(1400, t);
  low.frequency.exponentialRampToValueAtTime(320, t + 0.12);

  const gain = ctx.createGain();
  env(gain, t, peak, 0.006, length);
  const subGain = ctx.createGain();
  env(subGain, t, peak * 0.8, 0.006, length);

  osc.connect(low).connect(gain).connect(out);
  sub.connect(subGain).connect(out);
  osc.start(t);
  osc.stop(t + length + 0.05);
  sub.start(t);
  sub.stop(t + length + 0.05);
}

const NOTE = { E1: 41.2, G1: 49.0, A1: 55.0, C2: 65.41, D2: 73.42 };

// Two-bar riff in A minor, one entry per eighth note.
const BASS_PATTERN = [
  'A1', 'A1', null, 'A1', 'A1', null, 'C2', 'C2',
  'A1', 'A1', null, 'A1', 'G1', null, 'E1', 'D2',
];

function softClipCurve(amount = 2.2) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

/**
 * Render the loop offline.
 * @param {object} [options] overrides for LOOP
 * @returns {Promise<AudioBuffer>} exactly `bars` bars long, loop-ready
 */
export async function renderLoop(options = {}) {
  const cfg = { ...LOOP, ...options };
  const beat = 60 / cfg.bpm;
  const bar = beat * cfg.beatsPerBar;
  const duration = bar * cfg.bars;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OfflineCtx(cfg.channels, Math.round(duration * cfg.sampleRate), cfg.sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.82;
  const shaper = ctx.createWaveShaper();
  shaper.curve = softClipCurve();
  const trim = ctx.createGain();
  trim.gain.value = 0.92;
  master.connect(shaper).connect(trim).connect(ctx.destination);

  // Fade the last 6 ms so the loop point cannot click.
  trim.gain.setValueAtTime(0.92, Math.max(0, duration - 0.006));
  trim.gain.linearRampToValueAtTime(0, duration);

  const noise = noiseBuffer(ctx, 0.4, 0x0a0c1234);

  for (let b = 0; b < cfg.bars; b++) {
    const barStart = b * bar;

    // Kick on all four: the 4-on-the-floor pulse the beat detector locks to.
    for (let i = 0; i < cfg.beatsPerBar; i++) {
      kick(ctx, master, barStart + i * beat, i === 0 ? 1 : 0.92);
    }

    // Backbeat snare.
    snare(ctx, master, noise, barStart + beat, 0.62);
    snare(ctx, master, noise, barStart + 3 * beat, 0.68);
    if (b === cfg.bars - 1) snare(ctx, master, noise, barStart + 3.5 * beat, 0.4);

    // Hats on eighths, accented off the beat, with a sixteenth pickup.
    for (let i = 0; i < cfg.beatsPerBar * 2; i++) {
      const offbeat = i % 2 === 1;
      hat(ctx, master, noise, barStart + i * beat * 0.5, offbeat ? 0.3 : 0.16, offbeat ? 0.05 : 0.03);
    }
    hat(ctx, master, noise, barStart + 3.75 * beat, 0.2, 0.03);

    // Bass, one eighth per pattern slot.
    for (let i = 0; i < cfg.beatsPerBar * 2; i++) {
      const name = BASS_PATTERN[(b * cfg.beatsPerBar * 2 + i) % BASS_PATTERN.length];
      if (!name) continue;
      bassNote(ctx, master, barStart + i * beat * 0.5, NOTE[name], beat * 0.42, 0.5);
    }
  }

  return ctx.startRendering();
}

/** Encode an AudioBuffer as a 16-bit PCM WAV. */
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * channels * 2, true);

  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, Math.round(sample * 32767), true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/** Render and encode in one call. */
export async function renderLoopWav(options) {
  return encodeWav(await renderLoop(options));
}
