# Research notes — bugfix 001_140e40041dd1 P1.M2.T1.S2: resolver pathDisplay-first guard + regression battery

## Upstream contract (P1.M2.T1.S1, implementing in parallel — assume delivered)
- types.ts: `Sighting.path?: boolean`; `Candidate.pathDisplay?: string` (absent ≡ not-a-path).
- ingest.ts: `...(draft.path ? { path: true } : {})` at the Sighting-build sites.
- store.ts upsert create: seeds `pathDisplay: sighting.display` when sighting.path (every casing branch — letter-initial paths can classify mid-cap); merge: sticky-first, never overwritten.
- Battery in test/store.test.ts pins sticky-first ('/home/x/y' first sighting wins over bare and '../' variants).

## Current resolver (bug002-path-display.md §3 — VERIFIED, query.ts:386-408)
- `resolveCompletionCasing(c: Pick<Candidate,"key"|"capCount"|"lowerCount"|"capDisplay">, fragmentFirstLetter)` — uppercase branch (capDisplay || capitalize-key), frequency branch (capCount>lowerCount → capDisplay; else key). NO path handling: 'lower'-classified paths return the TRIMMED key on the frequency branch, and a typed capital capitalizes the trimmed key (edges lost both ways).
- Both construction sites already pass rawFirst: anchored :616, tier-0 :671 (same `const rawFirst = prefix.charAt(0)` at :551). Sites need ZERO change.

## The documented design decision (supersedes an existing pin)
- Guard FIRST: `if (c.pathDisplay !== undefined) return c.pathDisplay;` — pathDisplay wins ALWAYS, including a typed capital first letter. Rationale: leading '/', '~', '.' is not a letter, and spec/04 Case handling (:713-714 "paths and technical literals always insert verbatim") outranks the Shift-preserve LETTER-case rule.
- SUPERSEDED pin to update: the resolver doc (≈:345-360) + the old battery comment claiming "a typed CAPITAL first letter still capitalizes a path key — the never-override rule outranks path verbatim-ness". That was the interim acceptance of the broken output; flip both the doc and the pin. (From plan-006 S1's battery: `'S' + 'src/core/query.ts' → 'Src/core/query.ts'` must become `'S' → verbatim 'src/core/query.ts'` — or with S1's pathDisplay now set, the guard returns the pathDisplay verbatim.)

## Downstream (bug002 doc §4 — VERIFIED, zero changes needed)
- provider.ts:668-671 value/label = m.display; liveKeyByValue keys on display, arming uses the mapped STORE KEY (comment at ~:705-715 already anticipates edge-bearing displays).
- widget.ts:1390/1449 splices display.
- So this task = resolver guard + battery only; end-to-end insertion is P1.M2.T2.S1.

## Test surface (verified in test/query.test.ts)
- Helpers: `put(s, key, n=1, over?)` at :92 (wraps sighting({key, display: key, ...over})); `sighting(over)` fabricates literal Sighting objects (path cases pass `path: true`).
- Casing describe at :161 ("rankMatches — case-insensitive prefix, completion-time display casing (h2.27 × h2.32)"); tier-0 battery block ≈:1576-1586 (comment cites the :647/:671 tier-0 site).
- Resolver-level cases can use `sighting({key:'home/...', display:'/home/...', path:true})` directly.

## Drift to record (Mode A, spec READ-ONLY)
- Record for P2.M2.T2.S2: spec/04 h2.32's "paths and technical literals always insert verbatim" needs the precedence clarification (verbatim outranks Shift-preserve even for a typed capital) — the current spec text is ambiguous enough that the old battery pinned the WRONG reading.

## Commands
- npx vitest --run test/query.test.ts -v; npm run check; npm test.
