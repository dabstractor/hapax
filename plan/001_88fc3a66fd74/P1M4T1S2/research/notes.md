# Research notes — P1.M4.T1.S2 CI-scriptable micro-benchmarks

## Verified codebase facts

- `package.json` already has `"bench": "vitest bench"`; vitest 4.1.11 with
  tinybench 2.9.0 available. `npx vitest bench --help` works. Bench files are
  named `*.bench.ts` (default include) and placed anywhere (we use `test/`).
- `test/helpers/dict-writer.ts` exports:
  - `DictEntry` interface, `fnv1a(word, seed)`,
  - `buildDictBinary(entries: DictEntry[]): Buffer` — SYNTHETIC fixture
    generator (never touch `dict/common-en.bin` 1.3MB artifact),
  - `writeDictFile(path, entries)` convenience.
- `src/core/dictionary.ts`: `loadDictionary(path): Dictionary`,
  `DICT_VERSION = 1`. Dictionary exposes allocation-free `lookup(word)` →
  frequency | null. Loader throws on bad magic/truncated.
- `src/core/store.ts`: `class CandidateStore` — no constructor args.
  `upsert(sighting: Sighting)`, `nextOrdinal()`, `currentOrdinal()`,
  `prefixRange(prefix): [start, end]`, `sortedKeysSnapshot()`, `get(key)`,
  `STORE_CAP = 20_000`.
- `src/core/types.ts`: `Sighting { key, display, ordinal, fromUser,
  properName, rankGroup, isSubword, parentKey? }`, `RankGroup` enum.
- `src/core/query.ts`: `rankMatches(store, prefix, opts?)` — synchronous,
  `RankOptions { limit, suppress? }`, `DEFAULT_LIMIT = 8`. Doc explicitly
  anticipates this bench task ("If the P1.M4.T1.S2 bench pass ever shows
  huge hot ranges, partial top-N selection is the documented fallback").
- `src/pi/ingest.ts`: `IngestPipeline` with injectable
  `IngestPipelineOptions { store, dictionary, debounceMs?, chunkBytes?
  (default 65_536), yieldFn?, onAdmittedTokens? }`. `yieldFn?: YieldFn` —
  counting hook for yield-every-≤64KB assertion. `processText(text,
  fromUser)` is the chunked path (yield awaited between slices).
  `restoreFromHistory(sessionManager, pipeline, store)` exists but is NOT
  needed for benches — drive `processText` directly.

## Budget table (PRD §09 h2.51 + §02 h2.15)

| Gate | Budget | CI assert (3× headroom) |
|---|---|---|
| (a) 20k-candidate prefix query + rank + top 8 | < 1 ms p99 | p99 < 3 ms |
| (b) dict load + full lookup sweep of 20k words | < 60 ms | < 180 ms |
| (c) ingest 800 KB synthetic text | < 60 ms, yields every ≤64 KB | < 180 ms + yield count ≥ ceil(800k/65536) |
| (d) steady-state heap delta (dict + store) | < 6 MB | < 18 MB |

Loose assertion + log actuals; hard regression (> 3× budget) fails.

## Sibling contract (P1.M4.T1.S1, running in parallel)
- Creates `test/fixtures/sessions/*.jsonl` and `test/acceptance.test.ts`.
  Do NOT duplicate: our benchmarks use SYNTHETIC fixtures generated in the
  bench file (buildDictBinary for (b); programmatic store fill for (a);
  generated synthetic text for (c)) — no shared fixtures required.

## vitest bench notes
- Bench files `test/bench/*.bench.ts` (or `*.bench.ts` under test/) run via
  `npm run bench`. tinybench `bench`/`describe` API.
- Benchmarks alone don't hard-fail; budgets need explicit assertion —
  pattern: run measurement inside `bench()` for reporting AND a separate
  `expect`-style gate (vitest bench supports throwing in the bench fn, or
  use a plain `test()` in a `*.test.ts` that computes the same metric and
  asserts the 3× bound — safest: dedicated `test/perf-gates.test.ts` with
  plain vitest tests doing warmup + distribution measurement + assertions,
  PLUS `*.bench.ts` files for rich tinybench reporting via `npm run bench`).
  Decision per item description: "pick vitest bench for CI integration via
  npm run bench" → both: bench files for numbers, gate test for hard fail.
- p99 of 1000 repeats: measure per-iteration `performance.now()` deltas,
  sort, take index ⌈0.99·N⌉.
- Heap: `process.memoryUsage().heapUsed` before/after with forced GC
  unavailable in CI (no --expose-gc) → settle: measure before/after after
  warmup, tolerate noise via 3× margin; optionally run child process with
  `node --expose-gc` via execFile for precise GC'd measurement (keep simple:
  in-process delta with 3× margin is sufficient; note as fallback).