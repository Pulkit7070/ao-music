# AO mascot logo sources

| File | Origin |
| --- | --- |
| `ao-logo.svg` | https://github.com/AgentWrapper/agent-orchestrator/blob/HEAD/assets/ao-logo.svg (raw: https://raw.githubusercontent.com/AgentWrapper/agent-orchestrator/HEAD/assets/ao-logo.svg) |
| `ao-app-icon-1024.png` | https://github.com/AgentWrapper/agent-orchestrator/blob/HEAD/frontend/assets/icon.png (raw: https://raw.githubusercontent.com/AgentWrapper/agent-orchestrator/HEAD/frontend/assets/icon.png) |

Both fetched 2026-08-14 from the Agent Orchestrator repository (Apache-2.0, see
https://github.com/AgentWrapper/agent-orchestrator/blob/HEAD/LICENSE).

`ao-logo.svg` is already vector, so no tracing of the character outline was
needed. The rigged mascot in `src/rig.js` is a segmented redraw of that same
character: blocky body, two square eyes, four stubby legs, one raised arm
holding a baton. The palette is taken directly from the original file:

| Role | Hex |
| --- | --- |
| body | `#79B0DC` |
| body light (top face) | `#A5CDE7` |
| body shade (right/under face) | `#517CB8` |
| outline / deep shadow | `#2A3E6B`, `#26365D` |
| eyes | `#202943` |
| baton | `#DEE3EA` with `#7E8BB0` shade |

The only shape deviations from the original, both needed so the character can
be posed and animated:

1. The single body block is split into `head` and `torso` at the step in the
   original silhouette (the height where the left protrusion begins), so the
   neutral pose reproduces the original outline.
2. The stubby legs are lengthened and split into thigh and shin segments so leg
   motion is visible. The four legs are grouped into a rear pair (`legL`) and a
   front pair (`legR`), matching the original four-legged read.
