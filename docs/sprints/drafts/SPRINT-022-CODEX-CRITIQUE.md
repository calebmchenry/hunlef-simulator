# Sprint 022 Draft Critique

## Source Material

- Intent: `docs/sprints/drafts/SPRINT-022-INTENT.md`
- Claude draft: `docs/sprints/drafts/SPRINT-022-CLAUDE-DRAFT.md`
- Gemini draft: `docs/sprints/drafts/SPRINT-022-GEMINI-DRAFT.md`
- Codebase files reviewed:
  - `src/render/Renderer3D.ts`
  - `src/render/AnimationController.ts`
  - `tools/cache-reader/export-gltf.mjs`
  - `tools/cache-reader/validate-gltf.mjs`
  - `tools/cache-reader/node_modules/osrscachereader/src/cacheReader/loaders/ModelLoader.js`

---

## Claude Draft

### Strengths

1. **Best match to the real architecture**: It correctly keeps the runtime state machine mostly intact and focuses the change on the export pipeline plus boss GLTF loading. That matches both the intent and the current code, where `AnimationController` is already clip-driven.

2. **Strongest core implementation strategy**: Replaying OSRS `animate()` logic at the vertex-group/bone level is the right way to attack this. It is materially better than trying to infer bone motion from already-baked morph poses.

3. **Good skeletal authoring detail**: Flat bones, rigid 1.0 weights, per-group rest centroids, STEP interpolation, explicit clip naming, and shared skin support across opaque/alpha primitives are all concrete, relevant decisions.

4. **Respects current boss/player separation reality**: The draft notices that morph retargeting is still used by the player path in `Renderer3D.ts`, so boss cleanup cannot blindly delete those helpers yet.

5. **Operationally useful plan**: The phases, risks, verification steps, and DoD are detailed enough to execute, not just discuss.

### Weaknesses

1. **Misses the repo's existing validator contract**: The intent calls for `npm run validate-gltf` to evolve from morph validation to skeletal validation, but the draft never plans that file change. Replacing it with `npx gltf-validator` is not equivalent.

2. **Creates exporter ambiguity**: Adding `export-skeletal-gltf.mjs` while keeping `export-gltf.mjs` unchanged reduces migration risk, but it leaves the canonical boss export path unclear and extends dual maintenance.

3. **Coordinate conversion is too confident**: The draft treats the space conversion as mostly "invert Z," but the reference `loadFrame()` path in `osrscachereader` is subtler than that. The exact mesh-space and animation-space contract needs to be derived from source, not summarized loosely.

4. **Under-specifies material conversion risk**: `applyUnlitMaterials()` recreates materials at runtime. The draft says this should "just work" for `SkinnedMesh`, but it should be treated as something to validate carefully, especially for alpha primitives.

5. **Says `AnimationController.ts` is unchanged when it is really "almost unchanged"**: The controller likely does not need structural work, but the current stop-based transition comments are morph-specific and should at least be re-evaluated in the sprint writeup.

### Gaps in Risk Analysis

- No explicit risk for the existing in-repo GLTF validator becoming stale and making the sprint look complete while `npm run validate-gltf` still fails.
- No explicit risk for manual GLTF assembly bugs. Buffer packing, accessor layout, inverse bind matrices, and animation channel wiring are a separate class of failure from the transform math.
- No explicit risk for material/property loss when converting imported materials to `MeshBasicMaterial` on skinned alpha meshes.

### Missing Edge Cases

- **Vertices with no usable skin assignment**: The draft assumes every vertex binds cleanly to a group. It should say what happens if some vertices are ungrouped.
- **Initial T-pose flash**: Because the raw rest mesh is wider than the idle pose, the first rendered frame needs explicit verification, not just later clip transitions.
- **Unexpected framemap types**: The draft assumes Hunlef only needs types `0..3`. It should state whether other types are impossible for this asset or how they are rejected.
- **Missing groups in framemap references**: If a frame references a group index that does not exist in the built vertex-group table, the expected behavior should be defined.

### Definition of Done Completeness

Mostly strong. It covers the 8 clips, timing fidelity, boss visual correctness, player-path safety, fallback behavior, artifact cleanup, and build/test validation. The main omission is the repo-local skeletal validator migration: the sprint is not really done until `tools/cache-reader/validate-gltf.mjs` stops expecting boss morph targets and `npm run validate-gltf` passes.

---

## Gemini Draft

### Strengths

1. **Concise and readable**: The draft is easy to scan and stays focused on the main goal.

2. **Cleaner exporter ownership direction**: Rewriting the existing `export-gltf.mjs` is a cleaner long-term maintenance story than keeping two boss exporters around.

3. **Calls out two real uncertainties**: Node-side `GLTFExporter` compatibility and alpha primitive handling are legitimate risks.

4. **Handles one edge case Claude misses**: It explicitly mentions assigning ungrouped vertices to a default static root bone.

### Weaknesses

1. **Skips the hardest technical part**: The draft never really specifies how OSRS frame data becomes correct local bone transforms. It does not define rest centroids, inverse bind matrices, type-0 origin handling, rotation order, angle conversion, or sequential transform accumulation.

2. **Picks a riskier export path**: Building a Three.js `Scene` in Node and relying on Three's `GLTFExporter` adds browser-environment uncertainty on top of the already-hard animation work. The draft even hints at adding JSDOM to make this viable.

3. **Unnecessary `AnimationController` churn**: Enabling crossfading contradicts the intent's expectation that `AnimationController.ts` should need minimal or no changes. Crossfade is a follow-up choice, not part of the root fix.

4. **Does not fit the current renderer cleanup boundary**: `retargetMorphAnimations()` is still used by player GLTF loading. Saying the legacy morph pipeline is removed without scoping that to the boss path is incomplete and potentially wrong.

5. **Does not preserve OSRS timing semantics explicitly**: It mentions keyframe tracks, but not STEP interpolation or cumulative `frameLengths` timing. The likely default outcome is smoother animation, not faithful animation.

6. **Leaves major repo-specific deliverables out**: No validator migration, no old Hunlef `.bin` cleanup, no boss scale recheck, no fallback-path verification, and no explicit clip-name contract preservation.

7. **Alpha/multi-primitive handling is hand-waved**: "Natively supported via `SkinnedMesh`" is not an implementation plan.

### Gaps in Risk Analysis

- No risk called out for timing/interpolation drift away from OSRS frame-hold behavior.
- No risk called out for player regressions from shared morph-helper deletion.
- No risk called out for the existing `npm run validate-gltf` contract.
- No risk called out for bind-pose mismatch or an initial wide-pose flash on load.
- No risk called out for clip-name mismatches breaking `AnimationController` state mapping.

### Missing Edge Cases

- **Boss GLTF loads but clip names do not match the existing state map**.
- **The first visible frame shows the raw wide rest pose before idle starts**.
- **Linear interpolation plus controller crossfade changes held-frame timing in ways that look smoother but are less faithful**.
- **Opaque and alpha primitives need to share one skeleton and survive `applyUnlitMaterials()` consistently**.
- **Groups or frames that never animate, or framemap references that do not map cleanly to exported primitive-local geometry**.
- **The asset exports and loads, but still fails repo validation because the validator was never updated**.

### Definition of Done Completeness

Incomplete. It hits the broad user-facing goal, but it misses several concrete sprint obligations from the intent and current repo:

- no `npm run validate-gltf` success criterion
- no validator migration to skeletal rules
- no timing-fidelity requirement tied to `frameLengths`
- no player-path non-regression requirement
- no fallback-path verification
- no build verification
- no cleanup of old morph-target asset artifacts

It also adds "smooth blends via crossfading" as a success criterion, which is not required to solve the actual bug and could hide timing inaccuracies.

---

## Better Implementation Strategy

Claude's draft has the better implementation strategy.

Why:

1. It attacks the real problem directly by reconstructing skeletal transforms from OSRS group-based animation rules, instead of wrapping the problem in a vaguer Node-side Three.js export flow.

2. It fits the current codebase better: boss-only morph cleanup, player morph retention, minimal controller churn, explicit clip naming, and STEP playback all line up with the existing renderer and state machine.

3. It is more faithful to OSRS semantics. The draft explicitly plans held-frame timing, flat group-based transforms, and direct replay of `animate()` behavior.

4. Its main problems are fixable omissions, not flaws in the core method. The big missing pieces are validator migration, exporter ownership clarity, and a few unhandled edge cases. Gemini's missing pieces are in the core technical strategy itself.

If these were merged into one final sprint plan, the best synthesis would be:

1. Keep Claude's transform-tracking / flat-skeleton / boss-only cleanup approach.
2. Keep Gemini's explicit fallback handling for ungrouped vertices.
3. Make `tools/cache-reader/validate-gltf.mjs` a required sprint deliverable instead of substituting external validation.
4. Choose one canonical boss exporter path when the sprint lands, not two indefinitely.
