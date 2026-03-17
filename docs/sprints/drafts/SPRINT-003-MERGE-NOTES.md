# Sprint 003 Merge Notes

## Interview Additions (not in any draft)

**Hunlef Protection Prayer Mechanic** — The user clarified a mechanic missing from the simulator:
- The Hunlef has its OWN protection prayer (protects from melee, magic, or missiles)
- It starts protecting one style
- After 6 "off-prayer" hits (player attacks with a style the boss ISN'T protecting), it switches to protect that style
- The overhead icon above the boss shows what it's currently PROTECTING AGAINST
- This is critical game logic: it determines which weapon the player should use and when to switch

This was not in any of the 3 drafts since they all assumed "overhead = boss attack style." The user corrected this.

## Draft Strengths

- **Claude**: Best asset pipeline design — download script with idempotent skipping, typed manifest
- **Codex**: Simplest approach — flat folder, just swap innerHTML, two preloaded canvas images
- **Gemini**: AssetManager with promise-based ready() gate, typed ASSET_MANIFEST union

## Merge Decisions

| Topic | Decision | Source |
|-------|----------|--------|
| Download script | Node.js script in tools/, idempotent | Claude |
| Image organization | `public/images/{tabs,items,prayers,overheads}/` | Claude |
| Asset manifest | Typed const object in `src/render/assets.ts` | Claude + Gemini |
| DOM image swaps | Simple `<img>` replacement in existing panels | Codex |
| Canvas overhead | Preload Image objects in Renderer constructor | Codex |
| Boss overhead | Shows what Hunlef is PROTECTING (not its attack style) | User interview |
| Hunlef protection mechanic | New game logic: 6 off-prayer hits → style switch | User interview |
| Prayer icons | All 29 from wiki | User interview |
