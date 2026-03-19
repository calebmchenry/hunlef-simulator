# Sprint 022 Merge Notes

## Draft Strengths

### Claude Draft
- Most detailed implementation (414 lines) with concrete pseudocode for bone transform extraction
- Correct OSRS rotation encoding (`(value & 255) * 8`, Z->X->Y order)
- Clear separation of phases with well-defined checkpoints
- Correctly identifies that player morph code must be preserved
- Good GLTF output structure diagram

### Codex Draft
- **Best parity check strategy**: reconstruct posed vertices from `groupMatrices[groupOfVertex] * baseVertex` and compare against `loadFrame().vertices` — catches transform math bugs at export time
- Data-grounded: opens with concrete facts (165 vertex groups, 2180 vertices, 154 non-empty groups)
- `OSRS_TO_GLTF = makeScale(1, -1, -1)` basis-change matrix via conjugation is elegant and correct
- Stable joint indexing (keep empty groups as identity joints) avoids remap table complexity
- Proposes updating `validate-gltf.mjs` to validate skeletal structure — critical for CI

### Gemini Draft
- Concise and clear (79 lines)
- Proposes using Three.js's own GLTFExporter in Node.js — user chose hand-build instead
- Correctly suggests enabling crossfading — user chose to defer

## Critiques Accepted

1. **Claude critique of Codex**: "Crossfade introduced in same sprint as migration — should defer." **Accepted** — user confirmed.
2. **Claude critique of Codex**: "Three.js in export script is hand-waved." **Accepted** — user chose hand-build GLTF JSON, no Three.js in build tool.
3. **Codex critique of Claude**: "Misses the repo's existing validator contract." **Accepted** — must update `validate-gltf.mjs` for skeletal validation.
4. **Codex critique of Claude**: "Creates exporter ambiguity with two scripts." **Accepted** — final sprint should clarify the canonical export path.
5. **Claude critique of both**: "Joint count (165) is high — verify WebGL uniform limits." **Accepted as risk item.**
6. **All critiques**: Buffer file cleanup (302 old .bin files) must be explicitly addressed.

## Critiques Rejected

1. **Gemini suggesting Three.js GLTFExporter in Node.js**: User explicitly chose hand-build GLTF JSON.
2. **Codex/Gemini suggesting crossfade in this sprint**: User chose to defer crossfading.

## Interview Refinements

1. **Export strategy**: Hand-build GLTF JSON directly (no Three.js in build tool)
2. **Crossfading**: Defer to follow-up sprint — keep immediate stop
3. **Parity check**: Include — validate at export time against morph vertex data
4. **Scope**: Boss-only — player morph code stays, static models unchanged
