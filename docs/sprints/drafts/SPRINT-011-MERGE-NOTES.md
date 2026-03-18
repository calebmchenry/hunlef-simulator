# Sprint 011 Merge Notes

## Draft Strengths

### Codex (Claude) Draft — Primary basis for final sprint
- **Correctly identified the root cause**: the `hasVertexColors` gate in `Renderer3D.ts:300` rejects the GLTF because it uses texture-based coloring (TEXCOORD_0 + PNG atlas), not vertex colors. This was validated with a local GLTFLoader.parse() test.
- Minimal-change architecture: fix one gate, fix one material conversion, add one rotation offset
- Defers GLB optimization to non-blocking optional phase
- Zero new dependencies

### Claude Draft — Contributed depth on morph target analysis
- Excellent root cause analysis with 4 ranked failure hypotheses
- GLB conversion approach is well-specified with code
- But: the primary hypothesis (302-buffer decode issue) was disproven by Codex's validation
- Contingency Phase 3 (manual morph target injection) is a good safety net

### Gemini Draft — Contributed diagnostic rigor
- Best diagnostic code snippets (explicit logging of morphAttributes and morphTargetInfluences)
- Best Definition of Done (10 items, includes console error check and 30fps criterion)
- But: **wrong root cause** — assumes buffer consolidation is the fix, never examines the actual renderer code path

## Valid Critiques Accepted
1. Codex DoD missing 30fps performance criterion (from Gemini/critique) → added
2. Codex missing explicit diagnostic code snippets (from Gemini) → added as verification step
3. Material–morph interaction risk unaddressed in all drafts (from critique) → added to risks
4. Open Question #1 (JSON fallback permanence) left dangling → resolved: keep for load errors, warn if GLTF has animations but falls back

## Critiques Rejected
1. "GLB conversion needed for morph targets to load" (Gemini premise) — disproven by Codex's validation. The GLTFLoader loads all 144 morph targets from 302 buffers correctly.
2. "Need @gltf-transform/core dependency" (Gemini) — unnecessary for correctness; user confirmed: fix gate only.

## Interview Refinements
- User chose: fix gate only, no GLB conversion
- User chose: runtime PI offset for boss facing (not re-export)
