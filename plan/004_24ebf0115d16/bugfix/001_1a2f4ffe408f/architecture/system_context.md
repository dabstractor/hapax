# System context — bugfix changeset 001 (BUG-001 … BUG-004)

Audience: downstream PRP research/implementation agents. Everything below was
verified against the working tree at plan time (all four bugs reproduced live
by research children through real compiled modules; no claims taken on faith
from the PRD). Per-rebug detail lives in the sibling files:

- `r1-chain-widget.md` — BUG-001 (M2 chaining dead on widget primary path)
- `r2-tokenizer-overlap.md` — BUG-002 (overlapping tokens, trailing-'_' literals)
- `r3-suppression-leak.md` — BUG-003 (suppression leaks across messages)
- `r4-chunk-stitching.md` — BUG-004 (64KB chunk-boundary token shredding)

## System map (what talks to what)

```
src/core/  segment.ts (tokenize) → shapeGate.ts → score.ts → store.ts (CandidateStore
           + successor bigram index: recordBigramRuns / topSuccessors)
           query.ts (rankMatches :424, matchFragment :244)
src/pi/    index.ts (extension lifecycle; picks display path)
             ├─ editor factory present (PRIMARY) → createWidgetEditorFactory
             │    (widget.ts) → createVisibilityMachine — NO provider registered
             └─ else (fallback) → ctx.ui.addAutocompleteProvider(createHapaxProvider
                  (provider.ts) incl. chain arming + armed consult branch)
           ingest.ts (IngestPipeline.processText, ≤64KB slicing, #admitSegment,
             appendSegment openLine/openTail run stitching)
           config.ts / editor.ts / debug.ts / paths.ts
```

Shared instances: `chain: ChainMachine` (`src/pi/provider.ts:765-790`,
`createChainMachine()`, `state(): {word}|null`, `arm(word)`, `reset()`) is
created per session in index.ts and ALREADY passed into the widget factory via
`WidgetLayerOptions.chain` (widget.ts:122-131) — currently unread by widget
code. `before_agent_start` → `chain?.reset()` (index.ts:402) covers both paths
for free.

## Verified defects → fix directions (all claims in the PRD confirmed)

| Bug | Root cause (file:line) | Chosen fix direction |
| --- | --- | --- |
| BUG-001 | widget.ts:834-840 never arms (`CHAIN ARMS: NEVER`); visibility machine built without chain/isIntentBypass (widget.ts:995-1011); index.ts:262-284 widget branch registers no provider so provider.ts:639-706 arming never runs; test/widget.test.ts:1053 pins it | Implement per spec/07:437-476 (spec already REQUIRES widget-line offers at :472): arm in `insertHighlighted`, add chain consult branch + `isIntentBypass` wiring to `createVisibilityMachine`, port one-shot grant tracker as shared helper, invert the pin. Spec gains one clarifying clause only. |
| BUG-002 | segment.ts:569 absorber checks only equal-span defer; base token `FOO_1_`[0,6) straddles trimmed literal `FOO_1`[0,5); overlap-safety branch (:658-662) emits both | Fix (b): containment defer `o.start <= start && end <= o.end` (base token wins; matches equal-span defer + "strictly additive" spec/04:101-106). Spec/04 bullet extended with the `FOO_1_` example. |
| BUG-003 | widget.ts:707-721 records `suppressedFragmentStart` (numeric); release check :628-637 `start === suppressedFragmentStart` never releases a start-0 dismissal for the next message's first word (also start 0) | Buffer-fingerprint release: record `lines.join("\n")` at dismissal; stay suppressed only while the current buffer is a same-word continuation (either is a prefix of the other). Empty dismissed buffer → context-free (release at any boundary). No spec change — restores spec/07:72-75 intent. |
| BUG-004 | ingest.ts:392-403 processText tokenizes each ≤64KB slice locally; run layer stitches (appendSegment :190) but tokens don't | Carry the trailing class-char run (`TOKEN_CHAR_RE = /[A-Za-z0-9._@:+/~=-]/`, cap 1024) of each non-final slice into the next; final slice admits its tail normally; unconditional per-slice yield preserved. Spec/05:30-36 gains the never-splits-a-token sentence; stale docstring ingest.ts:388-391 replaced. |

## Cross-bug interactions (sequencing constraints)

1. **BUG-001 × BUG-003 collide in `createVisibilityMachine.evaluate`.** The
   chain consult branch inserts between R1 (stock-context) and R3
   (no-fragment close); the suppression release rewrites the R4 block
   (:628-637). A zero-char chain offer IS a word start at column 0 — exactly
   where a leaked start-0 suppression would hide it. **Land BUG-001's machine
   work first (M1), then BUG-003 (M2.T2) on top, re-running BOTH
   `test/widget.test.ts` and `test/widget-visibility.test.ts`.**
2. **Shared helper extraction (BUG-001)** touches provider.ts internals —
   keep `test/chain.test.ts`, `test/chaining-gating.test.ts`,
   `test/provider*.test.ts` green (fallback path must not regress).
3. **BUG-004's carry** must not be counted in `openTail` (carried chars are
   trimmed from the slice BEFORE `#admitSegment`/`appendSegment` sees it) or
   run/bigram accounting breaks; junction char class exactly mirrors the five
   tokenize regexes (segment.ts:75-101).

## Spec-sync obligations (AGENTS.md: code+spec land together)

| Subtask | Spec edit riding with it |
| --- | --- |
| BUG-001 consult+tests (P1.M1.T2.S3) | spec/07 M2 section: one clarifying clause — widget path arms at its Tab-insert (the applyCompletion equivalent); successor offers publish through the visibility machine's intent bypass |
| BUG-002 (P1.M2.T1.S1) | spec/04:101-106 "Strictly additive" bullet: contained-span defer + `FOO_1_` example |
| BUG-004 (P1.M2.T3.S1) | spec/05:30-36: "a slice boundary never splits a token; the trailing partial is carried into the next slice and tokenized once" |
| Docs sweep (P1.M2.T4.S2) | PRD-noted pure-text drift: spec/04's 9-char example ("q=82 rejects" is wrong — R_eff(9)=82.15 admits, pinned by test/score.test.ts:129) and spec/09:86 "exactly one eviction" vs spec/06:58 batch-of-256 (impl+tests follow 06) |
| BUG-003 | none — restores spec/07:72-75 intent |

## Documentation targets

- Mode A (rides with work): the code-comment doc pins that the fixes
  invalidate — widget.ts:833-840 "CHAIN ARMS: NEVER" + WidgetLayerOptions.chain
  comment (:122-131), ingest.ts:388-391 stale docstring, segment.ts:660
  overlap-safety comment. Spec edits per table above.
- Mode B (final task): `README.md:134-144` chained-completion feature blurb
  (currently cites only `src/pi/provider.ts` — must cover the widget path);
  README items list (:20-25); `docs/M1-DoD.md` only if a line is invalidated.

## Verification norms (apply to every subtask)

- `npm run check` (tsc) and `npm test` (vitest, 1053 passed / 1 skipped
  baseline) green before done. UI-layer subtasks (anything in widget.ts /
  editor.ts) additionally need live TTY verification per
  `spec/09-testing-and-acceptance.md`, not unit tests alone.
- Non-negotiable invariants (spec/SPEC.md): Tab-only completion; the menu
  never renders with zero candidates (chain branch must `chain.reset()` +
  fall through on empty successor sets); everything stays in RAM — no
  persistence, no telemetry, no network; `enableChaining:false` leaves every
  new chain branch inert; tier-0 matches never arm or extend a chain
  (spec §04); stock contexts always win over armed chains (provider.ts:308
  ordering).
- Research harnesses: node TS-stripping / vitest one-offs writing ONLY under
  /tmp; fake inner editors (getLines/getCursor/setText/setCursorCol), spied
  `ChainMachine` objects, real seeded stores. No external services exist to
  mock (no network, no persistence).

## Confidence & residuals

All PRD claims verified with live reproduction. Residual risks are recorded
per-bug in the r1-r4 files (notably: BUG-001 TOCTOU double-arming tolerance,
one-shot tracker behavior under click-moved cursors; BUG-004 unicode-letter
junction seam and secrets straddling seams remaining unmaskable — documented
limitation, unchanged).
