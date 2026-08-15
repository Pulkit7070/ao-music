// A pulse to dance to when there is nothing to listen to.
//
// djay-monitor reports that a track is playing, its title and how much of it is
// left, but it carries no audio and no tempo. So when the booth says a deck is
// running and the microphone is off or hearing nothing, the mascot is driven
// from a beat generated here instead: he moves while the track is playing and
// stops when it stops.
//
// This is honest about what it is. The microphone gives the real beat of the
// real room; this gives a plausible one at an assumed tempo, which is better
// than a mascot standing still through a whole set. Whenever real audio is
// arriving it wins.
//
// The shape it emits is the console's Features shape, so everything downstream
// cannot tell the difference and needs no special case.

const DEFAULT_BPM = 120;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * @returns {{ tick(dt: number, bpm: number, intensity: number): object, reset(): void }}
 */
export function createPulse() {
  let phase = 0;
  let beats = 0;
  let energy = 0;

  const features = {
    time: 0,
    rms: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    high: 0,
    beat: false,
    beatPhase: 0,
    bpm: DEFAULT_BPM,
    spectrum: new Uint8Array(0),
    synthetic: true,
  };

  return {
    reset() {
      phase = 0;
      beats = 0;
      energy = 0;
    },

    /**
     * @param {number} dt seconds since the last frame
     * @param {number} bpm tempo to run at
     * @param {number} intensity 0..1, how hard the track is going
     */
    tick(dt, bpm, intensity = 0.8) {
      const tempo = clamp(Number(bpm) || DEFAULT_BPM, 60, 200);
      const step = clamp(dt, 1 / 240, 1 / 12);
      // Ease in over a second or so, so he starts moving rather than snapping
      // into full flow the instant a deck starts.
      energy += (clamp(intensity, 0, 1) - energy) * (1 - Math.exp(-step / 0.8));

      const previous = phase;
      phase += (step * tempo) / 60;
      const crossed = phase >= 1;
      if (crossed) {
        phase -= Math.floor(phase);
        beats += 1;
      }

      // A kick on every beat, decaying; hats on the eighths; a bar-length swell
      // so it does not feel like a metronome.
      const sinceBeat = phase * (60 / tempo);
      const kick = Math.exp(-sinceBeat / 0.11);
      const eighth = Math.abs(Math.sin(phase * Math.PI * 2));
      const bar = 0.85 + 0.15 * Math.sin(((beats + phase) / 8) * Math.PI * 2);

      features.time += step;
      features.beat = crossed;
      features.beatPhase = phase;
      features.bpm = tempo;
      features.bass = clamp(kick * energy * bar, 0, 1);
      features.lowMid = clamp((0.35 + 0.4 * kick) * energy * bar, 0, 1);
      features.mid = clamp((0.4 + 0.2 * eighth) * energy * bar, 0, 1);
      features.high = clamp((0.25 + 0.45 * eighth) * energy * bar, 0, 1);
      // Around what a room at a decent volume gives a microphone.
      features.rms = clamp((0.05 + 0.09 * kick) * energy, 0, 1);
      return features;
    },
  };
}

export default createPulse;
