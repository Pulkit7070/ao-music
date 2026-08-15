// ASCII stage.
//
// The rig is still the real jointed SVG mascot: it is mounted invisibly, posed
// every frame by the choreography, and then read back geometrically. Each of
// its blocks, joints, paws and headphone pieces is transformed into viewBox
// space with getCTM() and stamped into a character grid, which is painted to a
// canvas. So the ASCII is not a picture of the mascot, it is the mascot.
//
// Colour comes from what is playing: the hue follows the spectral balance
// (bass low, highs high), brightness follows energy, and a drop kicks the hue
// sideways. Everything that moves on its own moves at the detected tempo, so
// fast music is fast, slow music is slow, and silence is nearly still.

const RAMP = ' .:-=+*#%@';
const BOOTH_RAMP = ' .`,:;i!+*';

// Kinds, in paint order. Higher kinds draw over lower ones. The gear is below
// the mascot on purpose: nothing may cover his hands or his legs.
const NONE = 0;
const ACCENT = 1;
const BOOTH = 2;
const MASCOT = 3;

const GLYPH_ASPECT = 0.58; // width / height of a monospace character cell

const VIEW_W = 400;
const VIEW_H = 360;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Mount the ASCII stage. Returns `rigHost`, an invisible but laid-out host the
 * caller mounts the rig into, and the per-frame `update`.
 *
 * @param {Element} container the stage element
 */
export function createAsciiStage(container) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ascii';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'AO mascot DJing, drawn in ASCII');
  container.appendChild(canvas);

  // The rig lives here: laid out (so getCTM works) but never painted.
  const rigHost = document.createElement('div');
  rigHost.className = 'ascii__rig-host';
  container.appendChild(rigHost);

  const ctx2d = canvas.getContext('2d');

  let cols = 0;
  let rows = 0;
  let cellW = 0;
  let cellH = 0;
  // Projection from rig viewBox units to canvas pixels: uniform scale, framed
  // on the mascot rather than on the whole viewBox, so he reads big. The room
  // and the booth are free to use coordinates outside the viewBox, which is how
  // they reach the edges of a wider stage.
  let scale = 1;
  let offX = 0;
  let offY = 0;
  let worldLeft = 0;
  let worldRight = VIEW_W;
  const FRAME = { cx: 178, top: 40, bottom: 348 };
  let density = new Float32Array(0);
  let kind = new Uint8Array(0);
  let noise = new Float32Array(0);
  let shapes = null; // cached rig element list

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    // A monospace glyph is about 0.58 as wide as it is tall, so the row count
    // has to follow from the column count that way round, or the grid samples
    // the mascot anisotropically and he never resolves.
    cols = clamp(Math.round(w / 6.5), 60, 190);
    rows = Math.max(20, Math.round((GLYPH_ASPECT * h * cols) / w));
    cellW = canvas.width / cols;
    cellH = canvas.height / rows;

    scale = canvas.height / (FRAME.bottom - FRAME.top);
    offX = canvas.width / 2 - FRAME.cx * scale;
    offY = -FRAME.top * scale;
    worldLeft = -offX / scale;
    worldRight = (canvas.width - offX) / scale;

    density = new Float32Array(cols * rows);
    kind = new Uint8Array(cols * rows);
    if (noise.length !== cols * rows) {
      noise = new Float32Array(cols * rows);
      // Stable per-cell jitter so the glyph texture does not crawl.
      let seed = 1337;
      for (let i = 0; i < noise.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        noise[i] = (seed % 1000) / 1000;
      }
    }
    ctx2d.textBaseline = 'top';
    const fontSize = Math.min(cellH, cellW / GLYPH_ASPECT) * 1.02;
    ctx2d.font = `${fontSize.toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // -- grid stamping ---------------------------------------------------------

  const gx = (x) => (offX + x * scale) / cellW;
  const gy = (y) => (offY + y * scale) / cellH;
  const vx = (i) => ((i + 0.5) * cellW - offX) / scale;
  const vy = (j) => ((j + 0.5) * cellH - offY) / scale;

  function put(i, j, d, k) {
    if (i < 0 || j < 0 || i >= cols || j >= rows) return;
    const idx = j * cols + i;
    if (k >= kind[idx]) {
      kind[idx] = k;
      density[idx] = d;
    }
  }

  /** Fill a convex quad given as four {x, y} points in viewBox units. */
  function stampQuad(p, d, k) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of p) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const i0 = Math.max(0, Math.floor(gx(minX)));
    const i1 = Math.min(cols - 1, Math.ceil(gx(maxX)));
    const j0 = Math.max(0, Math.floor(gy(minY)));
    const j1 = Math.min(rows - 1, Math.ceil(gy(maxY)));
    for (let j = j0; j <= j1; j++) {
      const y = vy(j);
      for (let i = i0; i <= i1; i++) {
        const x = vx(i);
        let inside = true;
        let sign = 0;
        for (let e = 0; e < 4; e++) {
          const a = p[e];
          const b = p[(e + 1) % 4];
          const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
          if (cross === 0) continue;
          const s = cross > 0 ? 1 : -1;
          if (sign === 0) sign = s;
          else if (s !== sign) { inside = false; break; }
        }
        if (inside) put(i, j, d, k);
      }
    }
  }

  function stampDisc(cx, cy, r, d, k) {
    const i0 = Math.max(0, Math.floor(gx(cx - r)));
    const i1 = Math.min(cols - 1, Math.ceil(gx(cx + r)));
    const j0 = Math.max(0, Math.floor(gy(cy - r)));
    const j1 = Math.min(rows - 1, Math.ceil(gy(cy + r)));
    const rr = r * r;
    for (let j = j0; j <= j1; j++) {
      const dy = vy(j) - cy;
      for (let i = i0; i <= i1; i++) {
        const dx = vx(i) - cx;
        if (dx * dx + dy * dy <= rr) put(i, j, d, k);
      }
    }
  }

  function stampLine(x0, y0, x1, y1, thickness, d, k) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      stampDisc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness, d, k);
    }
  }

  function stampEllipseRing(cx, cy, rx, ry, thickness, d, k) {
    const steps = Math.max(24, Math.round(rx));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      stampDisc(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, thickness, d, k);
    }
  }

  // -- reading the rig -------------------------------------------------------

  // A character drawn as a solid mass reads as a blob. What makes ASCII art
  // legible is a bright edge around a sparse interior, so the rig's outlines
  // are stamped as strokes over a thin fill, and the eyes stay solid because
  // they are the most recognisable thing about this mascot.
  function collectShapes(svg) {
    const list = [];
    for (const el of svg.querySelectorAll('rect, circle, path')) {
      const cls = el.getAttribute('class') || '';
      if (cls.includes('ao-rig__ground')) continue;
      // The interior light and shade patches would print as hard rectangles
      // inside the silhouette.
      if (cls.includes('ao-rig__light') || cls.includes('ao-rig__shade')) continue;
      const tag = el.tagName.toLowerCase();
      let role = 'fill';
      let weight = 0.42;
      // The far pair of legs reads as depth, like the four stubby legs in the
      // logo, so it is drawn lighter rather than dropped.
      const far = Boolean(el.closest('[data-leg="far"]'));
      if (far) weight = 0.26;
      if (cls.includes('ao-rig__outline')) {
        role = 'edge';
        weight = far ? 0.62 : 1;
      } else if (cls.includes('ao-rig__eye')) {
        role = 'eye';
        weight = 1;
      } else if (cls.includes('ao-rig__paw')) {
        // The hands are what make the pose readable, so they print solid.
        weight = far ? 0.4 : 0.85;
      } else if (cls.includes('phones-shell')) {
        weight = 0.9;
      } else if (cls.includes('phones-pad')) {
        weight = 0.55;
      } else if (cls.includes('phones-band')) {
        role = 'stroke';
        weight = 0.95;
      }
      list.push({ el, tag, role, weight });
    }
    return list;
  }

  function stampRig(svg) {
    if (!shapes) shapes = collectShapes(svg);
    // getCTM() lands in the svg viewport's CSS pixels, which include the
    // viewBox fit. Composing with the inverse of the root matrix puts every
    // shape back into the 400x360 design space the booth and room use.
    const rootCTM = svg.getCTM();
    if (!rootCTM) return;
    const toViewBox = rootCTM.inverse();
    for (const shape of shapes) {
      const raw = shape.el.getCTM();
      if (!raw) continue;
      const m = toViewBox.multiply(raw);
      const to = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
      const scaleOf = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;

      if (shape.tag === 'rect') {
        const x = Number(shape.el.getAttribute('x'));
        const y = Number(shape.el.getAttribute('y'));
        const w = Number(shape.el.getAttribute('width'));
        const h = Number(shape.el.getAttribute('height'));
        if (!(w > 0) || !(h > 0)) continue;
        const c = [to(x, y), to(x + w, y), to(x + w, y + h), to(x, y + h)];
        if (shape.role === 'eye') {
          // Clear a margin around the eye, then fill it solid: without the gap
          // the eye merges into the dither and he loses his face.
          const g = 7;
          stampQuad(
            [to(x - g, y - g), to(x + w + g, y - g), to(x + w + g, y + h + g), to(x - g, y + h + g)],
            0.02,
            MASCOT,
          );
          stampQuad(c, shape.weight, MASCOT);
        } else if (shape.role === 'edge') {
          for (let e = 0; e < 4; e++) {
            const a = c[e];
            const b = c[(e + 1) % 4];
            stampLine(a.x, a.y, b.x, b.y, 1.7 * scaleOf, shape.weight, MASCOT);
          }
        } else {
          stampQuad(c, shape.weight, MASCOT);
        }
      } else if (shape.tag === 'circle') {
        const c = to(Number(shape.el.getAttribute('cx')), Number(shape.el.getAttribute('cy')));
        stampDisc(c.x, c.y, Number(shape.el.getAttribute('r')) * scaleOf, shape.weight, MASCOT);
      } else if (shape.tag === 'path') {
        // Stroked paths: the headphone band, and the outlines of the blocks
        // that drop one edge so head and torso read as one body.
        const len = shape.el.getTotalLength();
        if (!len) continue;
        const stroke = (parseFloat(getComputedStyle(shape.el).strokeWidth) || 4) / 2;
        const steps = Math.max(12, Math.round(len / 3));
        for (let s = 0; s <= steps; s++) {
          const pt = shape.el.getPointAtLength((s / steps) * len);
          const p = to(pt.x, pt.y);
          stampDisc(p.x, p.y, Math.max(1.1, stroke) * scaleOf, shape.weight, MASCOT);
        }
      }
    }
  }

  // -- the booth -------------------------------------------------------------

  let platterAngle = 0;

  function stampBooth(s, dt, tempo) {
    // The gear stands either side of him rather than in front, so the whole
    // logo silhouette stays visible: both hands, all four legs, the tail stub.

    // Deck on his right, under the hand that rides the platter. It turns at the
    // tempo he is hearing, so the speed on screen is the speed of the track.
    platterAngle += dt * (0.5 + 5.5 * s.energy) * tempo;
    const px = 318;
    const py = 236;
    stampEllipseRing(px, py, 40, 17, 2.2, 0.8, BOOTH);
    stampEllipseRing(px, py, 14, 6, 1.8, 0.65 + 0.35 * s.kick, BOOTH);
    const a = platterAngle;
    stampLine(
      px + Math.cos(a) * 14, py + Math.sin(a) * 6,
      px + Math.cos(a) * 38, py + Math.sin(a) * 16,
      1.8, 1, BOOTH,
    );
    stampLine(278, 254, 358, 254, 1.4, 0.5, BOOTH);

    // Mixer on his left: two channel faders and a crossfader, on the values his
    // left hand is riding.
    stampLine(22, 202, 22, 244, 1.5, 0.45, BOOTH);
    stampLine(42, 202, 42, 244, 1.5, 0.45, BOOTH);
    stampLine(15, 242 - 38 * s.fader, 29, 242 - 38 * s.fader, 2.2, 1, BOOTH);
    const chB = clamp(s.bass * s.energy + 0.08, 0, 1);
    stampLine(35, 242 - 38 * chB, 49, 242 - 38 * chB, 2.2, 1, BOOTH);
    stampLine(12, 254, 74, 254, 1.4, 0.45, BOOTH);
    const cf = 12 + 56 * s.crossfade;
    stampLine(cf, 249, cf, 259, 2, 1, BOOTH);

    // Floor: one line under his feet, and nothing else down there.
    for (let i = 0; i < cols; i++) {
      const x = vx(i);
      const n = noise[(Math.floor(gy(318)) * cols + i) % noise.length];
      if (x > 60 && x < 290 ? true : n < 0.7) put(i, Math.round(gy(318)), 0.55 + 0.3 * s.energy, BOOTH);
    }
  }

  // -- room accents ----------------------------------------------------------

  let ballAngle = 0;
  let sweep = 0;

  function stampRoom(s, f, dt, tempo, beatFlash) {
    // Mirror ball: a ring of glints that turns at the tempo.
    ballAngle += dt * (0.25 + 2.2 * s.energy) * tempo;
    const bx = 200;
    const by = 46;
    stampDisc(bx, by, 6 + 3 * s.kick, 0.9 + 0.3 * beatFlash, ACCENT);
    const glints = 10;
    for (let i = 0; i < glints; i++) {
      const a = ballAngle + (i / glints) * Math.PI * 2;
      const r = 13 + 5 * Math.sin(a * 2 + ballAngle);
      stampDisc(bx + Math.cos(a) * r, by + Math.sin(a) * r * 0.8, 0.5 + 0.5 * beatFlash, ACCENT);
    }

    // Beams: sparse dotted rays that sweep faster the busier the room is.
    sweep += dt * (0.15 + 0.75 * s.energy) * tempo;
    const beams = 3;
    for (let b = 0; b < beams; b++) {
      const a = Math.sin(sweep + (b * Math.PI * 2) / beams) * 0.65 + (b - 1) * 0.22;
      const len = 300;
      const steps = 30;
      for (let t = 4; t < steps; t++) {
        const u = t / steps;
        const x = bx + Math.sin(a) * len * u;
        const y = by + Math.cos(a) * len * u;
        if (y > 268 || x < worldLeft || x > worldRight) break;
        // thinning with distance, and only when there is something to light up
        if (noise[(Math.floor(gy(y)) * cols + Math.floor(gx(x)) + t) % noise.length] > 0.35 + 0.5 * u) continue;
        stampDisc(x, y, 1.4, (0.35 + 0.45 * s.energy) * (1 - u * 0.6), ACCENT);
      }
    }

    // Sparks on the beat, thrown around the hall.
    if (f.beat) {
      for (let i = 0; i < 7; i++) {
        const n = noise[(i * 97 + Math.floor(ballAngle * 31)) % noise.length];
        const n2 = noise[(i * 233 + Math.floor(ballAngle * 17)) % noise.length];
        stampDisc(worldLeft + n * (worldRight - worldLeft), 20 + n2 * 220, 1.6, 1, ACCENT);
      }
    }
  }

  // -- painting --------------------------------------------------------------

  function paint(s, f, beatFlash) {
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);

    // Hue follows the balance of the spectrum, so a bass-heavy track sits in
    // the magentas and a bright one climbs towards cyan and yellow.
    const balance = clamp(0.5 + (s.high - s.bass) * 0.9, 0, 1);
    const hue = (200 + balance * 160 + s.hueShift) % 360;
    const lift = 0.35 + 0.65 * s.energy;

    for (let j = 0; j < rows; j++) {
      const y = j * cellH;
      let run = '';
      let runStart = 0;
      let runKey = '';
      const flush = (endIndex) => {
        if (!run) return;
        ctx2d.fillStyle = runKey;
        ctx2d.fillText(run, runStart * cellW, y);
        run = '';
      };
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const k = kind[idx];
        if (k === NONE || density[idx] <= 0) { flush(i); continue; }
        const n = noise[idx];
        let intensity;
        let colour;
        if (k === MASCOT) {
          // Edges print bright and solid; the inside is dithered by the stable
          // per-cell noise, so the body reads as a shaded mass of characters
          // instead of a filled slab.
          const base = density[idx];
          intensity =
            base > 0.8
              ? (0.86 + 0.14 * n) * (0.55 + 0.45 * lift) + beatFlash * 0.16
              : base * lift * (0.3 + 1.25 * n) + s.kick * 0.2 * n + beatFlash * 0.12 * n;
          const rowHue = (hue + (j / rows) * 40) % 360;
          const light = clamp(38 + 44 * intensity + 14 * beatFlash, 20, 92);
          colour = `hsl(${rowHue.toFixed(0)} ${(45 + 45 * s.energy).toFixed(0)}% ${light.toFixed(0)}%)`;
        } else if (k === BOOTH) {
          intensity = density[idx] * (0.5 + 0.5 * lift) + n * 0.1;
          colour = `hsl(${((hue + 180) % 360).toFixed(0)} ${(20 + 30 * s.energy).toFixed(0)}% ${clamp(
            22 + 32 * intensity,
            14,
            70,
          ).toFixed(0)}%)`;
        } else {
          intensity = density[idx] * lift + beatFlash * 0.3;
          colour = `hsl(${((hue + 60) % 360).toFixed(0)} ${(60 + 30 * s.energy).toFixed(0)}% ${clamp(
            40 + 45 * intensity,
            22,
            95,
          ).toFixed(0)}%)`;
        }
        const ramp = k === BOOTH ? BOOTH_RAMP : RAMP;
        const glyph = ramp[clamp(Math.floor(intensity * (ramp.length - 1)), 0, ramp.length - 1)];
        if (glyph === ' ') { flush(i); continue; }
        if (colour !== runKey) {
          flush(i);
          runKey = colour;
          runStart = i;
        }
        if (!run) runStart = i;
        run += glyph;
      }
      flush(cols);
    }
  }

  // -- per frame -------------------------------------------------------------

  let hueShift = 0;
  let beatFlash = 0;

  /**
   * @param {object} f console features
   * @param {object} s choreography state
   * @param {number} dt seconds since the last frame
   * @param {object} rig the rig handle, already posed for this frame
   */
  function update(f, s, dt, rig) {
    if (!cols || !rows) return;
    density.fill(0);
    kind.fill(0);

    beatFlash = f.beat ? 1 : Math.max(0, beatFlash - dt * 5);
    // Tempo scale: everything that moves on its own moves at the pulse he is
    // hearing, and slows to a crawl when there is no pulse at all.
    const tempo = (f.bpm / 120) * (0.12 + 0.88 * s.energy);
    hueShift = (hueShift + dt * (4 + 26 * s.energy) + (s.flash > 0.9 ? 40 : 0)) % 360;

    const view = { ...s, hueShift };
    stampRoom(view, f, dt, tempo, beatFlash);
    stampRig(rig.svg);
    stampBooth(view, dt, tempo);
    paint(view, f, beatFlash);
  }

  function destroy() {
    observer.disconnect();
    canvas.remove();
    rigHost.remove();
  }

  return { rigHost, update, destroy };
}

export default createAsciiStage;
