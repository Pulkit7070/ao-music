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

const SILENCE = 0.003; // RMS below this counts as an empty room

/**
 * Base pose: right hand down on the console working the music, left hand up in
 * the air. The raised hand is placed out to the side rather than straight up so
 * it clears his own head and stays readable against the sky.
 */
const STANCE = {
  torso: 0,
  head: 0,
  // Both hands on the machine. The raised hand is a moment he goes to, not a
  // pose he holds: standing there with an arm in the air all night is the one
  // thing no real DJ does.
  armL_upper: -44,
  armL_lower: 32,
  // Out over the deck rather than tucked down the side: at a steeper shoulder
  // angle the whole arm hugs the torso and the hand disappears into it.
  armR_upper: 18,
  armR_lower: 18,
  legL_upper: 0,
  legL_lower: 0,
  legR_upper: 0,
  legR_lower: 0,
};

/**
 * What a DJ actually does, from watching how the job is described: the hands
 * live on the gear, the constant is nodding to the beat, and a hand in the air
 * is punctuation at a peak rather than a pose you hold all night.
 *
 *   work   nudging the jog wheel, riding the crossfader, a knob, the pitch
 *          fader, and cueing the next track with one cup to the ear. Frequent,
 *          small, both hands stay on the machine.
 *   hype   raised hand, point at the floor, wave, fist pump, palm out into a
 *          build. Occasional, on phrase boundaries and drops.
 *   idle   a quiet room: adjust the cup, check the deck, look around.
 *
 * `pose` may be a function of u, 0..1 through the gesture, for moves that
 * travel. Angles stay inside the range where the arms read as arms: the left
 * arm swings inward above about 70 degrees and lands on his own head, and the
 * right arm does the same past about -75.
 */
const GESTURES = {
  // -- working the gear ------------------------------------------------------
  jogNudge: {
    set: 'work',
    dur: 1.1,
    rise: 0.15,
    fall: 0.3,
    // short pushes on the platter, the way you nudge a track back into time
    pose: (u) => ({
      armR_upper: 24 + 10 * Math.sin(u * Math.PI * 4),
      armR_lower: 20 - 6 * Math.sin(u * Math.PI * 4),
      head: 7,
      torso: 3,
    }),
  },
  crossfade: {
    set: 'work',
    dur: 1.4,
    rise: 0.2,
    fall: 0.3,
    // the left hand travels across the fader and stays there
    pose: (u) => ({ armL_upper: -52 + 26 * u, armL_lower: 34 - 10 * u, head: 5, torso: 2 }),
  },
  eqTweak: {
    set: 'work',
    dur: 1.3,
    rise: 0.25,
    fall: 0.3,
    pose: { armL_upper: -12, armL_lower: 52, head: 9, torso: 4 },
  },
  pitchRide: {
    set: 'work',
    dur: 1.2,
    rise: 0.25,
    fall: 0.3,
    pose: (u) => ({ armR_upper: 30 + 5 * Math.sin(u * Math.PI * 2), armR_lower: 26, head: 6 }),
  },
  cueNext: {
    set: 'work',
    dur: 2.6,
    rise: 0.18,
    fall: 0.2,
    // one cup pressed to the ear while the next track is beatmatched: the most
    // recognisable thing a DJ does
    pose: { armL_upper: 26, armL_lower: 104, head: -5, torso: -2, armR_upper: 26 },
    phones: 6,
  },
  lookUp: {
    set: 'work',
    dur: 1.6,
    rise: 0.3,
    fall: 0.35,
    // head out of the gear and up at the floor
    pose: { head: -12, torso: -7 },
    lift: -3,
  },

  // -- hype, on peaks --------------------------------------------------------
  handUp: {
    set: 'hype',
    dur: 1.7,
    rise: 0.1,
    fall: 0.4,
    pose: (u) => ({
      armL_upper: 66 - 8 * Math.abs(Math.sin(u * Math.PI * 2)),
      armL_lower: 16,
      head: -7,
    }),
    lift: -9,
    stretch: -0.1,
  },
  bothHandsUp: {
    set: 'hype',
    dur: 1.9,
    rise: 0.1,
    fall: 0.4,
    pose: { armL_upper: 66, armL_lower: 18, armR_upper: -62, armR_lower: -22, head: -8 },
    lift: -13,
    stretch: -0.14,
  },
  fistPump: {
    set: 'hype',
    dur: 1.6,
    rise: 0.12,
    fall: 0.3,
    pose: (u) => ({
      armR_upper: -50 - 24 * Math.abs(Math.sin(u * Math.PI * 3)),
      armR_lower: -18,
      head: -5,
    }),
    lift: -5,
  },
  pointCrowd: {
    set: 'hype',
    dur: 1.4,
    rise: 0.18,
    fall: 0.35,
    pose: { armR_upper: -46, armR_lower: 14, torso: 9, head: 11 },
  },
  wave: {
    set: 'hype',
    dur: 1.8,
    rise: 0.15,
    fall: 0.3,
    pose: (u) => ({
      armR_upper: -60,
      armR_lower: -20 + 24 * Math.sin(u * Math.PI * 4),
      head: -4,
    }),
  },
  palmOut: {
    set: 'hype',
    dur: 1.5,
    rise: 0.35,
    fall: 0.2,
    // hand held flat out over the floor through a build, holding the moment
    pose: { armR_upper: -24, armR_lower: 26, torso: -6, head: -9 },
    lift: -4,
  },

  // -- quiet room ------------------------------------------------------------
  adjustPhones: {
    set: 'idle',
    dur: 1.9,
    rise: 0.3,
    fall: 0.35,
    pose: { armL_upper: 24, armL_lower: 104, head: -4, torso: -2 },
    phones: 5,
  },
  checkDeck: {
    set: 'idle',
    dur: 1.5,
    rise: 0.3,
    fall: 0.35,
    pose: { head: 13, torso: 5, armR_upper: 34, armR_lower: 26 },
  },
  lookAround: {
    set: 'idle',
    dur: 2.4,
    rise: 0.3,
    fall: 0.3,
    pose: (u) => ({ head: 16 * Math.sin(u * Math.PI * 2), torso: 3 * Math.sin(u * Math.PI * 2) }),
  },
};

const DROP_MOVES = ['bothHandsUp', 'handUp', 'fistPump'];

const BY_SET = { work: [], hype: [], idle: [] };
for (const key in GESTURES) BY_SET[GESTURES[key].set].push(key);


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
  let bassSm = 0;
  let bassMax = 0;
  let bassSlow = 0;
  let bassAvg = 0;
  let bassSwing = 0;
  let midAvg = 0;
  let midSwing = 0;
  let lastHitAt = -1;
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
  let loudMax = 0.05;
  let music = 0;
  const onsetTimes = [];

  let lastTickAt = -1;
  let lastDropAt = -20; // so the first real drop after page load can still fire
  let nextIdleAt = 6;
  let nextMoveAt = 6;
  let lastBuildAt = -20;
  let beatCount = 0;
  let dropIndex = 0;
  let energyRise = 0;
  let energyWas = 0;

  let bypassGate = false;
  let gesture = null; // { key, t }
  const recent = []; // last few gesture keys, so nothing repeats back to back

  /** Pick from a set, avoiding anything used in the last few turns. */
  function pick(setName) {
    const options = BY_SET[setName].filter((key) => !recent.includes(key));
    const bag = options.length ? options : BY_SET[setName];
    return bag[Math.floor(Math.random() * bag.length)];
  }

  function startGesture(key, now) {
    gesture = { key, t: 0 };
    recent.push(key);
    if (recent.length > 3) recent.shift();
    if (GESTURES[key].set === 'drop') lastDropAt = now;
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

    // How much the low end is actually moving. Music pumps it; a room full of
    // voices does not. This is the one measure of "there is a track playing"
    // that does not depend on the onset detector firing at all, which matters
    // because a small speaker across a room often does not give it enough to
    // work with.
    bassAvg = smooth(bassAvg, bassSm, 1.4, step);
    bassSwing = smooth(bassSwing, Math.abs(bassSm - bassAvg), 0.5, step);
    midAvg = smooth(midAvg, midSm, 1.4, step);
    midSwing = smooth(midSwing, Math.abs(midSm - midAvg), 0.5, step);
    // It only counts if the low end is the thing doing the moving. Voices swing
    // the mid band hard and the low band barely at all, so comparing the two
    // separates a kick drum from a room without depending on absolute levels,
    // which the console has already normalised per band anyway.
    const lowLead = clamp((bassSwing - midSwing * 0.85) / 0.04, 0, 1);
    const pumping = clamp((bassSwing - 0.02) / 0.08, 0, 1) * lowLead;

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
      // Only the most recent onsets: live tempo drifts, and measuring drift
      // across ten seconds reads as incoherence when it is just a human tempo.
      const grid = onsetTimes.slice(-6);
      let error = 0;
      for (const t of grid) {
        const beatsFromStart = (t - grid[0]) / median;
        error += Math.abs(beatsFromStart - Math.round(beatsFromStart));
      }
      const coherence = clamp(1 - error / grid.length / 0.22, 0, 1);
      regularity = 0.45 * (onGrid / gaps.length) + 0.55 * coherence;
    }
    const recent = onsetTimes.filter((t) => now - t < 4).length;
    const density = clamp((recent - 1) / 3, 0, 1);
    // Microphones roll off exactly the band this used to lean on, so the low
    // end is a modifier now, not a gate. The rhythm tests carry the decision.
    const share = bassSm / (bassSm + midSm + 1e-3);
    const lowWeight = clamp((share - 0.14) / 0.3, 0, 1);
    const stale = onsetTimes.length ? clamp(1 - (now - onsetTimes[onsetTimes.length - 1]) / 2.5, 0, 1) : 0;
    // Regularity is the decision, because it is the one thing a room full of
    // people cannot fake: shouting produces plenty of onsets, so density and
    // low end only modulate a score that regularity has already earned.
    const musicTarget = stale * clamp(regularity * (0.45 + 0.55 * density) * (0.8 + 0.2 * lowWeight), 0, 1);
    // Slow either way: a single shout cannot fake a pulse into existence, and a
    // gap between tracks does not kill it instantly.
    music = smooth(music, musicTarget, musicTarget > music ? 1.1 : 2.4, step);
    // The escape hatch: treat any sound as music. Useful when a room, a mic or
    // a genre defeats the pulse test and you would rather he just danced.
    if (bypassGate) music = Math.max(music, 0.9);

    // Auto gain. A phone speaker across a room lands near 0.02 RMS and a hot
    // line feed near 0.2, so a fixed span means the mascot either barely moves
    // or saturates. Normalise against a slowly decaying peak instead, and only
    // above the silence floor, so any microphone at any gain reads as 0..1.
    loudMax = Math.max(loudFast, loudMax * Math.exp(-step / 8), 0.012);
    const live0 = loudFast > SILENCE;
    const level = live0
      ? clamp((loudFast - SILENCE) / Math.max(0.005, 0.72 * loudMax - SILENCE), 0, 1)
      : 0;
    // Loudness only counts once it is loudness with a pulse behind it.
    const drive = level * clamp((Math.max(music, 0.8 * pumping) - 0.22) / 0.3, 0, 1);
    // Energy rises quickly and falls slowly: that is what "sustained loudness"
    // means, as opposed to a single transient.
    energy = smooth(energy, drive, drive > energy ? 0.22 : 1.7, step);

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
    // The console's onset detector runs on 20-140 Hz flux, which a small
    // speaker across a room barely produces. Treat a sharp rise in the low band
    // as a hit too, so the dip still lands when the detector misses one.
    bassSlow = smooth(bassSlow, f.bass, 0.5, step);
    const bassSpike = f.bass > bassSlow * 1.35 + 0.06 && now - lastHitAt > 0.16;
    const hit = f.beat || bassSpike;
    if (hit) lastHitAt = now;
    // The dip has to clear before the next beat arrives, or fast music smears
    // into one long slouch. Tie the release to the tempo, not to a constant.
    const beatSeconds = 60 / clamp(f.bpm, 60, 190);
    kick *= Math.exp(-step / clamp(beatSeconds * 0.32, 0.07, 0.22));
    // Confidence scales the hit rather than switching it on, so a half sure
    // pulse produces a half sized dip instead of a cliff edge.
    const trust = clamp((music - 0.42) / 0.22, 0, 1);
    if (live && hit && trust > 0) {
      kick = Math.max(kick, clamp(0.55 + 0.45 * bassMax, 0, 1) * trust);
    }

    // Confidence that there is an actual pulse in the room right now. Without
    // it the beat-locked sway would free-run on the last tempo estimate through
    // material that has no beat in it at all.
    beatConf = clamp(beatConf * Math.exp(-step / 3) + (f.beat ? 0.5 : 0), 0, 1);

    tick *= Math.exp(-step / 0.09);
    if (live && music > 0.35 && highFast > highSlow * 1.3 + 0.04 && now - lastTickAt > 0.1) {
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
    // Measured on the raw level, not on the normalised energy: the auto gain
    // above deliberately cancels level changes, so a drop is invisible to it.
    loudLag = smooth(loudLag, loudFast, 1.2, step);
    const jumped = loudFast > loudLag * 1.9 + 0.02 && loudFast > SILENCE * 1.8 && music > 0.55;
    if (jumped && now - lastDropAt > 12 && (!gesture || GESTURES[gesture.key].set !== 'hype')) {
      const move = DROP_MOVES[dropIndex % DROP_MOVES.length];
      dropIndex += 1;
      startGesture(move, now);
      flash = 1;
    }

    // A build is energy climbing steadily without a jump. Hold a palm out over
    // the floor through it, the way a DJ marks the moment before a drop.
    energyRise = smooth(energyRise, energy - energyWas, 0.5, step);
    energyWas = energy;
    if (
      !gesture && music > 0.5 && energyRise > 0.0025 && energy > 0.45 &&
      now - lastDropAt > 6 && now - lastBuildAt > 14
    ) {
      lastBuildAt = now;
      startGesture('palmOut', now);
    }

    // Idle gestures only exist when the room is quiet, and never as a cycle.
    if (quietFor > 2.5 && !gesture && now > nextIdleAt) {
      startGesture(pick('idle'), now);
      nextIdleAt = now + 7 + Math.random() * 6;
    }
    if (live) nextIdleAt = Math.max(nextIdleAt, now + 5);

    // Everything else lands on a beat, and the phrase decides what kind of
    // move it is: hype at the top of a sixteen beat phrase when the room is
    // going, working the gear the rest of the time.
    if (hit) beatCount += 1;
    if (music > 0.45 && !gesture && hit && now > nextMoveAt) {
      const onPhrase = beatCount % 16 === 0;
      const hyped = onPhrase && energy > 0.5 && Math.random() < 0.75;
      startGesture(pick(hyped ? 'hype' : 'work'), now);
      nextMoveAt = now + beatSeconds * (hyped ? 12 : 4 + Math.floor(Math.random() * 3) * 2);
    }
    if (!(music > 0.45)) nextMoveAt = Math.max(nextMoveAt, now + 3);

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

    // The raised hand pumps once per beat. It runs off beatPhase so its speed
    // is the tempo, and off `alive` so it keeps going whenever a track is
    // playing, even when the pulse score is only middling.
    const alive = Math.max(music, 0.85 * pumping);
    const pump = Math.sin(2 * Math.PI * f.beatPhase);
    const pumpAmount = alive * (0.35 + 0.65 * energy);

    const target = {
      torso: 7.5 * sway + 13 * dip + 1.2 * breath,
      head: 11 * tickSign * detail + 2.4 * breath - 5 * dip + 5 * halfBar * energy,
      // Raised hand: up and down through the beat, punching a little harder on
      // the hit itself.
      armL_upper: clamp(STANCE.armL_upper + 10 * pump * pumpAmount + 10 * dip, -70, 68),
      armL_lower: STANCE.armL_lower + 10 * Math.max(0, -pump) * pumpAmount + 5 * detail,
      // Working hand: stays down on the console, shoulder drops into the hit,
      // fingers tick with the hats.
      // The working hand pushes down into every hit and jogs the deck between
      // them, so it is doing something visible rather than resting.
      armR_upper: STANCE.armR_upper + 20 * dip + 3 * detail - 7 * groove * energy,
      armR_lower: STANCE.armR_lower - 10 * dip + 8 * tickSign * detail + 6 * halfBar * energy,
      // Legs are visible now, so they take the weight shift, a knee bend on the
      // landing and nothing else. There is no step cycle in here.
      legL_upper: -3 * sway,
      legL_lower: 7 * dip + 2 * Math.max(0, sway),
      legR_upper: 3 * sway,
      legR_lower: 7 * dip + 2 * Math.max(0, -sway),
    };

    // The one thing that never stops while a track is playing: nodding along.
    // Tempo locked, gated by the music score, gone the moment the room is quiet.
    const nod =
      Math.max(0, Math.sin(2 * Math.PI * f.beatPhase)) *
      clamp((alive - 0.42) / 0.22, 0, 1) *
      (0.35 + 0.65 * energy);
    let lift = 18 * dip + 4.5 * nod - 1.5 * breath;
    let squash = 0.34 * dip + 0.08 * bassSm * energy;

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
        const shape = typeof spec.pose === 'function' ? spec.pose(u) : spec.pose;
        for (const joint in shape) {
          target[joint] = target[joint] + (shape[joint] - target[joint]) * weight;
        }
        if (spec.lift) lift += spec.lift * weight;
        if (spec.liftOf) lift += spec.liftOf(u) * weight;
        if (spec.stretch) squash += spec.stretch * weight;
        if (spec.squashOf) squash += spec.squashOf(u) * weight;
        if (spec.phones) phoneNudge = spec.phones * weight;
      }
    }

    // --- apply -------------------------------------------------------------
    for (const joint in target) {
      pose[joint] = smooth(pose[joint], target[joint], 0.024, step);
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
      // Internals, for the diagnostic report on the page.
      detail: { regularity, density, lowLead, pumping, level, loudMax, trust, onsets: onsetTimes.length },
    };
  }

  return {
    update,
    /** Treat any sound as music, bypassing the pulse test. */
    setBypass(value) {
      bypassGate = Boolean(value);
    },
  };
}

export default createChoreo;
