# Research Notes — P1.M3.T3.S2 (Live synchronous query + AutocompleteSuggestions mapping)

## Verified facts from codebase (read directly, no subagent needed)

### pi-tui AutocompleteProvider contract (`node_modules/@earendil-works/pi-tui/dist/autocomplete.d.ts`)
```ts
export interface AutocompleteItem { value: string; label: string; description?: string; }
export interface AutocompleteSuggestions { items: AutocompleteItem[]; prefix: string; }
export interface AutocompleteProvider {
    triggerCharacters?: string[];
    getSuggestions(lines: string[], cursorLine: number, cursorCol: number,
        options: { signal: AbortSignal; force?: boolean }): Promise<AutocompleteSuggestions | null>;
    applyCompletion(lines: string[], cursorLine: number, cursorCol: number,
        item: AutocompleteItem, prefix: string): { lines: string[]; cursorLine: number; cursorCol: number; };
    shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
}
```
- `options.signal` is a plain `AbortSignal`; `force` is optional.
- `applyCompletion` is SYNCHRONOUS and returns the new buffer/cursor (not a Promise).
- `shouldTriggerFileCompletion` is optional — must use `current.shouldTriggerFileCompletion?.(...) ?? true`.
- Re-export path `@earendil-works/pi-tui` exports the types from index.

### rankMatches (`src/core/query.ts`)
```ts
export function rankMatches(store: CandidateStore, prefix: string, opts?: RankOptions): RankedMatch[]
// RankOptions = { limit?: number; suppress?: (c: Candidate) => boolean }
```
- Pure + synchronous; lowercases prefix internally (prefixRange throws on uppercase — handled inside).
- Returns `[]` when nothing matches (delegate signal).
- `RankedMatch = { key; display; description; salience }` — `description` already formatted `"session x<count>"` (ASCII x).

### Config (`src/pi/config.ts`)
- `HapaxConfig.triggerChar: string` (default `"#"`, `""` disables), `threshold`, `maxSuggestions: number` (default 8, clamped 1–20).

### S1 sibling contract (`plan/001_88fc3a66fd74/P1M3T3S1/PRP.md`)
- `src/pi/provider.ts` will export:
  `type MatchState = { mode: "trigger"|"threshold"; fragment: string; prefix: string }` and
  `extractMatchState(lines, line, col, config): MatchState | null` — pure, synchronous, no pi runtime imports.
- `null` = delegate. `prefix` for trigger mode = triggerChar + fragment (consumed on apply); for threshold mode = fragment.
- S1 owns `test/provider-match.test.ts`; S2 must NOT touch it (test files are per-concern).

### Store & conventions
- `src/core/store.ts` exports `class CandidateStore`; index.ts (P1.M3.T5.S1, future) will construct it and call `createHapaxProvider`.
- Repo: ESM `.js` import suffixes, vitest `--run`, `npm run check` = `tsc --noEmit`, module doc-comment style (see query.ts).

## Design decisions feeding the PRP
- Live-result cache: module-level per-provider mutable state `lastLive: { matches: RankedMatch[]; prefix: string; ts: number } | null`, exposed via a getter consumed by S3 (debounce) and P2.M2.T2.S1 (chain arming).
- Chain-arming tag for M2: description already `"session x<n>"`; tag hapax items via an internal `value -> key` side map (`liveKeyByValue: Map<string,string>`) so Tab acceptance is later detectable without polluting `description`.
- Zero-candidate and aborted and null-state paths all return `current.getSuggestions(...)` with args passed through UNCHANGED.