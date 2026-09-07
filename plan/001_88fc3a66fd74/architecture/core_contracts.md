# Core Contracts — cross-module handoffs (downstream agents MUST keep these consistent)

Greenfield build order: types.ts → dictionary → segment → shapeGate → score → store
→ query (all pure, `src/core/`) → config/ingest/provider/index (`src/pi/`).

## Handoff chain (M1)

```
tools/build-dict.mjs ──writes──► dict/common-en.bin
dictionary.ts ──loadDictionary(path)──► Dictionary { lookup(word): number|null, version, entryCount }
segment.ts ──segment(text)──► SegToken[] { key(lower), display, properName, isSubword, wholeKey? }
shapeGate.ts ──passesShape(token)──► { ok: boolean, reason: GateRejectReason }
score.ts ──admit(quant|null, token)──► RankGroup 0|1|2 | reject
        ──salience(candidate, currentOrdinal)──► number
        ──compareCandidates(a,b)──► ordering
store.ts ──CandidateStore──► upsert(sighting), queryPrefix(prefix, n), evictIfOverCap(),
                              ordinal counter, stats
query.ts ──rankMatches(store, prefix, limit)──► RankedMatch[] { key, display, description }
ingest.ts(pi) ── extractText(message) → segment→gate→lookup→admit→store.upsert (chunked, debounced)
provider.ts(pi) ── trigger/threshold regex → store query → AutocompleteSuggestions {items, prefix}
index.ts(pi) ── factory wiring: session_start/message_end/session_shutdown(/before_agent_start M2)
```

## Contract details that MUST NOT drift

1. **Ordinal counter lives in the store** (`store.nextOrdinal()` at each message
   ingest; restore replays oldest→newest so final ordinals/casing are correct).
2. **Sighting shape** (segment+gate+score output → store input):
   `{ key: string(lower), display: string, ordinal: number, fromUser: boolean,
   properName: boolean, rankGroup: 0|1|2, isSubword: boolean, parentKey?: string }`.
   Subword admission clamp: subword rankGroup ≤ parent whole-token group + 1.
3. **Dictionary interface** is the ONLY touchpoint for commonness; quantized 0–255,
   `null` = absent. Admission bands 220/120 baked in score.ts.
4. **Query result** carries `description` provenance (`session ×12`) built by
   query.ts; provider maps it to `AutocompleteItem.description` verbatim.
5. **Provider emission** (provider.test.ts asserts the emission sequence):
   hapax returns either a fresh `{items, prefix}` (own match), the previous
   displayed set (within 100 ms display-debounce window), or
   `current.getSuggestions(...)` (delegation — path/slash completion untouched).
6. **Stats counters** (gate rejections by reason, words seen/admitted) are owned by
   ingest.ts and surfaced by /acwords; store owns size + rank-group histogram.

## Pitfalls encoded from research (see pi_extension_api.md)
- `getSuggestions` returns `Promise<AutocompleteSuggestions|null>` — build the
  object synchronously; never await I/O on that path.
- `prefix` includes the trigger char in trigger mode (`"#ze"`), bare fragment in
  threshold mode (`"ze"`).
- Assistant tool calls are `type === "toolCall"` (not "tool_use"); thinking blocks
  are `type === "thinking"` — both skipped.
- `ctx.ui.notify(msg, "warning")` (no "warn" level).
- Dictionary path: dual `__dirname`/`import.meta.url` resolution (jiti risk).
- `session_start` reasons include `reload`/`fork` with existing history — replay
  whenever history exists, not just startup/resume.
- Restore source: `ctx.sessionManager.getBranch()` reversed (primary),
  `getEntries()` filtered to `type === "message"` (fallback).

## M2 additions
- store.ts gains phrase layer: `PhraseEntry`, n-gram capture (within-line windows of
  admitted whole tokens), successor index `Map<string, {next,count}[]>` (top-3).
- query.ts gains phrase matching + constituent suppression (phrase salience =
  1.2 × Σ constituent salience + 2.0·log2(1+count) when repetition-path).
- provider.ts gains chain state machine (armed(W)), reset on `before_agent_start`.
- config `enablePhrases` exists in M1 schema but is INERT until M2.