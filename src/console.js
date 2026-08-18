// AO music console.
//
// One AudioContext, one AnalyserNode pair, one requestAnimationFrame loop.
// Sources: the bundled loop in assets/audio/, a local file, or the microphone.
// Every subscriber gets the same per-frame feature object.
//
// Full contract: docs/DEMO_API.md

/** Band edges in Hz. */
export const BANDS = {
  bass: [20, 140],
  lowMid: [140, 420],
  mid: [420, 2000],
  high: [2000, 12000],
};

/** Onset detector tuning. Overridable through opts.detector. */
export const DETECTOR_DEFAULTS = {
  historyFrames: 43, // ~0.7 s of flux history at 60 fps
  meanFactor: 1.35, // adaptive threshold: mean * meanFactor + dev * devFactor
  devFactor: 0.9,
  floor: 4e-4, // absolute floor so silence cannot trigger
  minInterval: 0.22, // refractory period in seconds (max 272 BPM)
  bpmRange: [60, 185], // detected BPM is octave-folded into this range
  phaseLock: 0.5, // 0..1, how hard a beat pulls beatPhase back to 0
};

const SOURCES = ['loop', 'file', 'mic'];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const key in attrs) {
    if (key === 'class') node.className = attrs[key];
    else if (key === 'text') node.textContent = attrs[key];
    else node.setAttribute(key, String(attrs[key]));
  }
  for (const child of children) node.appendChild(child);
  return node;
}

/**
 * Mount the console into `container` and start its animation frame loop.
 *
 * @param {Element} container host element for the UI
 * @param {object} [opts]
 * @param {string} [opts.loopUrl='../assets/audio/ao-loop-120bpm.wav'] bundled loop
 * @param {number} [opts.loopBpm=120] BPM the bundled loop was rendered at
 * @param {number} [opts.fftSize=2048] analyser FFT size, power of two
 * @param {number} [opts.volume=0.8] initial output volume, 0..1
 * @param {boolean} [opts.ui=true] build the transport UI
 * @param {boolean} [opts.dropTarget=true] accept audio files dropped on container
 * @param {number} [opts.micGain=12] makeup gain applied to microphone input
 * @param {object} [opts.detector] overrides for DETECTOR_DEFAULTS
 * @returns {object} console handle
 */
export function createConsole(container, opts = {}) {
  if (!container) throw new Error('createConsole: container is required');

  const loopUrl = opts.loopUrl || '../assets/audio/ao-loop-120bpm.wav';
  const loopBpm = opts.loopBpm || 120;
  const detector = { ...DETECTOR_DEFAULTS, ...(opts.detector || {}) };

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('createConsole: Web Audio is not available');
  const ctx = new AudioCtx();

  // Display analyser: smoothed, drives the spectrum and bands.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = opts.fftSize || 2048;
  analyser.smoothingTimeConstant = 0.6;

  // Detection analyser: unsmoothed, so onsets stay sharp.
  const detectAnalyser = ctx.createAnalyser();
  detectAnalyser.fftSize = analyser.fftSize;
  detectAnalyser.smoothingTimeConstant = 0;

  const bus = ctx.createGain(); // everything that should be analysed
  bus.connect(analyser);
  bus.connect(detectAnalyser);

  // Microphones deliver a signal an order of magnitude quieter than file
  // playback: a room mic sits near 0.005 RMS where a decoded track sits near
  // 0.15. Everything downstream, the onset detector included, then behaves
  // completely differently depending on the source. Makeup gain on the mic
  // input alone puts both in the same range.
  const micGain = ctx.createGain();
  micGain.gain.value = opts.micGain === undefined ? 12 : opts.micGain;
  micGain.connect(bus);

  const output = ctx.createGain(); // only what should be audible
  output.gain.value = clamp(opts.volume === undefined ? 0.8 : opts.volume, 0, 1);
  output.connect(ctx.destination);

  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = 'auto';
  audio.loop = true;
  audio.src = loopUrl;
  const elementSource = ctx.createMediaElementSource(audio);
  elementSource.connect(bus);
  elementSource.connect(output);

  let micStream = null;
  let micSource = null;
  let micStartedAt = 0;
  let source = 'loop';
  let fileName = '';
  let objectUrl = '';
  let statusText = 'bundled loop';

  const bins = analyser.frequencyBinCount;
  const freqDb = new Float32Array(bins);
  const detectDb = new Float32Array(bins);
  const prevMag = new Float32Array(bins);
  const spectrum = new Uint8Array(bins);
  const wave = new Float32Array(analyser.fftSize);
  const binHz = ctx.sampleRate / analyser.fftSize;

  const bandBins = {};
  for (const name in BANDS) {
    const [lo, hi] = BANDS[name];
    bandBins[name] = [
      Math.max(1, Math.floor(lo / binHz)),
      Math.min(bins - 1, Math.ceil(hi / binHz)),
    ];
  }
  const bandNorm = { bass: 0.02, lowMid: 0.02, mid: 0.02, high: 0.02 };

  const fluxHistory = [];
  const intervals = [];
  let lastBeatAt = -1;
  let prevFlux = 0;
  let bpm = loopBpm;
  let beatPhase = 0;
  let lastFrameAt = 0;

  const features = {
    time: 0,
    rms: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    high: 0,
    beat: false,
    beatPhase: 0,
    bpm,
    spectrum,
  };

  const subscribers = new Set();
  let rafId = 0;
  let destroyed = false;

  function bandLevel(name) {
    const [lo, hi] = bandBins[name];
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += Math.pow(10, freqDb[i] / 20);
    const value = sum / (hi - lo + 1);
    // Slow-decaying per-band normaliser: keeps a quiet mic and a hot mp3 in
    // the same 0..1 range without clipping transients.
    bandNorm[name] = Math.max(value, bandNorm[name] * 0.995, 1e-3);
    return clamp(value / bandNorm[name], 0, 1);
  }

  function lowBandFlux() {
    const [lo, hi] = bandBins.bass;
    let flux = 0;
    for (let i = lo; i <= hi; i++) {
      const mag = Math.pow(10, detectDb[i] / 20);
      const rise = mag - prevMag[i];
      if (rise > 0) flux += rise;
      prevMag[i] = mag;
    }
    return flux / (hi - lo + 1);
  }

  function detectBeat(flux, now) {
    let mean = 0;
    for (const v of fluxHistory) mean += v;
    mean = fluxHistory.length ? mean / fluxHistory.length : 0;
    let variance = 0;
    for (const v of fluxHistory) variance += (v - mean) * (v - mean);
    const dev = fluxHistory.length ? Math.sqrt(variance / fluxHistory.length) : 0;
    const threshold = mean * detector.meanFactor + dev * detector.devFactor + detector.floor;

    fluxHistory.push(flux);
    if (fluxHistory.length > detector.historyFrames) fluxHistory.shift();

    const rising = flux > prevFlux;
    const armed = lastBeatAt < 0 || now - lastBeatAt >= detector.minInterval;
    const isBeat = fluxHistory.length > 8 && flux > threshold && rising && armed;
    prevFlux = flux;

    if (!isBeat) return false;
    if (lastBeatAt >= 0) {
      const gap = now - lastBeatAt;
      if (gap > 0.25 && gap < 1.25) {
        intervals.push(gap);
        if (intervals.length > 12) intervals.shift();
      }
    }
    lastBeatAt = now;
    return true;
  }

  function updateBpm() {
    if (intervals.length < 3) return;
    let candidate = 60 / median(intervals);
    const [lo, hi] = detector.bpmRange;
    while (candidate < lo) candidate *= 2;
    while (candidate > hi) candidate /= 2;
    bpm += (candidate - bpm) * 0.2;
  }

  function currentTime() {
    if (source === 'mic') return ctx.currentTime - micStartedAt;
    return audio.currentTime || 0;
  }

  function frame(timestamp) {
    rafId = requestAnimationFrame(frame);
    if (destroyed) return;

    const now = ctx.currentTime;
    const dt = lastFrameAt ? Math.min(0.1, (timestamp - lastFrameAt) / 1000) : 1 / 60;
    lastFrameAt = timestamp;

    analyser.getFloatFrequencyData(freqDb);
    analyser.getByteFrequencyData(spectrum);
    detectAnalyser.getFloatFrequencyData(detectDb);
    analyser.getFloatTimeDomainData(wave);

    let sumSquares = 0;
    for (let i = 0; i < wave.length; i++) sumSquares += wave[i] * wave[i];

    const beat = detectBeat(lowBandFlux(), now);
    if (beat) updateBpm();

    // beatPhase free-runs at the detected tempo and is pulled back to 0 on
    // every onset, so animation can ride phase without per-frame jitter.
    beatPhase += (dt * bpm) / 60;
    if (beatPhase >= 1) beatPhase -= Math.floor(beatPhase);
    if (beat) {
      beatPhase =
        beatPhase < 0.5
          ? beatPhase * (1 - detector.phaseLock)
          : beatPhase + (1 - beatPhase) * detector.phaseLock;
      if (beatPhase >= 1) beatPhase -= 1;
    }

    features.time = currentTime();
    features.rms = clamp(Math.sqrt(sumSquares / wave.length), 0, 1);
    features.bass = bandLevel('bass');
    features.lowMid = bandLevel('lowMid');
    features.mid = bandLevel('mid');
    features.high = bandLevel('high');
    features.beat = beat;
    features.beatPhase = beatPhase;
    features.bpm = bpm;

    for (const cb of subscribers) {
      try {
        cb(features);
      } catch (error) {
        console.error('[ao-console] subscriber threw', error);
      }
    }

    if (ui) ui.render(features, beat);
  }

  // -- sources ---------------------------------------------------------------

  async function stopMic() {
    if (micSource) {
      micSource.disconnect();
      micSource = null;
    }
    if (micStream) {
      for (const track of micStream.getTracks()) track.stop();
      micStream = null;
    }
  }

  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia is not available in this browser');
    }
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    micSource = ctx.createMediaStreamSource(micStream);
    // Analyser only, through the makeup gain: routing the mic to the
    // destination would feed back.
    micSource.connect(micGain);
    micStartedAt = ctx.currentTime;
  }

  function resetDetector() {
    fluxHistory.length = 0;
    intervals.length = 0;
    prevMag.fill(0);
    prevFlux = 0;
    lastBeatAt = -1;
  }

  async function setSource(next, fileOrUrl) {
    if (!SOURCES.includes(next)) throw new Error(`setSource: unknown source "${next}"`);

    if (next !== 'mic') await stopMic();
    if (next !== 'file' && objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = '';
      fileName = '';
    }

    if (next === 'loop') {
      audio.loop = true;
      if (!audio.src.endsWith(loopUrl.split('/').pop())) audio.src = loopUrl;
      statusText = 'bundled loop';
    } else if (next === 'file') {
      if (fileOrUrl instanceof Blob) {
        objectUrl = URL.createObjectURL(fileOrUrl);
        fileName = fileOrUrl.name || 'local file';
        audio.src = objectUrl;
      } else if (typeof fileOrUrl === 'string') {
        fileName = fileOrUrl.split('/').pop();
        audio.src = fileOrUrl;
      }
      audio.loop = true;
      statusText = fileName || 'local file';
    } else {
      audio.pause();
      statusText = 'microphone';
    }

    source = next;
    resetDetector();
    if (next === 'mic') {
      try {
        await ctx.resume();
        await startMic();
      } catch (error) {
        statusText = `microphone blocked: ${error.message}`;
        source = 'loop';
        audio.src = loopUrl;
        if (ui) ui.sync();
        throw error;
      }
    } else {
      await play().catch(() => {});
    }
    if (ui) ui.sync();
    return handle;
  }

  async function play() {
    await ctx.resume();
    if (source === 'mic') return handle;
    await audio.play();
    if (ui) ui.sync();
    return handle;
  }

  function pause() {
    if (source !== 'mic') audio.pause();
    if (ui) ui.sync();
    return handle;
  }

  // -- UI --------------------------------------------------------------------

  function buildUI() {
    const root = h('div', { class: 'ao-console' });

    const playButton = h('button', { class: 'ao-console__play', type: 'button', text: 'Play' });
    const seek = h('input', {
      class: 'ao-console__seek',
      type: 'range',
      min: 0,
      max: 1000,
      value: 0,
      step: 1,
      'aria-label': 'Seek',
    });
    const timeLabel = h('span', { class: 'ao-console__time', text: '0:00 / 0:00' });
    const volume = h('input', {
      class: 'ao-console__volume',
      type: 'range',
      min: 0,
      max: 100,
      value: Math.round(output.gain.value * 100),
      step: 1,
      'aria-label': 'Volume',
    });
    const fileInput = h('input', {
      class: 'ao-console__file',
      type: 'file',
      accept: 'audio/mpeg,audio/wav,audio/ogg,audio/*,.mp3,.wav,.ogg',
    });
    const beatDot = h('span', { class: 'ao-console__beat-dot' });
    const bpmLabel = h('span', { class: 'ao-console__bpm', text: '-- BPM' });
    const status = h('span', { class: 'ao-console__status', text: statusText });
    const meter = h('div', { class: 'ao-console__meter' });
    const meterFill = h('div', { class: 'ao-console__meter-fill' });
    meter.appendChild(meterFill);

    const sourceButtons = {};
    const switcher = h('div', { class: 'ao-console__sources', role: 'group' });
    for (const [key, label] of [
      ['loop', 'Loop'],
      ['file', 'File'],
      ['mic', 'Mic'],
    ]) {
      const button = h('button', {
        class: 'ao-console__source',
        type: 'button',
        text: label,
        'data-source': key,
      });
      button.addEventListener('click', () => {
        if (key === 'file') fileInput.click();
        else setSource(key).catch(() => {});
      });
      switcher.appendChild(button);
      sourceButtons[key] = button;
    }

    playButton.addEventListener('click', () => {
      if (source === 'mic') return;
      if (audio.paused) play().catch(() => {});
      else pause();
    });

    let seeking = false;
    seek.addEventListener('pointerdown', () => {
      seeking = true;
    });
    const commitSeek = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
      }
      seeking = false;
    };
    seek.addEventListener('change', commitSeek);
    seek.addEventListener('pointerup', commitSeek);

    volume.addEventListener('input', () => {
      output.gain.value = Number(volume.value) / 100;
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) setSource('file', file).catch(() => {});
    });

    root.append(
      h('div', { class: 'ao-console__row' }, [playButton, seek, timeLabel]),
      h('div', { class: 'ao-console__row' }, [
        switcher,
        h('label', { class: 'ao-console__vol-label' }, [
          h('span', { text: 'Vol' }),
          volume,
        ]),
      ]),
      h('div', { class: 'ao-console__row ao-console__row--meta' }, [
        h('span', { class: 'ao-console__beat' }, [beatDot, h('span', { text: 'beat' })]),
        bpmLabel,
        meter,
        status,
      ]),
      fileInput,
    );

    let beatFlashUntil = 0;

    return {
      root,
      sync() {
        playButton.textContent = source === 'mic' ? 'Live' : audio.paused ? 'Play' : 'Pause';
        playButton.disabled = source === 'mic';
        seek.disabled = source === 'mic';
        status.textContent = statusText;
        for (const key in sourceButtons) {
          sourceButtons[key].classList.toggle('is-active', key === source);
        }
      },
      render(f, beat) {
        const now = performance.now();
        if (beat) beatFlashUntil = now + 110;
        beatDot.classList.toggle('is-on', now < beatFlashUntil);
        bpmLabel.textContent = `${f.bpm.toFixed(1)} BPM`;
        meterFill.style.width = `${Math.round(clamp(f.bass, 0, 1) * 100)}%`;
        if (source === 'mic') {
          timeLabel.textContent = `live ${formatTime(f.time)}`;
        } else {
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          timeLabel.textContent = `${formatTime(f.time)} / ${formatTime(duration)}`;
          if (!seeking && duration > 0) seek.value = String(Math.round((f.time / duration) * 1000));
        }
      },
    };
  }

  const ui = opts.ui === false ? null : buildUI();
  if (ui) container.appendChild(ui.root);

  audio.addEventListener('play', () => ui && ui.sync());
  audio.addEventListener('pause', () => ui && ui.sync());
  audio.addEventListener('error', () => {
    statusText = `cannot load ${fileName || loopUrl}`;
    if (ui) ui.sync();
  });

  const dropTarget = opts.dropTarget === false ? null : container;
  const onDragOver = (event) => {
    event.preventDefault();
    dropTarget.classList.add('ao-console--dragging');
  };
  const onDragLeave = () => dropTarget.classList.remove('ao-console--dragging');
  const onDrop = (event) => {
    event.preventDefault();
    dropTarget.classList.remove('ao-console--dragging');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) setSource('file', file).catch(() => {});
  };
  if (dropTarget) {
    dropTarget.addEventListener('dragover', onDragOver);
    dropTarget.addEventListener('dragleave', onDragLeave);
    dropTarget.addEventListener('drop', onDrop);
  }

  const handle = {
    /** The console UI root, or null when opts.ui === false. */
    element: ui ? ui.root : null,
    /** Underlying Web Audio pieces, for demos that want their own nodes. */
    context: ctx,
    analyser,
    audio,

    /** Register a per-frame callback. Returns an unsubscribe function. */
    subscribe(cb) {
      if (typeof cb !== 'function') throw new TypeError('subscribe: cb must be a function');
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    /** Remove a previously registered callback. */
    unsubscribe(cb) {
      return subscribers.delete(cb);
    },

    /** The live feature object. Same identity every frame. */
    getFeatures() {
      return features;
    },

    /**
     * Stop listening, without starting anything in its place.
     *
     * setSource('loop') would also release the microphone, but it would begin
     * playing the bundled loop out of the speakers, which is not what anyone
     * means by stop. This leaves silence and drops the recording indicator.
     */
    async stopListening() {
      if (source !== 'mic') return handle;
      await stopMic();
      audio.pause();
      audio.src = loopUrl;
      source = 'loop';
      statusText = 'stopped';
      resetDetector();
      if (ui) ui.sync();
      return handle;
    },

    /**
     * The media element itself, so a playlist can hear "ended" and turn looping
     * off. Deliberately narrow in intent: everything else about transport has a
     * method above, and reaching in here to seek or set a source would bypass
     * the detector reset that setSource does.
     */
    getAudio: () => audio,

    /** Transport and routing state. */
    getState() {
      return {
        source,
        playing: source === 'mic' ? Boolean(micStream) : !audio.paused,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        volume: output.gain.value,
        status: statusText,
        contextState: ctx.state,
      };
    },

    play,
    pause,
    toggle() {
      return audio.paused ? play() : Promise.resolve(pause());
    },

    /** Seek the file/loop source, in seconds. No-op for the microphone. */
    seek(seconds) {
      if (source !== 'mic' && Number.isFinite(seconds)) {
        audio.currentTime = clamp(seconds, 0, Number.isFinite(audio.duration) ? audio.duration : seconds);
      }
      return handle;
    },

    /** Makeup gain on the microphone input. Analysis only, never audible. */
    setMicGain(value) {
      if (Number.isFinite(value)) micGain.gain.value = clamp(value, 0, 64);
      return handle;
    },

    /** Output volume, 0..1. Does not affect analysis. */
    setVolume(value) {
      if (Number.isFinite(value)) output.gain.value = clamp(value, 0, 1);
      return handle;
    },

    /** 'loop' | 'file' | 'mic'. Pass a File or URL as the second argument for 'file'. */
    setSource,

    /** Stop everything and remove the UI. */
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      subscribers.clear();
      stopMic();
      audio.pause();
      audio.removeAttribute('src');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (dropTarget) {
        dropTarget.removeEventListener('dragover', onDragOver);
        dropTarget.removeEventListener('dragleave', onDragLeave);
        dropTarget.removeEventListener('drop', onDrop);
      }
      if (ui) ui.root.remove();
      ctx.close();
    },
  };

  if (ui) ui.sync();
  rafId = requestAnimationFrame(frame);

  // Browsers block audio until a gesture. Try once now (works when the page was
  // opened from a click) and once on the first gesture anywhere on the page.
  const kick = () => {
    ctx.resume().then(() => {
      if (source !== 'mic' && opts.autoplay !== false) audio.play().catch(() => {});
    });
  };
  if (opts.autoplay !== false) kick();
  const onGesture = () => {
    kick();
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
  };
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);

  return handle;
}

export default createConsole;
