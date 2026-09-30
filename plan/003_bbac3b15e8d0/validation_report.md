# hapax — Comprehensive Validation Report

**Date:** 2026-09-30 · **Repo:** `/home/dustin/projects/hapax` (branch `main`, HEAD `b353323`, clean tree)
**Environment:** Linux x64 · Node v26.10.0 · vitest 4.1.11 · pi-tui 0.84.4
**Validation agent:** read-only analysis + `./validate.sh` (8 phases) + independent out-of-tree E2E probes.

---

## Verdict

**Issues found: 3 major (functional spec deviations in path handling), 4 minor
(spec/artifact drift + repo hygiene).** Everything else is in exceptional
shape: typecheck clean, **1007/1008 tests pass** (1 pre-existing documented
skip), all performance gates within budget, the shipped dictionary is
internally consistent and matches every spec-pinned admission verdict, the
secrets gate holds against a realistic pasted-key battery, and the pinned
pi-tui runtime contracts (verified against the installed 0.84.4 source)
hold.

---

## Methodology

1. **Deep code review** of all 7 core modules and all 7 pi-layer modules
   against `spec/` (which matches the PRD verbatim at every distinctive rule
   checked: R_eff sqrt curve, salience weights 2.0/3.0/1.5/0.8/1.0, τ=50
   eviction, tier/frequency/length/lex ranking, plural pruning, fuzz tier
   constants 100/85/40/50/5/15, config schema + clamps, debounce 300/100 ms,
   64 KB chunking, STORE_CAP 20,000, bigram cap 10,000).
2. **`./validate.sh`** — 8 phases: typecheck, full test suite, benchmarks,
   independent dictionary parse (FNV-1a + linear probing re-implemented from
   the spec, zero hapax code), calibration drift gates, dictionary build
   round-trip, E2E user journeys, hygiene invariants.
3. **E2E user journeys** driven through the **real** ingest pipeline +
   **shipped** dictionary (not mocks), mirroring documented workflows:
   README/spec §09 items 1–7 — happy path, anchored-fuzzy tiers, plural
   pruning, conversational paths + technical literals, secrets, prose-only
   no-menu, zero-typed-char chaining, structural-start properName, rule-3/4
   segmentation pins.
4. **Runtime-contract verification** against the installed
   `@earendil-works/pi-tui@0.84.4` source (the four PINs in provider.ts),
   incl. the single-item forced fast path at `editor.js:1902`.

### Phase results

| Phase | Result |
|---|---|
| 1/8 typecheck (`tsc --noEmit` strict) | PASS |
| 2/8 unit+integration (`npm test`) | PASS (1007 passed, 1 skipped) |
| 3/8 perf benchmarks (`npm run bench`) | PASS (all gates within budget) |
| 4/8 shipped dictionary integrity (independent parser) | PASS (HAPX v1, self-consistent, 48,802 entries, LF 0.745) |
| 5/8 calibration drift gates (`calibrate-bands.mjs`) | PASS (all R_eff verdicts match spec pins) |
| 6/8 dictionary build round-trip | PASS (16/16 entries verified, no dupes) |
| 7/8 E2E user journeys | **FAIL — 4/26 probes** (documented findings #1–#3 below) |
| 8/8 hygiene + invariants | PASS (notes below) |

---

## Findings

### MAJOR 1 — `maskSecrets` bare-run rule silently destroys long path candidates

**Spec violated:** §04 rule 4d (paths are whole-token candidates, key cap **96**
chars); §09 integration item 7 (`sr` → `src/core/query.ts`).
**Location:** `src/core/shapeGate.ts` — `BARE_ALNUM_RUN_RE`
(`[0-9a-zA-Z/+]{32,}`, `BARE_RUN_MIN = 32`), rule 11 of `SECRET_WINDOW_RES`,
run at the raw-text layer before `tokenize()`.
**Effect:** any path whose pre-`.`/`-` span reaches **32 unbroken
`[0-9a-zA-Z/+]` characters** is masked wholesale as a suspected secret and
never becomes a candidate — no completion, ever. `/` was added to the
bare-run alphabet for AWS secret keys (BUG-003), but it is also the path
separator.

Reproduced (deterministic):

```
maskSecrets("see /home/user/projects/hapax/README.md now")
  → "see                                 .md now"   # whole path blanked
store.get("home/user/projects/hapax/readme.md")  → undefined
rankMatches(store, "ho")                          → []

maskSecrets("deploy to /srv/continuous/integration/deployments/release today")
  → path never tokenizes (32-char unbroken run)     # E2E probe FAILS
```

Note the spec's own §09 example (`/home/user/projects/hapax`, 24 chars)
survives — by 8 characters. `segment.test.ts`'s 96-char path-cap test calls
`tokenize()` directly, bypassing the ingest-layer masking, so the entire
class is invisible to unit tests. Casualty class: long conversational paths
(deep repo paths, deployment paths) and, collaterally, any ≥32-char
unbroken alphanumeric identifier (e.g. very long jargon words).
**Not** in the spec's documented-gaps list for 4d — undocumented deviation.

### MAJOR 2 — sentence-final paths glue the trailing period into key AND display

**Spec violated:** §04 rule 4c guard ("trailing sentence periods never glue
(`fox.` stays `fox`)") as applied to the path family; §04 4d display intent.
**Location:** `src/core/segment.ts` — `classifyPath()` edge-trim strips
leading `/ ~ .` and a trailing `/`, but **not** a trailing `.`.

Reproduced: `"open src/core/query.ts. then close it."` → candidate
key = display = **`src/core/query.ts.`** — Tab inserts the sentence period,
and the same path seen mid-sentence forks a second, distinct candidate
(`src/core/query.ts` ≠ `src/core/query.ts.`).

```
displays(store, "sr") → [ 'src/core/query.ts.' ]   # E2E probe FAILS
```

### MAJOR 3 — `:line:col` trim defeated when a sentence period follows the digits

**Spec violated:** §04 rule 4d: "A trailing `:digits(:digits)?` is trimmed …
(`src/foo.ts:42:13` → `src/foo.ts`) — the user retypes the path, not the
line numbers" (pinned again in §09's test list).
**Location:** `src/core/segment.ts` — pass 4 classification order. The
LITERAL_RE maximal run swallows the sentence-final `.`; the colon-tail regex
`(?::\d+){1,2}$` then fails to match the `.`-terminated run, `classifyPath`
returns null, and `classifyLiteral` (which trims the trailing `.`) admits
the run as a 4c **literal** with the line:col suffix intact.

Reproduced: `"jump to src/core/query.ts:42:13 for the first. also
src/core/query.ts:42:13. end."` → the sentence-final occurrence stores
**`src/core/query.ts:42:13`** (class literal), the mid-sentence one stores
`src/core/query.ts` (class path) — two different candidates for one visible
path, and Tab on the former inserts line numbers.

```
displays(store, "sr") → [ 'src/core/query.ts:42:13' ]  # E2E probe FAILS
```

(`segment.test.ts:775` covers only the mid-sentence form; `:796` pins the
deliberate `a/b.ts:42:13:99` literal fallback — the sentence-period trigger
of the same class-flip is the unintended variant.)

### MINOR 4 — spec §09 M2 definition-of-done item 7 is unsatisfiable at default config

The spec's M2 DoD journey — "accept `National` → … `Renewable` → Tab →
`Energy` → Tab → `Laboratory`" — cannot run with the shipped dictionary and
default `rejectCommonness=12`: `national` (8c, q=90) and `energy` (6c,
q=94) reject at their floor lengths, so the bigram never forms. The code
*deliberately* pins this (`test/acceptance.test.ts` ~L1070 inverts the PRD
probe — `'na'` → zero candidates — and `test/fixtures/sessions/RESULTS.md`
re-themed the journey to "Acme Zephyr Noria Inverter" for exactly this
reason). The behavior is tested and intentional; **the spec text was never
reconciled**, and per AGENTS.md's binding spec-maintenance policy
("spec must match what's in the code") this is un-reconciled drift: §09's
DoD-M2 line still demands a journey the shipped system cannot perform, and
spec §04/§09 still cite the NREL walk as the canonical chain example.

### MINOR 5 — spec §02 module layout omits three shipped modules

`src/pi/` contains `editor.ts` (referenced in §07 prose), `debug.ts` (the
§08 `/acwords` command) and `paths.ts` (dictionary path resolution,
referenced nowhere in the spec). §02's module-layout tree lists only
index/ingest/provider/widget/config. Same drift class as #4.

### MINOR 6 — tracked non-source artifacts in the repo root

- `url` — a one-line stray paste of a GitHub secret-scanning unblock link
  (`https://github.com/dabstractor/pi-autocomplete/security/secret-scanning/unblock-secret/…`).
  Looks accidental; also mildly sensitive-looking.
- `audit-output.txt` — a 6,765-line full-store debug dump committed at root.

Both are `git ls-files`-tracked. Hygiene only; no runtime impact (the
no-persistence invariant concerns runtime, and the runtime invariant holds).

### MINOR 7 — spec §03 numeric claims vs shipped artifact

- §03 claims "load factor ≤ 0.55 / ~1.1 probes average"; the shipped
  artifact runs at **0.745** (48,802/65,536). The artifact *follows* §03's
  own bucketCount rule (next pow2 ≥ 1.3N ⇒ LF ≈ 0.74–0.77 at this N) — the
  0.55 prose was written for the nominal 70k table and is internally
  inconsistent with the rule; perf is unaffected (bench gates pass).
- Decision log "Top ~60–80k English frequent words" vs shipped **48,802**
  entries (50k-word vendored corpus). Format + build conform; the entry-count
  expectation is stale.
- `tools/calibrate-bands.mjs` prints the retired band as
  `group2(20≤q<12)` — an inverted empty range (legacy label written for the
  old constants; dev-tool cosmetic only).

---

## Verified sound (highlights)

- **Admission pipeline**: every spec-pinned verdict reproduced via
  `calibrate-bands.mjs` against the shipped artifact (`provider`/`default`/
  `enable`/`cache`/`node` reject on the floor hold; `everything` q=139 ≥
  R_eff(10)=111 rejects; `government` q=101 admits g1; `configurations`
  admits g0; `uploads` guard-rejects; `handoff` q=10 stays; relief dead;
  group 2 dead; q monotone over top 500 ranks).
- **Secrets (acceptance item 5)**: a battery of realistic pasted keys
  (OpenAI sk-, GitHub PAT, AWS key+secret, Slack xoxb-, cards, glpat-,
  npm_) run through the real ingest pipeline — none surface in any
  suggestion across the whole-store scan; ordinary words in the same
  message do.
- **Never-hijack prose invariant**: a pure-prose paragraph ingests to a
  store yielding zero candidates for every probed prefix.
- **Chaining (M2)**: zero-typed-char successor chains form over admitted
  words; comma breaks the bigram window (spec §06); every chain item is
  single-word (one-word invariant).
- **Structural-start properName**: mid-sentence capitals keep the hint;
  line-initial, `Done. `, and bullet-prefixed capitals do not.
- **Segmentation pins**: Þórhildur/ΩbsidianMirror yield nothing (rule 3);
  `and/or` and `a/../b` reject; compounds/filenames/hexish/literals behave
  per spec; `--flag`/`don't` pins hold.
- **pi-tui PINs** (fallback path): `force && explicitTab && items.length
  === 1` single-item fast path confirmed at `editor.js:1902` of the
  installed 0.84.4.
- **Architecture invariants**: `src/core` is pi-free; zero runtime
  dependencies; extension wiring defers all work to `session_start`;
  `message_end` never returns a value; no persistence anywhere.

## Reproduction

All three major findings reproduce via `./validate.sh` (phase 7 fails with
exactly the four documented probes), or directly:

```sh
node tools/calibrate-bands.mjs provider everything government configurations uploads
npx vitest --run   # 1007 pass — the bugs live in the unit/integration seam
./validate.sh      # phase 7/8 shows the path findings deterministically
```
