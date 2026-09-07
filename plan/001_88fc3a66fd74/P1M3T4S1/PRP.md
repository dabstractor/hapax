# PRP — P1.M3.T4.S1: registerCommand('acwords') store/stats dump

## Goal

**Feature Goal**: Implement the `/acwords` debug command (PRD §08 h2.48) — a
read-only inspection command registered with pi only when `config.debug ===
true` — that dumps, via `ctx.ui.notify`: top-50 candidates by salience
(display + sessionCount + rankGroup), store size, rank-group histogram, and
shape-gate rejection counts.

**Deliverable**: NEW file `src/pi/debug.ts` (pure, pi-importable helper:
formatter + registration function) + NEW `test/debug.test.ts` + a new
"Debug" section in `README.md`. No changes to existing src files.

**Success Definition**: `npm run check` clean, `npm test` green including the
new suite; the formatter is fully unit-tested against a real `CandidateStore`
and real `IngestStats` shape; the registration function guards on
`config.debug` and is ready for P1.M3.T5.S1 to wire inside `session_start`.

## User Persona

**Target User**: hapax developer (this repo's maintainer) running the PRD §09
tuning protocol in a live pi session.

**Use Case**: During tuning, type `/acwords` to see what the ingest pipeline
actually admitted this session — which words earned menu space, how full the
store is, and which shape-gate rules are firing.

**Pain Points Addressed**: Today there is zero observability into the
CandidateStore / IngestStats from a live session; tuning the admission bands
and salience weights is guesswork without it.

## Why

- PRD §08 h2.48 requires the debug command; §09 (tuning protocol) depends on
  it as the primary measurement instrument.
- P2.M2.T3.S1 will EXTEND this dump (top-10 phrases + successor index sample)
  — the formatter must be structured so an M2 section can be appended without
  rewriting it.

## What

When `config.debug === true` (PRD §08 schema: `"debug": false` default), the
extension registers a pi command named `acwords` → `/acwords`. Its handler is
read-only: it renders a multi-line string and passes it to
`ctx.ui.notify(message, "info")`. It NEVER logs message bodies — the store
holds only words + counters (PRD §08), and the formatter reads exclusively
from `CandidateStore` and `IngestPipeline.getStats()`.

### Dump format (exact sections, in order)

```text
hapax candidate store
  size: 1234 / 20000   (ordinal 42)
  rank groups: rare=… mid=… common=…

  top 50 by salience:
    1. zendesk          ×7   group 0 (rare)
    2. NREL             ×3   group 1 (mid)
    …

ingest stats
  words seen: 5432   admitted: 1234
  gate rejections: tooShort=… tooLong=… lowEntropy=… unigramRun=… secret=… consonantRun=…
```

(Salience value itself need not be printed; count + group are the tuning
signal. Exact label wording is up to the implementer as long as every
contract datum is present and grep-able: top-50 rows with display, count,
group; store size; cap; ordinal; three-group histogram; wordsSeen; admitted;
all six gate-reject counts.)

### Success Criteria

- [ ] `src/pi/debug.ts` exports `formatAcwordsDump(store, stats)` (pure
      string builder) and `registerAcwordsCommand(pi, { store, pipeline,
      config })`
- [ ] Command registered ONLY when `config.debug === true`; nothing
      registered otherwise
- [ ] Top-50 ordered by `salience()` descending (ties: byte-lexicographic
      key order for determinism); fewer than 50 entries → dump them all
- [ ] Output never contains any message text — only keys/counters from the
      store snapshot and stats copy
- [ ] `README.md` gains a "Debug" section documenting `debug: true` and
      what `/acwords` prints
- [ ] `npm run check` and `npm test` green

## All Needed Context

### Context Completeness Check

The implementing agent needs: pi's `registerCommand` signature, `notify`
levels, the store/stats accessors, salience import, config flag, and repo
test conventions. All verified and cited below.

### Documentation & References

```yaml
- url: ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  section: "### pi.registerCommand(name, options)"
  why: VERIFIED API — pi.registerCommand(name, { description, handler:
    async (args, ctx) => void }); handler ctx has ctx.ui.notify(message,
    "info" | "warning" | "error").
  critical: There is NO "warn" notify level — the PRD §08 prose "warn" must
    be mapped to "warning" if ever used (this task only uses "info").

- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: registerCommand: (name: string, options: Omit<RegisteredCommand,
    "name" | "sourceInfo">): void (line ~946); notify signature (line ~76).
    Type-checking source of truth available in this repo's devDependencies
    (~0.84.4).

- file: src/core/store.ts
  why: Consumer API — entries() returns defensive shallow copies; size;
    rankGroupHistogram() → { 0: n, 1: n, 2: n }; currentOrdinal().
  pattern: build top-50 from store.entries() + salience(); never iterate
    internals (they're #private).

- file: src/core/score.ts
  why: salience(c: Candidate, currentOrdinal: number): number — reuse; do
    NOT reimplement. Exported.

- file: src/pi/ingest.ts
  why: IngestPipeline.getStats() returns a defensive copy of IngestStats
    { wordsSeen, admitted, rejectedByGate: { tooShort, tooLong, lowEntropy,
    unigramRun, secret, consonantRun } }. The registration function takes
    Pick<IngestPipeline, "getStats"> so tests can pass a stub.

- file: src/pi/config.ts
  why: HapaxConfig { ..., debug: boolean }; DEFAULT_CONFIG.debug === false.

- file: src/core/types.ts
  why: Candidate { key, display, sessionCount, rankGroup: 0|1|2, ... } and
    IngestStats (~line 92). RankGroup labels: 0 = rare, 1 = mid, 2 = common
    (per admission bands 220/120 in src/core/score.ts).

- file: test/ingest-pipeline.test.ts
  why: vitest conventions — ESM ".js" import suffixes on relative imports,
    module doc-comment header, describe/it naming.

- file: plan/001_88fc3a66fd74/P1M3T4S1/research/notes.md
  why: Verified API excerpts + entry-point state summary.
```

### Current Codebase tree (relevant)

```
src/pi/index.ts      # stub — full factory is P1.M3.T5.S1 (planned)
src/pi/config.ts     # complete (P1.M3.T1.S1), has debug flag
src/pi/ingest.ts     # complete, has getStats()
src/pi/provider.ts   # landing in parallel (T3) — NOT touched by this task
src/core/{store,score,types}.ts  # complete (P1.M2)
test/*.test.ts       # vitest suites
README.md            # no "Debug" section yet
```

### Desired additions

```
src/pi/debug.ts      # NEW — formatAcwordsDump + registerAcwordsCommand
test/debug.test.ts   # NEW — unit tests for both exports
README.md            # MODIFIED — add "Debug" section (only edit to an existing file)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: pi's notify levels are "info" | "warning" | "error" — "warn"
//   (as written in PRD §08 prose) does not exist and will fail type-check.
// CRITICAL: src/pi/index.ts is a stub until P1.M3.T5.S1 — do NOT build the
//   factory here. Deliver the registration helper; T5.S1 wires it inside
//   session_start (config is loaded there) and re-registration on
//   session_start 'reload' is explicitly acceptable (item contract).
// GOTCHA: registration is per-session — the function may be called again
//   on reload; pi tolerates duplicate names (numeric suffixes), and the
//   item contract deems idempotent re-registration acceptable.
// GOTCHA: take store.entries() ONCE and stats ONCE (getStats already
//   copies) so the rendered dump is a consistent snapshot.
// GOTCHA: salience needs currentOrdinal() — capture it once and reuse for
//   every row (mixed "now" values would produce a bogus ordering).
// GOTCHA: tie-break equal salience with byte-lexicographic key order so
//   the output is deterministic (mirror compareCandidates's final tie-break).
// GOTCHA: ESM ".js" import suffixes on ALL relative imports (repo-wide).
// GOTCHA: keep formatting allocation-light (a single template-literal
//   build over ≤ ~50 rows is fine); this is a manual command, not hot path.
// PRIVACY (PRD §08): output contains words + counters ONLY — never message
//   bodies. The store physically cannot leak bodies; do not add any other
//   text source to the dump.
```

## Implementation Blueprint

### Module shape

```ts
/**
 * /acwords debug command (PRD §08 h2.48, P1.M3.T4.S1): read-only store
 * and ingest-stats dump registered with pi only when config.debug.
 * Formatter is pure; registration is a thin pi adapter that
 * P1.M3.T5.S1 wires inside session_start. M2 (P2.M2.T3.S1) appends a
 * phrases section to the dump.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { salience } from "../core/score.js";
import type { CandidateStore } from "../core/store.js";
import type { IngestStats } from "../core/types.js";

export function formatAcwordsDump(store: CandidateStore, stats: IngestStats): string;

export function registerAcwordsCommand(
  pi: ExtensionAPI,
  deps: {
    store: CandidateStore;
    pipeline: Pick<IngestPipeline, "getStats">; // import type from ingest.js
    config: Pick<HapaxConfig, "debug">;
  },
): void;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/pi/debug.ts
  - IMPLEMENT formatAcwordsDump(store, stats): pure function
    - snapshot = store.entries(); ordinal = store.currentOrdinal()
    - rows = snapshot.map(c => ({ c, s: salience(c, ordinal) }))
      .sort(s desc, then key byte-lex asc).slice(0, 50)
    - sections exactly per "Dump format": header, size/`STORE_CAP`/ordinal,
      rankGroupHistogram() as rare/mid/common, numbered top-50 rows
      (display, ×sessionCount, group n (label)), ingest stats (wordsSeen,
      admitted, all six rejectedByGate counts)
    - import STORE_CAP from ../core/store.js for the denominator
  - IMPLEMENT registerAcwordsCommand(pi, deps): if (!deps.config.debug) return;
    pi.registerCommand("acwords", {
      description: "hapax: dump candidate store stats",
      handler: async (_args, ctx) => {
        ctx.ui.notify(formatAcwordsDump(deps.store, deps.pipeline.getStats()), "info");
      },
    });
  - NAMING: exports above, snake-free camelCase per repo style
  - DOC: module header citing PRD §08 h2.48 + this task id

Task 2: CREATE test/debug.test.ts
  - FIXTURES: real CandidateStore — upsert sightings via store.upsert
    (check Sighting shape in src/core/types.ts; ordinals from
    store.nextOrdinal()) with varied keys/counts/rankGroups; a plain
    object { getStats: () => fakeStats } for the pipeline (IngestStats
    literal with all six gate keys — see emptyGateCounts in ingest.ts);
    a fake pi: { registerCommand: vi.fn() } cast as ExtensionAPI.
  - CASES:
    - dump contains store size, ordinal, cap denominator
    - top-50 ordered by salience desc; ties deterministic (same count/
      recency → key order)
    - >50 candidates → exactly 50 rows; <50 → all rows, no empty padding
    - histogram line has all three groups (rare/mid/common)
    - stats section renders wordsSeen, admitted, all six gate counts
    - display casing shown (upsert "NREL" → row shows NREL), sessionCount
      rendered as ×N
    - registerAcwordsCommand with debug:false → registerCommand NEVER called
    - with debug:true → called once with name "acwords"; invoking the
      captured handler's ctx.ui.notify (vi.fn) yields a string containing
      the size line and stats line
    - never contains message text (assert a fixture word absent from a
      second dump built from an empty store — trivially structural)
  - NAMING: describe("acwords dump (PRD §08)"), it("<scenario>")
  - CONVENTIONS: follow test/ingest-pipeline.test.ts (ESM ".js" imports,
    module doc-comment header)

Task 3: MODIFY README.md — ADD "Debug" section (Mode A, rides with the work)
  - PLACEMENT: after the existing configuration/status content; keep the
    file's tone (plain, factual, current-state)
  - CONTENT: set `"debug": true` in ~/.pi/agent/hapax.json or
    .pi/hapax.json → /acwords becomes available (registered at session
    start); bullet list of what it prints (top-50 by salience with counts
    and groups, store size vs 20k cap, rank-group histogram, gate rejection
    counts); note it is read-only and never prints message bodies; note
    M2 will extend it
```

### Integration Points

```yaml
WIRING (NOT this task): P1.M3.T5.S1 calls registerAcwordsCommand(pi,
  { store, pipeline, config }) inside its session_start handler after
  loadConfig; this task must only export the function with that shape.
DOWNSTREAM: P2.M2.T3.S1 appends phrase/successor sections to
  formatAcwordsDump — keep section building factored so an M2 section can
  be added in one place.
NO changes to: src/pi/index.ts (leave the stub), src/pi/provider.ts,
  any core file, package.json, tsconfig.json, existing tests.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors (test files type-checked too)
```

### Level 2: Unit Tests

```bash
npm test -- test/debug.test.ts   # new suite green
npm test                          # full suite green (no regressions)
```

### Level 3: Integration

None scriptable yet — live `/acwords` verification rides P1.M3.T5.S1
(dev-load) and P1.M4.T1.S1 acceptance. The debug:true registration-false/
true unit cases are this task's integration proxy.

## Final Validation Checklist

- [ ] `npm run check` clean; `npm test` fully green
- [ ] `src/pi/debug.ts` exports formatAcwordsDump + registerAcwordsCommand
- [ ] Command registered only when debug:true; notify level "info" (never "warn")
- [ ] Top-50 salience-desc with deterministic ties; all contract data present
      (size, cap, ordinal, 3-group histogram, wordsSeen, admitted, 6 gate counts)
- [ ] Dump contains words/counters only — no message bodies
- [ ] README.md "Debug" section added; no other existing file modified
      (src/pi/index.ts stub untouched)
- [ ] ESM ".js" import suffixes throughout; module doc-comment headers

## Anti-Patterns to Avoid

- ❌ Don't wire anything into src/pi/index.ts — that's P1.M3.T5.S1
- ❌ Don't reimplement salience or read store internals — use entries() +
  salience() from score.ts
- ❌ Don't use "warn" as a notify level — it doesn't exist
- ❌ Don't sort by sessionCount instead of salience — the contract is
  salience ordering
- ❌ Don't capture currentOrdinal() per row — one "now" for the whole dump

## Confidence Score

9/10 — API signature verified against installed types; all consumer surfaces
(store, stats, config, salience) read in full; only external unknown is
T5.S1's exact call site, which this PRP constrains by export shape.