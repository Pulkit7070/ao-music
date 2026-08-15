// Reactive DJ choreography.
//
// There is no dance cycle in here. Every angle is derived from what the console
// actually heard this frame, plus a few short one-shot gestures that fire on
// events (a drop, an idle moment). In silence the envelopes decay to zero and
// the mascot simply stands there.
//
//   kick / low band hit  -> weighted dip, shoulder drop, squash on the landing
//   highs and hats       -> fast head tick and finger detail on the platter
//   sustained loudness   -> one energy envelope scaling the range of everything
//   drop / level jump    -> one-off hand-up gesture, unlike any other motion
//   silence              -> stillness, with an occasional idle gesture
//
// Legs stay near neutral: he is behind a booth and they are not visible.

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

    const level = clamp((loudFast - SILENCE) / LEVEL_SPAN, 0, 1);
    // Energy rises quickly and falls slowly: that is what "sustained loudness"
    // means, as opposed to a single transient.
    energy = smooth(energy, level, level > energy ? 0.35 : 1.7, step);

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
    kick *= Math.exp(-step / 0.13);
    if (live && f.beat) kick = Math.max(kick, clamp(0.55 + 0.45 * bassMax, 0, 1));

    // Confidence that there is an actual pulse in the room right now. Without
    // it the beat-locked sway would free-run on the last tempo estimate through
    // material that has no beat in it at all.
    beatConf = clamp(beatConf * Math.exp(-step / 3) + (f.beat ? 0.5 : 0), 0, 1);

    tick *= Math.exp(-step / 0.09);
    if (live && highFast > highSlow * 1.3 + 0.04 && now - lastTickAt > 0.1) {
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
      loudFast > loudLag * 1.9 + 0.03 && energy > energyLag + 0.2 && energy > 0.45;
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
    // Beat-locked weight shift, and only once the room is genuinely loud.
    const sway =
      Math.sin(2 * Math.PI * f.beatPhase) * clamp((energy - 0.35) / 0.55, 0, 1) * beatConf;

    fader = smooth(fader, energy, 0.45, step);
    crossfade = smooth(crossfade, clamp(0.5 + (highFast - bassSm) * 0.8, 0, 1), 0.6, step);

    const target = {
      torso: 4.5 * sway + 8 * dip + 1.2 * breath,
      head: 9 * tickSign * detail + 2.4 * breath - 3 * dip,
      // Left hand rides the mixer: it follows the fader it is holding.
      armL_upper: STANCE.armL_upper + 13 * fader - 5 * dip,
      armL_lower: STANCE.armL_lower + 9 * fader + 4 * detail,
      // Right hand on the platter: shoulder drops into the hit, fingers tick.
      armR_upper: STANCE.armR_upper + 12 * dip + 2 * detail,
      armR_lower: STANCE.armR_lower - 5 * dip + 10 * tickSign * detail,
      legL_upper: -2 * sway,
      legL_lower: 3 * dip,
      legR_upper: 2 * sway,
      legR_lower: 3 * dip,
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
      // Where the two hands ended up, so the booth can drop a contact shadow.
      handRight: 0.5 + 0.5 * dip,
      handLeft: fader,
    };
  }

  return { update };
}

export default createChoreo;
