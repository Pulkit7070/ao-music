// Reactive DJ choreography.
//
// There is no dance cycle in here. Every angle is derived from what the console
// actually heard this frame, plus a few short one-shot gestures that fire on
// events (a drop, an idle moment). In silence the envelopes decay to zero and
// the mascot simply stands there.
//
//   music vs a loud room -> nothing moves unless the sound has a steady pulse
//                           and low end, so shouting leaves him standing
//   kick / low band hit  -> weighted dip, shoulder drop, squash on the landing
//   highs and hats       -> fast head tick and finger detail on the platter
//   tempo                -> the groove advances one cycle per beat, so speed
//                           comes from the beat rate rather than the volume
//   sustained loudness   -> one energy envelope scaling the range of everything
//   drop / level jump    -> one-off hand-up gesture, unlike any other motion
//   silence              -> stillness, with an occasional idle gesture
//
// The legs are visible, so they take a weight shift and a knee bend on the
// landing. There is no step cycle anywhere in this file.

const SILENCE = 0.014; // RMS below this counts as an empty room
const LEVEL_SPAN = 0.1; // RMS above SILENCE that maps to full energy

/** Base pose: hands out over the gear, weight settled. */
const STANCE = {
  torso: 0,
  head: 0,
  armL_upper: -66,
  armL_lower: 4,
  armR_upper: 60,
  armR_lower: 18,
  legL_upper: 0,
  legL_lower: 0,
  legR_upper: 0,
  legR_lower: 0,
};

/**
 * One-shot gestures. `pose` is merged over the reactive pose with the gesture
 * weight, so a gesture only overrides the joints it names.
 */
const GESTURES = {
  // The drop reaction. Nothing else in the rig ever throws an arm up.
  handUp: {
    dur: 1.6,
    rise: 0.12,
    fall: 0.45,
    pose: { armR_upper: -116, armR_lower: -30, head: -9, torso: -5 },
    lift: -13,
    stretch: -0.14,
  },
  // Idle: pushes the on-ear cup with the free hand.
  adjust: {
    dur: 1.9,
    rise: 0.3,
    fall: 0.35,
    pose: { armL_upper: 24, armL_lower: 104, head: -4, torso: -2 },
    phones: 5,
  },
  // Idle: glances down at the deck.
  checkDeck: {
    dur: 1.5,
    rise: 0.3,
    fall: 0.35,
    pose: { head: 13, torso: 5, armR_upper: 68, armR_lower: 26 },
  },
};

const IDLE_GESTURES = ['adjust', 'checkDeck', 'adjust', 'checkDeck', 'adjust'];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Exponential approach, framerate independent. */
function smooth(current, target, tau, dt) {
  if (!(tau > 0)) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * @param {object} rig a rig handle from createRig
 * @returns {{ update(features: object, dt: number, now: number): object }}
 */
export function createChoreo(rig) {
  const pose = { ...STANCE };
  const phones = rig.parts.headphones || null;

  let loudFast = 0;
  let loudSlow = 0;
  let loudLag = 0;
  let energyLag = 0;
  let bassSm = 0;
  let bassMax = 0;
  let highFast = 0;
  let highSlow = 0;
  let energy = 0;
  let kick = 0;
  let tick = 0;
  let beatConf = 0;
  let tickSign = 1;
  let quietFor = 0;
  let fader = 0;
  let crossfade = 0.5;
  let flash = 0;

  let midSm = 0;
  let music = 0;
  const onsetTimes = [];

  let lastTickAt = -1;
  let lastDropAt = -20; // so the first real drop after page load can still fire
  let nextIdleAt = 6;
  let idleIndex = 0;

  let gesture = null; // { key, t }

  function startGesture(key, now) {
    gesture = { key, t: 0 };
    if (key === 'handUp') lastDropAt = now;
  }

  function update(f, dt, now) {
    const step = clamp(dt, 1 / 240, 1 / 12);

    // --- listen ------------------------------------------------------------
    loudFast = smooth(loudFast, f.rms, 0.06, step);
    loudSlow = smooth(loudSlow, f.rms, 2.4, step);
    bassSm = smooth(bassSm, f.bass, 0.08, step);
    highFast = smooth(highFast, f.high, 0.04, step);
    highSlow = smooth(highSlow, f.high, 0.7, step);

    midSm = smooth(midSm, f.mid, 0.12, step);

    // --- is this music, or is it just a loud room? --------------------------
    //
    // A shouting crowd is loud, mid-heavy and arrhythmic. Music has a pulse at
    // a steady interval and energy down in the bass. Three tests have to agree
    // before anything moves, so volume alone never drives the mascot:
    //
    //   regularity  the recent onsets are evenly spaced
    //   density     there are enough of them to call it a tempo
    //   lowWeight   the sound has low end, not only voice-band mid
    //
    if (f.beat) {
      onsetTimes.push(now);
      if (onsetTimes.length > 9) onsetTimes.shift();
    }
    const gaps = [];
    for (let i = 1; i < onsetTimes.length; i++) {
      const gap = onsetTimes[i] - onsetTimes[i - 1];
      if (gap > 0.2 && gap < 1.6) gaps.push(gap);
    }
    let regularity = 0;
    if (gaps.length >= 4) {
      // Judge each gap against the median rather than the mean, and accept
      // half and double it: onset detectors legitimately fire on the off-beat
      // and skip the odd kick, and a strict variance test reads that jitter as
      // "not music" even when a 4/4 loop is playing.
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      let onGrid = 0;
      for (const g of gaps) {
        const ratio = g / median;
        if (Math.abs(ratio - 1) < 0.2 || Math.abs(ratio - 2) < 0.25 || Math.abs(ratio - 0.5) < 0.12) {
          onGrid += 1;
        }
      }
      // Then the stronger test: do the onsets sit on one grid? Project every
      // onset onto a beat grid of the median period and measure how far it
      // lands from a whole number of beats. Music lands on the grid; irregular
      // bursts from a room land uniformly between beats, which is what stops a
      // crowd from being mistaken for a track.
      let error = 0;
      for (const t of onsetTimes) {
        const beatsFromStart = (t - onsetTimes[0]) / median;
        error += Math.abs(beatsFromStart - Math.round(beatsFromStart));
      }
      const coherence = clamp(1 - error / onsetTimes.length / 0.18, 0, 1);
      regularity = 0.45 * (onGrid / gaps.length) + 0.55 * coherence;
    }
    const recent = onsetTimes.filter((t) => now - t < 4).length;
    const density = clamp((recent - 2) / 4, 0, 1);
    const share = bassSm / (bassSm + midSm + 1e-3);
    const lowWeight = clamp((share - 0.22) / 0.28, 0, 1);
    const stale = onsetTimes.length ? clamp(1 - (now - onsetTimes[onsetTimes.length - 1]) / 2.5, 0, 1) : 0;
    const musicTarget = regularity * density * stale * (0.35 + 0.65 * lowWeight);
    // Slow either way: a single shout cannot fake a pulse into existence, and a
    // gap between tracks does not kill it instantly.
    music = smooth(music, musicTarget, musicTarget > music ? 1.1 : 2.4, step);

    const level = clamp((loudFast - SILENCE) / LEVEL_SPAN, 0, 1);
    // Loudness only counts once it is loudness with a pulse behind it.
    const drive = level * clamp((music - 0.15) / 0.45, 0, 1);
    // Energy rises quickly and falls slowly: that is what "sustained loudness"
    // means, as opposed to a single transient.
    energy = smooth(energy, drive, drive > energy ? 0.35 : 1.7, step);

    const live = loudFast > SILENCE;
    quietFor = live ? 0 : quietFor + step;
    const still = 1 - energy;

    // --- impulses ----------------------------------------------------------
    // How bassy the room has been lately. The display bands are smoothed, so
    // the instantaneous bass value at the onset frame still lags the transient
    // that caused it: gating the dip on it would swallow most hits. The
    // console's onset detector already runs on the 20-140 Hz flux, so a beat is
    // a low hit by construction, and this only sets how heavy it lands.
    bassMax = Math.max(bassSm, bassMax * Math.exp(-step / 1.5));
    // The dip has to clear before the next beat arrives, or fast music smears
    // into one long slouch. Tie the release to the tempo, not to a constant.
    const beatSeconds = 60 / clamp(f.bpm, 60, 190);
    kick *= Math.exp(-step / clamp(beatSeconds * 0.32, 0.07, 0.22));
    if (live && f.beat && music > 0.45) kick = Math.max(kick, clamp(0.55 + 0.45 * bassMax, 0, 1));

    // Confidence that there is an actual pulse in the room right now. Without
    // it the beat-locked sway would free-run on the last tempo estimate through
    // material that has no beat in it at all.
    beatConf = clamp(beatConf * Math.exp(-step / 3) + (f.beat ? 0.5 : 0), 0, 1);

    tick *= Math.exp(-step / 0.09);
    if (live && music > 0.45 && highFast > highSlow * 1.3 + 0.04 && now - lastTickAt > 0.1) {
      lastTickAt = now;
      tickSign = -tickSign;
      tick = clamp(highFast, 0, 1);
    }

    flash = Math.max(0, flash - step * 1.6);

    // A drop is the room getting suddenly, genuinely louder than it just was.
    // Both tests have to pass: the level has to outrun its own recent history,
    // and the energy envelope has to have climbed. Steady loud music satisfies
    // neither, because the lagging values catch up within a couple of seconds,
    // which is what keeps this a one-off reaction instead of a tic.
    loudLag = smooth(loudLag, loudFast, 1.2, step);
    energyLag = smooth(energyLag, energy, 3, step);
    const jumped =
      loudFast > loudLag * 1.9 + 0.03 && energy > energyLag + 0.2 && energy > 0.45 && music > 0.5;
    if (jumped && now - lastDropAt > 12 && (!gesture || gesture.key !== 'handUp')) {
      startGesture('handUp', now);
      flash = 1;
    }

    // Idle gestures only exist when the room is quiet, and never as a cycle.
    if (quietFor > 2.5 && !gesture && now > nextIdleAt) {
      startGesture(IDLE_GESTURES[idleIndex % IDLE_GESTURES.length], now);
      idleIndex += 1;
      nextIdleAt = now + 6 + (idleIndex % 3) * 2.5;
    }
    if (live) nextIdleAt = Math.max(nextIdleAt, now + 5);

    // --- reactive pose -----------------------------------------------------
    const amp = 0.3 + 0.7 * energy; // sustained loudness widens every range
    const dip = kick * (0.45 + 0.55 * energy);
    const detail = tick * amp;
    const breath = Math.sin(now * 0.9) * still;
    // The groove is the tempo, not the volume: it advances one cycle per beat
    // off beatPhase, so a fast track moves him fast and a slow one moves him
    // slowly at the same loudness. Amplitude is gated by music, so a shout
    // cannot start it.
    const groove = Math.sin(2 * Math.PI * f.beatPhase) * music * beatConf;
    const halfBar = Math.sin(Math.PI * f.beatPhase) * music * beatConf;
    const sway = groove * clamp((energy - 0.2) / 0.5, 0, 1);

    fader = smooth(fader, energy, 0.45, step);
    crossfade = smooth(crossfade, clamp(0.5 + (highFast - bassSm) * 0.8, 0, 1), 0.6, step);

    const target = {
      torso: 5 * sway + 8 * dip + 1.2 * breath,
      head: 9 * tickSign * detail + 2.4 * breath - 3 * dip + 3 * halfBar * energy,
      // Left hand rides the mixer: it follows the fader it is holding, and
      // nudges it on the groove rather than on the level.
      armL_upper: STANCE.armL_upper + 13 * fader - 5 * dip + 6 * groove * energy,
      armL_lower: STANCE.armL_lower + 9 * fader + 4 * detail,
      // Right hand on the platter: shoulder drops into the hit, fingers tick.
      armR_upper: STANCE.armR_upper + 12 * dip + 2 * detail - 5 * groove * energy,
      armR_lower: STANCE.armR_lower - 5 * dip + 10 * tickSign * detail,
      // Legs are visible now, so they take the weight shift, a knee bend on the
      // landing and nothing else. There is no step cycle in here.
      legL_upper: -3 * sway,
      legL_lower: 5 * dip + 2 * Math.max(0, sway),
      legR_upper: 3 * sway,
      legR_lower: 5 * dip + 2 * Math.max(0, -sway),
    };

    let lift = 11 * dip - 1.5 * breath;
    let squash = 0.26 * dip + 0.07 * bassSm * energy;

    // --- gesture overlay ---------------------------------------------------
    let weight = 0;
    let phoneNudge = 0;
    if (gesture) {
      const spec = GESTURES[gesture.key];
      gesture.t += step;
      const u = gesture.t / spec.dur;
      if (u >= 1) {
        gesture = null;
      } else {
        weight =
          u < spec.rise
            ? smoothstep(u / spec.rise)
            : u > 1 - spec.fall
              ? smoothstep((1 - u) / spec.fall)
              : 1;
        for (const joint in spec.pose) {
          target[joint] = target[joint] + (spec.pose[joint] - target[joint]) * weight;
        }
        if (spec.lift) lift += spec.lift * weight;
        if (spec.stretch) squash += spec.stretch * weight;
        if (spec.phones) phoneNudge = spec.phones * weight;
      }
    }

    // --- apply -------------------------------------------------------------
    for (const joint in target) {
      pose[joint] = smooth(pose[joint], target[joint], 0.035, step);
    }
    rig.setPose(pose);
    rig
      .translate(1.5 * sway, lift)
      .squash(clamp(squash, -0.4, 0.5))
      .scale(1 + 0.03 * energy);

    if (phones) {
      phones.setAttribute('transform', `rotate(${phoneNudge.toFixed(2)} 164 112)`);
    }

    return {
      energy,
      level: loudFast,
      kick,
      bass: bassSm,
      high: highFast,
      live,
      quietFor,
      fader,
      crossfade,
      flash,
      gesture: gesture ? gesture.key : null,
      // How much of what it is hearing counts as music, 0..1.
      music,
      bpm: f.bpm,
    };
  }

  return { update };
}

export default createChoreo;
