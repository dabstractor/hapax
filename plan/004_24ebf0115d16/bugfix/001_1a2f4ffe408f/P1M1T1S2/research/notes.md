# Research notes — P1.M1.T1.S2 (bugfix 001_1a2f4ffe408f): chain.arm from insertHighlighted

## Sources examined
- src/pi/widget.ts:
  - WidgetLayerOptions.chain (~L122-131): `chain: ChainMachine` — "held for
    index.ts's reset wiring and is read by NO widget code" (JSDoc to update).
  - insertHighlighted (~L841): signature (inner, state, visibility,
    config, requestRender) → boolean. Doc block L833-840 "CHAIN ARMS:
    NEVER (plan 004)" — delete/rewrite. Body: state.hidden check,
    `items = state.items`, clamp idx, display read, lines/cursor reads,
    then span computation → setText insert → hide() + machine.onDismissed(true).
  - Tab-insert call site (~L1165): `const consumed = insertHighlighted(
    innerRecord as unknown as EditorLike, state, machine, opts.config,
    requestRender); if (!consumed) return forwardInput(data);` — opts
    (WidgetLayerOptions incl. opts.chain) is in scope here.
  - DECISION: arm at the CALL SITE, not inside insertHighlighted —
    CRITICAL: insertHighlighted's success path calls hide(), and S1's
    painted() clears on hide(). Reading machine.painted() AFTER consumed
    would see []. Capture the record BEFORE the call:
      const paintedNow = machine.painted();
      const rec = paintedNow[Math.min(Math.max(state.highlightIndex,0),
                        paintedNow.length-1)];
    then after consumed===true: if (opts.config.enableChaining && rec &&
    rec.tier !== 0 && rec.key) opts.chain.arm(rec.key).
    Wait: clamped idx must match the index insertHighlighted used against
    state.items — S1's parity contract guarantees painted()[i].display ===
    currentSet[i].display and state.items is a copy of currentSet, so the
    same clamp applies. Use items.length===0 guard first (insert returns
    false anyway; harmless).
- src/pi/provider.ts applyCompletion (~L639-706) — reference arming:
  - gate: config.enableChaining; not-in-map → never arms (span-miss/
    stock forward analog).
  - arm the STORE KEY (rec.key from the value→key truth), NEVER a
    lowercased display — rule-4d path displays keep edge slashes while
    store keys are trimmed-lowercase ("arm the MAPPED STORE KEY...").
  - TIER-0 SUPPRESSION: strict `tier === 0` skip; `tier <= 0`/falsy checks
    would break chaining (chain shims + '#'-listing records OMIT tier →
    they keep arming). Widget: rec.tier === 0 → skip; undefined → arm.
  - trigger-char completions arm (whole-word insertions, spec/07:476).
  - one-shot grant resets (chainWordsSeen/chainLastArmedPrefix) are
    PROVIDER-internal; the shared grant tracker is P1.M1.T2.S2 — S2 arms
    ONLY, no grant handling.
- S1 PRP contract: VisibilityMachine.painted(): readonly RankedMatch[]
  aligned 1:1 with currentSet (order + lifetime); paint() single write
  site; hide() clears. Chain shims (T2.S1) will be RankedMatch-shaped and
  flow through paint → arming at a successor's key re-arms naturally
  (successor accepted → rec.key is that successor's store key → arm(key)).
- spec/04:215-216 "tier-0 matches never arm or extend a chain";
  spec/07:476 trigger completions arm.
- test/widget.test.ts:1053 pins no-arm "BY DESIGN" — WILL FAIL after S2.
  Repo requires green before commit: S2 must minimally update that pin to
  the new contract; S3 formalizes the full arming pin suite. State this
  explicitly to avoid a red suite or a wrongly-deleted pin.

## Key decisions
- Arm at the call site (post-consumed), record captured PRE-call (hide()
  clears painted()).
- Strict tier === 0 skip only; arm rec.key verbatim (already the
  trimmed-lowercase store key — no toLowerCase of display).
- Gate on opts.config.enableChaining; never arm on line-hidden /
  span-miss (insert returned false → forward, no arm).
- Docs: delete the "CHAIN ARMS: NEVER" block; update WidgetLayerOptions.chain
  JSDoc + file-header forward-task map (Mode A).
