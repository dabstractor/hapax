# Spec & Acceptance Map (verbatim anchors for the 6-bug fix)

## Governing quotes (file + heading)
- `spec/SPEC.md ## Design invariants (non-negotiable)` #2: "**Tab is never delayed by UI — and Tab only ever completes.** … Tab never opens, toggles, or summons the menu; the menu opens automatically on the 2nd char of a matching word, on the 1st char after the trigger char, or at the zero-char chain offer."
- `spec/01-goals-and-scope.md ## UX principles`: "Suggestions that would embarrass (secrets, garbage tokens) must never appear; the shape gate is load-bearing for the absent-from-dictionary class."
- `spec/04-tokenization-and-scoring.md ### What counts as a word` rule 3: "A word candidate must be a run of `[A-Za-z0-9_]` bounded on BOTH sides by non-letter characters (any Unicode letter counts as a letter). A non-ASCII letter adjacent to an ASCII run disqualifies the whole run: `Þórhildur` yields NOTHING … `ΩbsidianMirror` yields NOTHING."
- `spec/04 ## Admission decision` table documents bands 220/120 ("Constants 220/120 are the only tuning surface; see 09 for the tuning protocol"). ⚠️ Code ships 50/20 (prior retune) — spec/code drift is KNOWN; do not edit spec; record relief band in code JSDoc + docs.
- `spec/06-candidate-store.md ### Successor index`: "Cap the bigram map at 10,000 keys with the standard eviction policy; evicting a bigram also splices it from the successor index." Bigram formation: admitted whole tokens adjacent in raw text, whitespace-only separation, same line; stopword bridging forbidden.
- `spec/07-completion-ui.md ## Trigger modes` priority: "trigger-char match wins; otherwise threshold match; otherwise `return current.getSuggestions(...)` untouched (path/slash completion must keep working exactly as before, including inside quoted paths)." Trigger completion consumes the trigger char (`#fragment` replaced).
- `spec/07 ### Tab-open gesture: root cause (traced) and mitigation`: force:true + live fragment → single-item return; "When hapax has no live fragment (path/slash contexts), delegate to `current.getSuggestions(...)` passing the options object through unchanged."
- `spec/07 ## M2: chained completion` state machine: armed(W) zero-char offer; typed chars filter; "Any non-Tab key that disqualifies (space, escape, punctuation) → idle"; chain arms only from hapax's own candidates; reset on before_agent_start.
- `spec/09-testing-and-acceptance.md ## Definition of done — M2` … "Integration item 7: accept `National` → with zero additional typed chars `Renewable` is the top result → `Tab` → `Energy` → `Tab` → `Laboratory`."
- `spec/09 ## Integration acceptance` item 5: "paste an API key into a user prompt; key never appears in suggestions afterwards (shape gate)." Item 6: "quoted path completion, slash commands, and `@`-mention behaviors identical to stock pi."
- `spec/09 ## Tuning protocol`: "change one constant, run the acceptance suite, A/B against a fixed 3-session corpus fixture (test/fixtures/sessions/) checking precision@8."
- Perf gates: 20k-candidate query <1 ms p99; dict load + 20k lookups <60 ms; ingest 800 KB <60 ms; heap <6 MB; hard fail only >3× budget.

## Test inventory relevant to the fixes
- provider-match.test.ts (extractMatchState unit), provider.test.ts + provider-live.test.ts (never-hijack net, sentinel delegation, args identity), provider-display.test.ts (debounce), chain.test.ts + chaining-gating.test.ts + successors.test.ts (chain machine), calibration.test.ts (COMMON_PROBES: `posts` q≈47 mid-band/menu, `thin`/`firs` reject/delegate — lowercase, unaffected by proper-noun relief), shipped-dict.test.ts (calibration twin), acceptance.test.ts (§09 items 1-7 scripted, zephyr-chain.jsonl, real-dict), adversarial-ingest/typing, mask-secrets.test.ts, shapeGate.test.ts, score.test.ts (imports band constants), segment.test.ts, bigrams.test.ts (10k cap), store.test.ts, perf-gates.test.ts, no-persistence.test.ts.
- Helpers: dict-writer.ts (synthetic HAPX binary), editor-sim.ts (blind prefix-deletion mirror), query-invariants.ts (assertWordsOnly), session-fixture.ts; fixtures/sessions/*.jsonl.
- Suite last recorded green: 636 tests, tsc clean. Full re-run + `npm run check` is the regression gate for this bugfix.

## Docs surfaces
- docs/M1-DoD.md — evidence record; contains M2 re-verification sections for items 5/6/7 and a "Known accepted gap — successorIndex eviction cleanup"; update evidence as fixes land (Mode A) + add bugfix re-verification record (final task).
- README.md — headings: Features / Quick start / Usage / Architecture / Design invariants / Known limitations / Non-goals / Reference / Development. Known-limitations statements that reference the astral trade-off or secret-fragment non-goal must be revised by the final docs task.
- spec/*.md — READ-ONLY (product spec). plan/001_* and plan/002_* contain prior planning artifacts; do not touch.
