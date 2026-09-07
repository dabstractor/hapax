# PRP — P1.M1.T1.S2: src/core/types.ts — shared core contracts

---

## Goal

**Feature Goal**: Create `src/core/types.ts`, the single shared type vocabulary
for the entire hapax core pipeline, containing exactly the types specified in
PRD §04/§06 and the item contract. This file is pure declarations — zero
imports, zero runtime code — and becomes the one import source for all
downstream core modules (dictionary.ts, segment.ts, shapeGate.ts, score.ts,
store.ts, query.ts) and the pi adapter.

**Deliverable**: `src/core/types.ts` exporting: `RankGroup`, `Candidate`,
`Sighting`, `GateRejectReason`, `GateResult`, `Dictionary`, `IngestStats`,
`RankedMatch`. Optionally a small type-level smoke test at
`test/types.test.ts`.

**Success Definition**: `npm run check` (tsc --noEmit) exits 0 with the new
file included; the file contains no import statements whatsoever; every export
matches the exact shape below; `npm test` exits 0.

## Why

- Every later core module and the pi adapter (30+ downstream subtasks) imports
  these types by name. Duplicating the shapes anywhere else is explicitly
  forbidden by the contract — this file is the vocabulary.
- The two-layer architecture (`src/core/` pure vs `src/pi/` adapter) is
  load-bearing: **`src/core/**` must import NOTHING from pi packages** (enforced
  in review). A zero-import types.ts makes that trivially true from day one and
  sets the precedent for all core modules.
- See `plan/001_88fc3a66fd74/architecture/core_contracts.md` for the full
  handoff chain this file enables.

## What

Create `src/core/types.ts` with the declarations below (verbatim shapes, PRD
§04/§06 exactly). Add JSDoc comments citing the PRD section for each export.
No other files are modified except optionally adding a smoke test.

### Success Criteria

- [ ] `src/core/types.ts` exists and exports exactly: `RankGroup`, `Candidate`,
      `Sighting`, `GateRejectReason`, `GateResult`, `Dictionary`, `IngestStats`,
      `RankedMatch` (all as `export type` / `export interface`)
- [ ] `grep -c "^import\|^export .* from" src/core/types.ts` → 0 (no imports)
- [ ] Shapes match the Implementation Blueprint exactly
- [ ] `npm run check` → exit 0
- [ ] `npm test` → exit 0

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the file contents are fully
specified below; the scaffold (package.json, tsconfig, `src/core/.gitkeep`)
already exists from P1.M1.T1.S1.

### Documentation & References

```yaml
- file: plan/001_88fc3a66fd74/architecture/core_contracts.md
  why: Cross-module handoff contracts this file must express (Sighting shape,
        Dictionary contract, query result shape).
  critical: Dictionary is the ONLY touchpoint for commonness (quantized 0-255,
            null = absent). Sighting is the unit ingest feeds store.upsert.

- file: plan/001_88fc3a66fd74/P1M1T1S1/PRP.md
  why: The scaffold this task lands in — tsconfig (strict, NodeNext, noEmit,
        include src/**/*.ts + test/**/*.ts), vitest with test/ glob,
        `npm run check` = tsc --noEmit. Zero runtime dependencies.
  gotcha: No new devDependency is needed or allowed. No imports of any kind.

- PRD §06 (Candidate interface, verbatim) and §04 (gate reasons, rank groups,
  RankedMatch consumer) — reproduced in full in the Blueprint below.
```

### Current Codebase tree (after P1.M1.T1.S1 scaffold)

```bash
hapax/
├── package.json          # pi manifest, scripts: check/test/bench, devDeps only
├── tsconfig.json         # strict, NodeNext, noEmit, includes src/** + test/**
├── README.md             # stub
├── node_modules/         # ignored
├── dict/  tools/  test/  # .gitkeep placeholders
└── src/
    ├── core/             # .gitkeep  ← THIS FILE lands here
    └── pi/index.ts       # minimal stub factory
```

### Desired Codebase tree with files to be added

```bash
src/core/
├── .gitkeep              # may be removed once types.ts exists
└── types.ts              # THIS TASK — shared type vocabulary, zero imports
test/
└── types.test.ts         # THIS TASK (optional but recommended) — smoke test
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: src/core/** must import NOTHING — not from pi packages, not even
#   from other core files. types.ts is the leaf of the dependency graph.
# GOTCHA: tsconfig has "types": ["vitest/globals"] — test files may use
#   describe/it/expect without imports; src files get no ambient globals.
# GOTCHA: "module": "NodeNext" would require ".js" extensions on relative
#   imports — irrelevant here because there are NO imports.
# GOTCHA: Do NOT add salt/config types here — config schema belongs to
#   src/pi/config.ts (P1.M3.T1.S1); phrase types (PhraseEntry) are M2 and
#   will be added to store.ts / types.ts later — NOT in this task.
```

## Implementation Blueprint

### Exact file contents — `src/core/types.ts`

```typescript
/**
 * hapax shared core contracts.
 *
 * Single vocabulary for the core pipeline (segment → shapeGate → score →
 * store → query) and the pi adapter. PRD §04 (tokenization/scoring) and
 * §06 (candidate store).
 *
 * This module is pure declarations: NO imports, NO runtime code.
 * src/core/ must never import from pi packages (architecture invariant).
 */

/** Admission rank group. PRD §04: 0 = dictionary-absent (rare-by-default),
 * 1 = rare-but-attested (q < 120), 2 = mid-frequency (120 ≤ q < 220).
 * q ≥ 220 is rejected, never stored. */
export type RankGroup = 0 | 1 | 2;

/** A word admitted to the session store. One entry per lowercase key.
 *  PRD §06 verbatim. */
export interface Candidate {
  /** lowercase */
  key: string;
  /** most recent casing seen */
  display: string;
  /** occurrences this session */
  sessionCount: number;
  /** message ordinal at last sighting */
  lastSeenOrdinal: number;
  firstSeenOrdinal: number;
  /** sticky once true */
  userTyped: boolean;
  /** capitalized-initial seen at least once */
  properName: boolean;
  /** admission group (PRD §04) */
  rankGroup: RankGroup;
  isSubword: boolean;
}

/** The unit the ingest pipeline feeds `store.upsert`. Produced by
 *  segment + shapeGate + score for each admitted candidate occurrence. */
export interface Sighting {
  /** lowercase key */
  key: string;
  /** casing as seen this occurrence */
  display: string;
  /** message ordinal of this occurrence */
  ordinal: number;
  /** true when the occurrence came from a user message */
  fromUser: boolean;
  properName: boolean;
  rankGroup: RankGroup;
  isSubword: boolean;
  /** whole-token key when this sighting is a subword; absent for
   *  whole tokens (subword rankGroup ≤ parent group + 1, PRD §04) */
  parentKey?: string;
}

/** Why the shape gate rejected a candidate. PRD §04 shape-gate rules. */
export type GateRejectReason =
  | 'tooShort'
  | 'tooLong'
  | 'lowEntropy'   // char-entropy < 1.5 bits/char
  | 'unigramRun'   // single-char run ≥ 4
  | 'secret'       // secret-shaped string (always reject, not configurable)
  | 'consonantRun' // consonant run ≥ 6, no vowel/digit

/** Shape-gate result. `reason` present only when ok === false. */
export interface GateResult {
  ok: boolean;
  reason?: GateRejectReason;
}

/** Loader contract for the packed dictionary (dict/common-en.bin).
 *  Implementation lives in src/core/dictionary.ts (P1.M1.T2.S1) —
 *  this is the interface only. `lookup` returns the quantized commonness
 *  rank 0–255, or null when absent. Must allocate nothing per lookup. */
export interface Dictionary {
  lookup(word: string): number | null;
  readonly version: number;
  readonly entryCount: number;
}

/** Ingest counters owned by src/pi/ingest.ts; surfaced by /acwords. */
export interface IngestStats {
  wordsSeen: number;
  admitted: number;
  rejectedByGate: Record<GateRejectReason, number>;
}

/** Query result item from src/core/query.ts (PRD §04 query ranking;
 *  description provenance e.g. "session ×12" built by query.ts). */
export interface RankedMatch {
  key: string;
  display: string;
  description: string;
  salience: number;
}
```

Notes on deliberate choices:
- `GateResult` uses an optional `reason` field (as specified), **not** a
  discriminated union — match the contract exactly; do not "improve" it.
- `Dictionary` is an interface (contract only) — do NOT implement anything here.
- `IngestStats.rejectedByGate` is keyed by `GateRejectReason`, so every reason
  must appear (consumers initialize all keys to 0).
- `salience` on `RankedMatch` carries the computed query-time score
  (PRD §04 formula, implemented in score.ts later — not here).

### Optional smoke test — `test/types.test.ts`

```typescript
import type {
  RankGroup, Candidate, Sighting, GateRejectReason, GateResult,
  Dictionary, IngestStats, RankedMatch,
} from '../src/core/types';

describe('core type contracts', () => {
  it('exports the documented vocabulary', () => {
    // Type-level usage only; runtime assertions on values that must type-check.
    const candidate: Candidate = {
      key: 'nrel', display: 'NREL', sessionCount: 1,
      lastSeenOrdinal: 0, firstSeenOrdinal: 0, userTyped: false,
      properName: true, rankGroup: 0, isSubword: false,
    };
    expect(candidate.rankGroup satisfies RankGroup).toBe(0);

    const gate: GateResult = { ok: false, reason: 'secret' };
    expect(gate.reason satisfies GateRejectReason | undefined).toBe('secret');

    const match: RankedMatch = { key: 'nrel', display: 'NREL',
      description: 'session ×1', salience: 4.3 };
    expect(match.key).toBe('nrel');

    const stats: IngestStats = {
      wordsSeen: 0, admitted: 0,
      rejectedByGate: { tooShort: 0, tooLong: 0, lowEntropy: 0, unigramRun: 0,
                        secret: 0, consonantRun: 0 },
    };
    expect(Object.keys(stats.rejectedByGate)).toHaveLength(6);

    const dict: Dictionary = { lookup: () => null, version: 1, entryCount: 0 };
    expect(dict.lookup('x')).toBeNull();

    const s: Sighting = { key: 'nrel', display: 'NREL', ordinal: 1,
      fromUser: true, properName: true, rankGroup: 0, isSubword: true,
      parentKey: 'nrelconfig' };
    expect(s.parentKey).toBe('nrelconfig');
  });
});
```

(If `satisfies` on a literal trips older TS, plain assignments suffice — TS ^5
supports `satisfies`.)

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/core/types.ts
  - CONTENT: exactly as specified above (8 exports, JSDoc, zero imports)
  - PLACEMENT: src/core/types.ts (remove src/core/.gitkeep optionally)
  - NAMING: PascalCase interfaces/types exactly as contracted — do NOT rename
    or add fields; downstream subtasks import these by name

Task 2: CREATE test/types.test.ts (optional smoke test, recommended)
  - Follows scaffold vitest conventions (test/ glob, vitest/globals ambient)

Task 3: VALIDATE
  - npm run check → exit 0
  - npm test → exit 0 (1 test passing)
  - grep -E "^import|from '" src/core/types.ts → no matches
```

### Integration Points

```yaml
DOWNSTREAM CONSUMERS (do not implement — context only):
  - dictionary.ts (P1.M1.T2.S1): implements Dictionary
  - shapeGate.ts (P1.M2.T2): returns GateResult
  - score.ts (P1.M2.T3): consumes RankGroup, Dictionary.lookup output
  - store.ts (P1.M2.T4): stores Candidate, accepts Sighting via upsert
  - query.ts (P1.M2.T5): returns RankedMatch[]
  - ingest.ts (P1.M3.T2): accumulates IngestStats
  FORBIDDEN: duplicating any of these shapes in another file; adding
  config/phrase types here (config → src/pi/config.ts; phrases → M2).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
# Expected: exit 0, no errors (tsconfig already includes src/**/*.ts)

grep -nE "^import |^export .+ from " src/core/types.ts
# Expected: no output (zero imports — the purity gate)
```

### Level 2: Unit Tests

```bash
npm test
# Expected: exit 0; if test/types.test.ts added, "1 passed"
```

### Level 3: Integration

```bash
node --input-type=module -e "
import * as t from './src/core/types.ts';  # may not run under plain node; use jiti-free check:
" 2>/dev/null || true
# Prefer: npx tsc --noEmit already proves the module compiles; no runtime
# surface exists (pure types). Skip node execution — it is NOT a defect.
```

### Level 4: Domain-Specific

Not applicable — pure type declarations, no runtime behavior.

## Final Validation Checklist

- [ ] `npm run check` → exit 0
- [ ] `npm test` → exit 0
- [ ] `src/core/types.ts` has zero import statements
- [ ] All 8 exports present with exact names and shapes from the Blueprint
- [ ] No shape duplicated elsewhere; no config/phrase types added
- [ ] No changes to package.json, tsconfig, or any existing file
- [ ] plan/, spec/, .gitignore untouched

## Anti-Patterns to Avoid

- ❌ Do NOT import anything into types.ts (not even `type` imports)
- ❌ Do NOT rename fields or "improve" the contract (e.g., turning GateResult
  into a discriminated union) — downstream tasks import by exact shape
- ❌ Do NOT implement Dictionary here — interface only
- ❌ Do NOT add M2 phrase types or pi config types (scope creep)
- ❌ Do NOT add dependencies or modify the scaffold

---

**Confidence Score**: 10/10 — the deliverable is a fully-specified pure
declarations file; all contents are given verbatim and the scaffold contract
(P1.M1.T1.S1) is known.