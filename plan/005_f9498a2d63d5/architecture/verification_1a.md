# §1a landed-items spot-check — input for the drift report

Spec/*.md is READ-ONLY this run (AGENTS.md: pipeline agents record drift,
never edit spec). The PRD's §1a table lists deltas ALREADY LANDED — the
implementation session does ONE verification read pass (no edits expected)
and records any mismatch in the DoD gauntlet item's drift section. Expected
verdict: NONE FOUND.

| # | Landed delta | Evidence to spot-check (as cited by PRD §1a) |
|---|---|---|
| 1 | Rule 4c span semantics: "equals OR CONTAINED IN" deferral + overlapping/trailing-`_` straddle absorption (FOO_1_, q~z9_, X=1ZZ_; one span per character-class region) | commit 141610d; src/core/segment.ts:575–580 |
| 2 | Ingest chunk-boundary token carry ("a slice boundary never splits a token") | commits 4255690 + 390a8f1; src/pi/ingest.ts:402–428 ("BUG-004 fix") |
| 3 | R_eff(9) float-compare clarification; q=82 admits / q=83 rejects probes | test/score.test.ts:129 ("rEff ≈ 82.15, float compare, no rounding") |
| 4 | Reserved triggerChar (@, /, ") advisory warning; "warn" → "warning" notify level | src/pi/config.ts:135–162, 237, 246+ (post-merge collision check) |
| 5 | Ingest perf gate 60 → 180 ms CI bound + validation note | test/perf-gates.test.ts:309 ("3× the 60 ms budget", CI < 180) |
| 6 | store.test eviction: one pass / full 256-victim batch wording | test/store.test.ts:431 |
| 7 | M2 DoD journey re-themed Acme/Zephyr → Zorp/Zephra | test/acceptance.test.ts:838; fixtures (zephyr-chain.jsonl content, RESULTS.md) |
| 8 | ASCII `x` in fallback descriptions, never U+00D7 × | src/pi/query.ts:480, 530 ("session x${c.sessionCount}") |
| 9 | Widget-path chain arming at Tab-insert (arms at rec.key, tier !== 0 strict, fresh grant) | src/pi/widget.ts:1443–1460 (BUG-001 fix); spec documents landed code |

Drift-report format: any spec-vs-repo mismatch verbatim with file:line;
absence of findings is itself recorded ("NONE FOUND" — cf.
docs/M1-DoD.md:1166 precedent).
