# Ingest / Segment Recon — bigram adjacency rule + Unicode boundary rejection

All paths relative to `/home/dustin/projects/hapax`.

## 1. IngestPipeline (src/pi/ingest.ts, 529 lines)

### Class shape
- `export class IngestPipeline` (line ~156). Private fields (lines ~162–180):
  `#store: CandidateStore`, `#dictionary: Dictionary`, `#debounceMs` (default 300),
  `#chunkBytes` (default 65_536), `#yieldFn: YieldFn`,
  `#onAdmittedTokens?: (lines: string[][]) => void`,
  `#onSweepPhrases?: () => void`, `#isDisabled?: () => boolean`,
  `#pending: { text: string; fromUser: boolean }[]`, `#timer`, `#drain`, `#stats: IngestStats`.
- Constructor takes `IngestPipelineOptions` (lines ~109–136).
- Public methods: `onMessageEnd(message: AgentMessage): void` (~line 198),
  `dispose(): void` (~224), `sweepPhrases(): void` (~231),
  `flush(): Promise<void>` (~246), `processText(text: string, fromUser: boolean): Promise<void>` (~286),
  `getStats(): IngestStats` (~end of class). Private: `#drainQueue(): Promise<void>` (~264),
  `#admitSegment(segment, ordinal, fromUser): string[]` (~336).
- Module exports also: `extractText(message: AgentMessage): string | null` (~line 40),
  `restoreFromHistory(pipeline, sessionManager, shouldAbort?): void` (~line 470).

### Ingest event payload
`extractText` (lines ~35–53): user → whole prompt string or text-block contents joined with `"\n"`;
assistant → text blocks only joined `"\n"`; everything else → `null`. Images/thinking/toolCall/toolResult dropped.
So the pipeline sees: a **multi-line plain-text string** — no per-block offsets, no message-internal position info.

### Debounce / scheduling / chunking
- `onMessageEnd`: extract → push `{text, fromUser}` to `#pending` → clear+re-arm `setTimeout(drain, #debounceMs)` (trailing 300 ms). Fire-and-forget; an existing `#drain` is never duplicated.
- `#drainQueue`: shifts FIFO, calls `processText` per item, swallows per-item throws; `finally` clears `#drain` and calls `#onSweepPhrases` once.
- `processText` (lines ~286–327): one `ordinal = store.nextOrdinal()` for the WHOLE message, then loops
  `for (let off = 0; off < text.length; off += this.#chunkBytes)` slicing ≤64 KiB chunks. Each slice is
  `slice.split("\n")`; each newline-terminated segment runs `#admitSegment`; the unterminated tail carries
  the open line across the chunk boundary. `await this.#yieldFn()` between chunks. At the end:
  `this.#onAdmittedTokens?.(lines)` — one call per message with per-line key arrays.

### Where bigrams/trigrams are formed
**NOT in ingest.ts.** Ingest only emits the hook `onAdmittedTokens(lines: string[][])` (line 327), where
`lines` are per-line arrays of **lowercase keys of admitted WHOLE-token candidates** (sub-words excluded — see
`#admitSegment`, `if (!draft.isSubword) { wholeGroup ??= result; keys.push(draft.key); }` ~line 393).

Wiring (src/pi/index.ts:180–188):
```ts
...(config.enablePhrases
  ? { onAdmittedTokens: (lines) =>
        sessionStore.recordPhraseLines(lines, sessionStore.currentOrdinal()),
      onSweepPhrases: () => sessionStore.sweepPhraseDemotions() }
  : {}),
```

Windowing lives in **src/core/store.ts `recordPhraseLines(lines, ordinal)`** (lines 461–479):
```ts
for (const line of lines) {
  for (let i = 0; i < line.length; i++) {
    if (i + 1 < line.length) {
      const w1 = line[i]; const w2 = line[i + 1];
      this.#upsertPhrase(`${w1} ${w2}`, ordinal, w1, w2);      // bigram (+ #bumpSuccessor)
    }
    if (i + 2 < line.length) {
      this.#upsertPhrase(`${line[i]} ${line[i + 1]} ${line[i + 2]}`, ordinal); // trigram
    }
  }
}
```

### "Newline is the ONLY window break" — quoted
ingest.ts ~lines 300–310 (`processText`):
```ts
// Newline is the ONLY phrase-window break (PRD §06 M2) — a slice
// boundary never breaks one. segments[0..n-2] were each terminated
// by a '\n' inside this slice → finalize each as a line; the tail
// segment stays open. (An empty tail segment is just the newline's
// right side — nothing to carry; empty lines finalize as []..)
const segments = slice.split("\n");
```

### CRITICAL: do token spans/offsets survive to windowing? **NO.**
Position information is lost at **two** independent points:
1. **segment.ts `tokenize` merge output (lines ~160–175)**: internal `SpanToken {raw, start, end, hexish, dead}`
   spans exist during dedupe, but the final `out.push({ raw: t.raw, hexish: t.hexish })` drops `start`/`end`.
   `RawToken` (src/core/types.ts:87–95) has only `raw: string; hexish: boolean` — **no offsets**.
2. **ingest.ts `#admitSegment` (lines 336–417)**: pushes only `draft.key` (lowercase string) into `keys`;
   the raw segment text is never retained alongside. `onAdmittedTokens` receives `string[][]`.

So the adjacency rule "raw text between two consecutive admitted tokens is `[ \t]+` on one line" has **zero
existing signal**: today two tokens separated by punctuation, other junk tokens, or even nothing-else-admitted
across e.g. `foo "quoted" bar` all become adjacent array entries. To implement the rule you must carry span
data (per admitted whole token: start/end offsets within the line/segment) from `tokenize` → `expandCandidates`
→ `#admitSegment` → `onAdmittedTokens` → `recordPhraseLines`, then check `segment.slice(prevEnd, nextStart)`
matches `/^[ \t]+$/`. Note `#admitSegment` operates on the masked segment (`maskSecrets` first), so offsets
should be taken against the masked string or masking must be offset-preserving (verify; it currently blanks
bytes in place — check shapeGate.ts for whether blanking preserves length).

## 2. src/core/segment.ts (253 lines)

### Exported API
- `export function tokenize(text: string): RawToken[]` (lines ~57–175). Pure, document order, disjoint spans.
- `export function expandCandidates(token: RawToken): CandidateDraft[]` (lines ~230–253).
- `export interface CandidateDraft { key; display; properName; isSubword; parentKey? }` (lines ~198–209).
- No offsets in any return type — **strings only**.

### Regexes / algorithm
- `BASE_RE = /[A-Za-z][A-Za-z0-9_]{0,63}/g` (line ~47). Pass 1 collects `SpanToken`s, drops length-1.
- `HEXISH_RE = /(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g` (line ~50). Pass 2 dedupes vs bases:
  equal span + `HAS_DIGIT_RE` → hexish:true; nested/crossing → dropped; hexish containing base tails → base
  marked `dead`. Two-pointer merge emits `RawToken`s.
- **Sub-word splitting**: `expandCandidates` splits on `_` (underscores kept in the whole token), then
  `splitCamel(seg)` (lines ~150–175) at lower→upper and acronym→lowercase boundaries; sub-words length ≥ 4
  become drafts with `isSubword: true, parentKey`; hexish tokens are opaque (whole draft only).
  Normalization: `key` lowercase, `display` as-seen casing, `properName` from display initial.

### Current non-ASCII behavior — quoted (header comment, lines ~7–9):
> "CJK and all other non-ASCII text falls outside the ASCII character classes, so those runs are skipped for
> free and ASCII words resume after them (rule 3)."

I.e. `BASE_RE.exec` simply restarts matching after a non-ASCII run: `"Þórhildur"` → `BASE_RE` matches `rhildur`
at the `r` (starts after `Þó`); `"ΩbsidianMirror"` → matches `bsidianMirror` → whole `bsidianmirror` plus
sub-words `bsidian`, `mirror` (camel split). The merge loop `out.push({raw, hexish})` is where the fix must
land.

**Change point for the new rule**: in `tokenize`'s Pass 1 loop (lines ~65–75), when a base match `m` starts at
`m.index`, inspect `text[m.index - 1]`: if it exists and is non-ASCII **and is a letter**
(`/\p{L}/u`-style check — must exclude e.g. punctuation/digits: `–foo` or `…foo` should presumably still
match), skip the match (drop it). `SpanToken` already has `start`, so the check is cheap and local; also apply
the same reasoning to hexish spans if desired (digit-led hexish can't follow a Unicode letter with an ASCII
digit boundary... actually `\b` behavior: `Þf3a9c2` — hexish RE has no left anchor, so check `start === 0 ||
isBoundary(text[start-1])`). Decide: also drop when a non-ASCII letter DIRECTLY abuts, and possibly also when
any non-word char abuts? Task scope: reject ASCII runs adjacent to Unicode letters.

### Whole token vs sub-word
Whole token = first draft of `expandCandidates` (`isSubword: false`), always emitted regardless of length;
sub-words are ≥4-char split parts with `parentKey`. Bigram lines use only admitted whole tokens
(ingest.ts `#admitSegment`, `if (!draft.isSubword) ... keys.push(draft.key)`).

## 3. Admission on the ingest path (src/core/score.ts)

- `export type AdmissionResult = RankGroup | "reject"` (line ~91).
- `export function admit(draft, dictionary, parentGroup?)` (line ~108): `q = dictionary.lookup(draft.key)`
  (0–255, 0 = rarest, lookup miss → 0); `q >= REJECT_COMMON_THRESHOLD` (=100, line 77) → `"reject"`
  (very common words like "the"). Otherwise RankGroup 0/1/2; sub-words clamp to parentGroup+1, saturating at 2.
- Only non-rejected drafts that also passed `passesShape` (shapeGate.ts: tooShort <4, tooLong, lowEntropy,
  unigramRun, secret, consonantRun) count as **admitted**. Whole-token admitted drafts are exactly the keys
  that can become bigram constituents.

## Key facts for implementers

1. **Spans do NOT exist** past `tokenize`'s merge (segment.ts ~line 172 `out.push({raw, hexish})`) and past
   `#admitSegment`'s `keys.push(draft.key)` (ingest.ts ~line 394). Both must be extended (span-carrying
   variant or parallel array) for the whitespace-only-between rule; the check itself belongs where the pair is
   consumed or where keys are pushed (per line, in `#admitSegment`/`onAdmittedTokens` — the segment string is
   in scope there; chunking is safe because lines never span chunks).
2. **Hook point for adjacency**: `#admitSegment` already holds the raw (masked) `segment` string; have it
   return `string[]` → e.g. `{ key, start, end }[]` (offsets within the segment), thread through
   `processText`'s `lines`/`openLine` and the `onAdmittedTokens(lines: string[][])` contract
   (index.ts wiring + store.recordPhraseLines), then gate `#upsertPhrase` calls in store.ts:469/474 on
   `segment.slice(prevEnd, nextStart).match(/^[ \t]+$/)`. ALTERNATIVE minimal hook: decide adjacency inside
   `#admitSegment`/`processText` before pushing keys (insert a "window break" marker or filter there) so the
   store API stays string-only.
3. **Unicode-letter boundary rejection point**: segment.ts `tokenize` Pass 1 (base loop, lines ~65–75) — skip
   `m` when `m.index > 0 && /\p{L}/u.test(text[m.index-1])` (and consider the analogous guard for the hexish
   span, whose `start` is also in hand). This kills `rhildur` and `bsidianMirror` at the source.
4. `maskSecrets` blanks bytes before tokenization inside `#admitSegment` — if it is not offset-preserving,
   spans taken after masking are fine only if offsets are computed against the post-mask segment (they would
   be); the adjacency check then tests masked text (secrets become blanks/spaces — acceptable/needs a call).