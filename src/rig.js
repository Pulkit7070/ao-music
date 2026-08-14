// AO mascot rig.
//
// A segmented SVG redraw of the AO mascot (assets/logo/ao-logo.svg, see
// assets/logo/SOURCE.md) with independently rotatable named joints.
// Pure DOM/SVG: every pose is one `transform="rotate(a cx cy)"` attribute per
// joint group, so a joint turns around its real pivot instead of sliding.
//
// Full contract: docs/DEMO_API.md

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Design canvas. All pivot coordinates below are in these user units. */
export const VIEW_BOX = { x: 0, y: 0, width: 400, height: 360 };

/** Joint names, parent first. */
export const JOINTS = [
  'torso',
  'head',
  'armL_upper',
  'armL_lower',
  'armR_upper',
  'armR_lower',
  'legL_upper',
  'legL_lower',
  'legR_upper',
  'legR_lower',
];

/**
 * Rotation pivot of each joint, in viewBox user units.
 * Positive angles are clockwise on screen for every joint (SVG convention).
 */
export const JOINT_PIVOTS = {
  torso: { x: 164, y: 258 }, // hip line, centre of the body
  head: { x: 164, y: 139 }, // neck, where the head block meets the torso
  armL_upper: { x: 82, y: 165 }, // left shoulder
  armL_lower: { x: 46, y: 165 }, // left elbow
  armR_upper: { x: 246, y: 165 }, // right shoulder
  armR_lower: { x: 286, y: 165 }, // right elbow
  // Leg joints drive a pair of limbs and each limb turns around its own hip and
  // knee. The coordinates below are the near (foreground) limb of each pair.
  legL_upper: { x: 133, y: 258 }, // rear hip axle
  legL_lower: { x: 133, y: 285 }, // rear knee
  legR_upper: { x: 229, y: 258 }, // front hip axle
  legR_lower: { x: 229, y: 285 }, // front knee
};

/** Sane angle range per joint, in degrees. Enforced unless clamp:false. */
export const JOINT_LIMITS = {
  torso: [-25, 25], // + leans the upper body toward the baton side (right)
  head: [-30, 30], // + tilts the top of the head right
  armL_upper: [-70, 140], // + raises the left arm, -90 points it straight down
  armL_lower: [-30, 130], // + folds the left forearm up
  armR_upper: [-140, 70], // - raises the baton arm, +90 points it straight down
  armR_lower: [-130, 30], // - folds the baton forearm up
  legL_upper: [-55, 55], // - swings the rear leg forward (toward the baton side)
  legL_lower: [-10, 70], // + bends the knee, heel toward the back
  legR_upper: [-55, 55], // - swings the front leg forward
  legR_lower: [-10, 70], // + bends the knee
};

/** Neutral pose. Reproduces the logo: baton arm up, everything else at rest. */
export const NEUTRAL_POSE = Object.freeze({
  torso: 0,
  head: 0,
  armL_upper: 0,
  armL_lower: 0,
  armR_upper: -18,
  armR_lower: -42,
  legL_upper: 0,
  legL_lower: 0,
  legR_upper: 0,
  legR_lower: 0,
});

/** Origin of scale and squash: centre of the foot line. */
const BODY_ORIGIN = { x: 164, y: 312 };

const BODY = { left: 80, right: 248 };
const HEAD = { top: 76, bottom: 139 };
const TORSO = { top: 139, bottom: 258 };
const LEG = { hip: 258, knee: 285, foot: 312, width: 24 };
const ARM = { top: 148, bottom: 182 };

const LEGS = {
  // Rear pair and front pair. Each pair swings around one hip axle, which is
  // how the four stubby legs of the original read as two limbs.
  legL: [
    { x: 121, far: false },
    { x: 85, far: true },
  ],
  legR: [
    { x: 217, far: false },
    { x: 181, far: true },
  ],
};

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  return node;
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * A blocky mascot limb/body segment: flat base, light top face, dark right
 * face, navy outline. Matches the shading of the original logo.
 */
function block(x, y, w, h, opts = {}) {
  const g = el('g', { class: 'ao-rig__block' });
  const r = opts.r === undefined ? 3 : opts.r;
  const face = Math.min(6, w / 3, h / 3);
  // A fill-only disc centred on the joint pivot, painted behind the segment.
  // A circle is rotation invariant, so the gap that opens between two segments
  // when the joint bends is always filled and the limb never breaks apart.
  if (opts.joint) {
    g.appendChild(
      el('circle', {
        class: 'ao-rig__joint',
        cx: opts.joint.x,
        cy: opts.joint.y,
        r: opts.joint.r,
      }),
    );
  }
  g.appendChild(el('rect', { class: 'ao-rig__body', x, y, width: w, height: h, rx: r }));
  // `omit` drops one outline edge so two stacked blocks read as one solid
  // body, the way the head and torso do in the original logo.
  const outlinePath =
    opts.omit === 'top'
      ? `M${x},${y} L${x},${y + h - r} Q${x},${y + h} ${x + r},${y + h} ` +
        `L${x + w - r},${y + h} Q${x + w},${y + h} ${x + w},${y + h - r} L${x + w},${y}`
      : opts.omit === 'bottom'
        ? `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
          `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h}`
        : null;
  if (opts.light !== false) {
    g.appendChild(
      el('rect', {
        class: 'ao-rig__light',
        x: x + face,
        y: y + 1,
        width: Math.max(0, w - 2 * face),
        height: face,
      }),
    );
  }
  if (opts.shade !== false) {
    g.appendChild(
      el('rect', {
        class: 'ao-rig__shade',
        x: x + w - face - 1,
        y: y + face,
        width: face,
        height: Math.max(0, h - 2 * face),
      }),
    );
  }
  g.appendChild(
    outlinePath
      ? el('path', { class: 'ao-rig__outline', d: outlinePath })
      : el('rect', { class: 'ao-rig__outline', x, y, width: w, height: h, rx: r }),
  );
  return g;
}

function legSegment(leg, top, bottom, jointY, opts = {}) {
  const part = block(leg.x, top, LEG.width, bottom - top, {
    light: false,
    shade: false,
    joint: { x: leg.x + LEG.width / 2, y: jointY, r: LEG.width / 2 },
    ...opts,
  });
  if (leg.far) part.setAttribute('class', 'ao-rig__block ao-rig--far');
  return part;
}

function buildMascot(opts) {
  const root = el('g', { class: 'ao-rig__root' });

  // Legs are siblings of the torso, not children: leaning the torso must not
  // drag the planted feet sideways.
  //
  // Each pair is one joint but two limbs, and both limbs turn around their own
  // hip and knee. Rotating the pair as a single rigid body would lift the far
  // leg off the hip line and the pair would scissor apart.
  const legGroups = {};
  const legTargets = {};
  for (const side of ['legL', 'legR']) {
    const pairGroup = el('g', { class: `ao-rig__pair ao-rig__pair--${side}` });
    legTargets[`${side}_upper`] = [];
    legTargets[`${side}_lower`] = [];

    // Far leg first so the near leg paints over it.
    for (const leg of [...LEGS[side]].reverse()) {
      const cx = leg.x + LEG.width / 2;
      const thigh = el('g', {
        class: 'ao-rig__part',
        'data-part': `${side}_upper`,
        'data-leg': leg.far ? 'far' : 'near',
      });
      const shin = el('g', {
        class: 'ao-rig__part',
        'data-part': `${side}_lower`,
        'data-leg': leg.far ? 'far' : 'near',
      });
      shin.appendChild(legSegment(leg, LEG.knee - 3, LEG.foot, LEG.knee));
      thigh.appendChild(legSegment(leg, LEG.hip, LEG.knee + 2, LEG.hip, { omit: 'bottom' }));
      thigh.appendChild(shin);
      pairGroup.appendChild(thigh);
      legTargets[`${side}_upper`].push({ node: thigh, pivot: { x: cx, y: LEG.hip } });
      legTargets[`${side}_lower`].push({ node: shin, pivot: { x: cx, y: LEG.knee } });
      // parts[] exposes the near limb, the one in the foreground.
      if (!leg.far) {
        legGroups[`${side}_upper`] = thigh;
        legGroups[`${side}_lower`] = shin;
      }
    }

    root.appendChild(pairGroup);
  }

  const torso = el('g', { 'data-part': 'torso', class: 'ao-rig__part' });

  // Arms sit behind the torso block on the left, in front on the right, which
  // keeps the baton arm reading as the raised foreground limb of the logo.
  const armL_upper = el('g', { 'data-part': 'armL_upper', class: 'ao-rig__part' });
  const armL_lower = el('g', { 'data-part': 'armL_lower', class: 'ao-rig__part' });
  armL_lower.appendChild(
    block(8, ARM.top, 42, ARM.bottom - ARM.top, {
      r: 6,
      joint: { ...JOINT_PIVOTS.armL_lower, r: (ARM.bottom - ARM.top) / 2 },
    }),
  );
  armL_upper.appendChild(
    block(42, ARM.top, 42, ARM.bottom - ARM.top, {
      joint: { ...JOINT_PIVOTS.armL_upper, r: (ARM.bottom - ARM.top) / 2 },
    }),
  );
  armL_upper.appendChild(armL_lower);
  torso.appendChild(armL_upper);

  // Head is drawn before the torso block so its lower edge disappears into the
  // torso like a neck socket, and the neutral pose reproduces the one-piece
  // silhouette of the original logo.
  const head = el('g', { 'data-part': 'head', class: 'ao-rig__part' });
  head.appendChild(
    block(BODY.left, HEAD.top, BODY.right - BODY.left, HEAD.bottom - HEAD.top + 10, {
      r: 4,
      omit: 'bottom',
    }),
  );
  head.appendChild(el('rect', { class: 'ao-rig__eye', x: 117, y: 110, width: 17, height: 24, rx: 2 }));
  head.appendChild(el('rect', { class: 'ao-rig__eye', x: 202, y: 110, width: 17, height: 24, rx: 2 }));
  torso.appendChild(head);

  torso.appendChild(
    block(BODY.left, TORSO.top, BODY.right - BODY.left, TORSO.bottom - TORSO.top, {
      r: 4,
      light: false,
      omit: 'top',
    }),
  );

  const armR_upper = el('g', { 'data-part': 'armR_upper', class: 'ao-rig__part' });
  const armR_lower = el('g', { 'data-part': 'armR_lower', class: 'ao-rig__part' });
  armR_lower.appendChild(
    block(280, ARM.top, 44, ARM.bottom - ARM.top, {
      joint: { ...JOINT_PIVOTS.armR_lower, r: (ARM.bottom - ARM.top) / 2 },
    }),
  );
  armR_lower.appendChild(
    el('circle', { class: 'ao-rig__paw', cx: 320, cy: (ARM.top + ARM.bottom) / 2, r: 15 }),
  );
  if (opts.baton !== false) {
    const baton = el('g', { class: 'ao-rig__baton', 'data-part': 'baton' });
    baton.appendChild(
      el('rect', { class: 'ao-rig__baton-stick', x: 318, y: 160, width: 104, height: 10, rx: 5 }),
    );
    baton.appendChild(
      el('rect', { class: 'ao-rig__baton-grip', x: 318, y: 159, width: 26, height: 12, rx: 6 }),
    );
    armR_lower.appendChild(baton);
  }
  armR_upper.appendChild(
    block(244, ARM.top, 44, ARM.bottom - ARM.top, {
      joint: { ...JOINT_PIVOTS.armR_upper, r: (ARM.bottom - ARM.top) / 2 },
    }),
  );
  armR_upper.appendChild(armR_lower);
  torso.appendChild(armR_upper);

  root.appendChild(torso);

  const parts = {
    torso,
    head,
    armL_upper,
    armL_lower,
    armR_upper,
    armR_lower,
    ...legGroups,
  };

  // One entry per rotation target. Leg joints have two, one per limb of a pair.
  const targets = {};
  for (const name of JOINTS) {
    targets[name] = legTargets[name] || [{ node: parts[name], pivot: JOINT_PIVOTS[name] }];
  }

  return { root, parts, targets };
}

/**
 * Mount the mascot into `container`.
 *
 * @param {Element} container host element, emptied unless opts.replace === false
 * @param {object} [opts]
 * @param {object} [opts.pose] initial pose, merged over NEUTRAL_POSE
 * @param {number} [opts.scale=1] initial uniform scale
 * @param {boolean} [opts.clamp=true] clamp pose angles to JOINT_LIMITS
 * @param {boolean} [opts.baton=true] draw the conductor baton
 * @param {boolean} [opts.shadow=true] draw the ground shadow
 * @param {string} [opts.className] extra class on the <svg>
 * @param {string} [opts.title='AO mascot'] accessible name
 * @returns {object} rig handle
 */
export function createRig(container, opts = {}) {
  if (!container) throw new Error('createRig: container is required');

  const svg = el('svg', {
    class: `ao-rig${opts.className ? ` ${opts.className}` : ''}`,
    viewBox: `${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`,
    xmlns: SVG_NS,
    role: 'img',
    'aria-label': opts.title || 'AO mascot',
  });

  if (opts.shadow !== false) {
    svg.appendChild(
      el('ellipse', { class: 'ao-rig__ground', cx: BODY_ORIGIN.x, cy: LEG.foot + 8, rx: 118, ry: 12 }),
    );
  }

  const { root, parts, targets } = buildMascot(opts);
  svg.appendChild(root);

  if (opts.replace !== false) container.textContent = '';
  container.appendChild(svg);

  const clampAngles = opts.clamp !== false;
  const pose = { ...NEUTRAL_POSE };
  const transform = {
    tx: 0,
    ty: 0,
    sx: opts.scale === undefined ? 1 : opts.scale,
    sy: opts.scale === undefined ? 1 : opts.scale,
    squash: 0,
  };

  function applyJoint(name) {
    const angle = pose[name].toFixed(3);
    for (const target of targets[name]) {
      target.node.setAttribute('transform', `rotate(${angle} ${target.pivot.x} ${target.pivot.y})`);
    }
  }

  function applyTransform() {
    const k = transform.squash;
    const sx = transform.sx * (1 + k * 0.3);
    const sy = transform.sy * (1 - k * 0.3);
    root.setAttribute(
      'transform',
      `translate(${transform.tx.toFixed(3)} ${transform.ty.toFixed(3)}) ` +
        `translate(${BODY_ORIGIN.x} ${BODY_ORIGIN.y}) ` +
        `scale(${sx.toFixed(5)} ${sy.toFixed(5)}) ` +
        `translate(${-BODY_ORIGIN.x} ${-BODY_ORIGIN.y})`,
    );
  }

  const handle = {
    /** The mounted <svg> element. */
    svg,
    /** Alias of svg, for code that treats every widget as `handle.element`. */
    element: svg,
    /** Live map of joint name to its <g>. Read-only by convention. */
    parts,
    joints: JOINTS,
    pivots: JOINT_PIVOTS,
    limits: JOINT_LIMITS,

    /**
     * Merge a partial pose, in degrees. Omitted joints keep their angle.
     * Unknown keys and non-finite values are ignored.
     */
    setPose(next) {
      if (!next) return handle;
      for (const name in next) {
        if (!(name in pose)) continue;
        const value = Number(next[name]);
        if (!Number.isFinite(value)) continue;
        const limit = JOINT_LIMITS[name];
        pose[name] = clampAngles ? clamp(value, limit[0], limit[1]) : value;
        applyJoint(name);
      }
      return handle;
    },

    /** Current pose as a plain object, in degrees. */
    getPose() {
      return { ...pose };
    },

    /** Back to NEUTRAL_POSE and an untransformed body. */
    reset() {
      handle.setPose(NEUTRAL_POSE);
      transform.tx = 0;
      transform.ty = 0;
      transform.sx = 1;
      transform.sy = 1;
      transform.squash = 0;
      applyTransform();
      return handle;
    },

    /** Uniform or per-axis scale of the whole body, about the foot line. */
    scale(sx, sy = sx) {
      if (Number.isFinite(sx)) transform.sx = sx;
      if (Number.isFinite(sy)) transform.sy = sy;
      applyTransform();
      return handle;
    },

    /** Offset the whole body, in viewBox user units. */
    translate(x = 0, y = 0) {
      if (Number.isFinite(x)) transform.tx = x;
      if (Number.isFinite(y)) transform.ty = y;
      applyTransform();
      return handle;
    },

    /**
     * Squash and stretch about the foot line.
     * k > 0 squashes (wider, shorter), k < 0 stretches. Useful range -1..1.
     */
    squash(k = 0) {
      if (Number.isFinite(k)) transform.squash = clamp(k, -1, 1);
      applyTransform();
      return handle;
    },

    /** Remove the rig from the DOM. */
    destroy() {
      svg.remove();
    },
  };

  handle.setPose(opts.pose);
  applyTransform();
  for (const name of JOINTS) applyJoint(name);

  return handle;
}

export default createRig;
