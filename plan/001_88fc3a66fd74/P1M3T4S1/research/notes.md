# Research notes — P1.M3.T4.S1 registerCommand('acwords')

## pi extension API (verified)

- `pi.registerCommand(name, { description, handler })` — verified in
  `node_modules/@earendil-works/pi-coding-agent` and pi docs
  (`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`,
  section "### pi.registerCommand(name, options)", ~line 1525).
- Handler signature: `async (args: string, ctx: ExtensionContext) => void`.
- `ctx.ui.notify(message, type?)` where type is `"info" | "warning" | "error"`.
  There is NO `"warn"` level (PRD §08 says "warn" — use `"warning"`).
- Registered command shows as `/name`. Duplicate names across extensions get
  numeric suffixes — fine, hapax is the only registrant of `acwords`.
- `registerCommand` lives on the ExtensionAPI surface
  (`dist/core/extensions/types.d.ts` line ~946: `registerCommand(name: string,
  options: Omit<RegisteredCommand, "name" | "sourceInfo">): void`).
- Config is loaded per-session in `session_start` (P1.M3.T5.S1 wiring); so
  registration belongs inside the session_start handler, guarded by
  `config.debug === true`. Item contract notes guard `ctx.hasUI` / mode tui for
  widget output — for M1 we only use `ctx.ui.notify`, which is UI-mode
  appropriate; no widget needed.
- Registration is per-session; pi tolerates re-registration on
  session_start 'reload' (contract explicitly allows).

## Inputs available today

- `CandidateStore` (src/core/store.ts): `entries()` (defensive copies),
  `size`, `rankGroupHistogram()` → `Record<RankGroup, number>` keys 0/1/2,
  `currentOrdinal()`.
- `salience(c, currentOrdinal)` exported from src/core/score.ts — reuse for
  top-50 ordering; `compareCandidates(a, b, now)` exists but sorts asc? No —
  it returns salience desc order (query ranking); simplest: map entries →
  salience, sort desc, take 50.
- `IngestPipeline.getStats()` (src/pi/ingest.ts) → `IngestStats`
  `{ wordsSeen, admitted, rejectedByGate: {tooShort,tooLong,lowEntropy,
  unigramRun,secret,consonantRun} }` (copy, safe to render).
- `HapaxConfig.debug: boolean` exists (src/pi/config.ts), default false.
- `IngestStats` type in src/core/types.ts (~line 92).

## Entry point state

- src/pi/index.ts is currently an empty stub; P1.M3.T5.S1 will build the
  factory. Therefore THIS task delivers `src/pi/debug.ts` exporting a
  registration function + formatter that T5.S1 calls inside session_start
  when `config.debug === true`. Pure, testable without a live pi.
- No "Debug" section in README.md yet (grep found none) — Mode A: add one.

## Test conventions

- vitest, ESM `.js` import suffixes, module doc-comment headers,
  describe/it, see test/ingest-pipeline.test.ts.
- `npm run check` (tsc --noEmit), `npm test` (vitest --run).
- pi types importable: `import type { ExtensionAPI } from
  "@earendil-works/pi-coding-agent"` (dep ~0.84.4 in devDependencies).