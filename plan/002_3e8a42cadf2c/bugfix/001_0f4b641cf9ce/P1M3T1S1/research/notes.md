# Research notes — bugfix 001_0f4b641cf9ce P1.M3.T1.S1 (BUG-004: astral before-side guard)

## Verified code state
- `src/core/segment.ts`:
  - `isUniLetter(cp: number | undefined)` at ~L86–91: takes a CODE POINT,
    rebuilds `String.fromCodePoint(cp)`, tests `UNI_LETTER_RE` (`/\p{L}/u`)
    and NOT `ASCII_LETTER_RE`. JSDoc (~L78–85) documents the astral
    BEFORE-side gap as "Accepted v1 trade-off" — this task's doc target.
  - Guard sites (both BEFORE-side variants use `codePointAt(m.index - 1)`):
    * Base pass ~L131: `isUniLetter(text.codePointAt(m.index - 1)) ||
      isUniLetter(text.codePointAt(m.index + m[0].length))` → sets `dead`.
    * Hexish pass ~L179-182: `isUniLetter(text.codePointAt(start - 1)) ||
      isUniLetter(text.codePointAt(end))` → marks contained bases dead +
      `continue`.
  - Root cause: for astral letter '𝔘' (2 UTF-16 units: high 0xD835 + low
    0xDD18) immediately before a match at index i, `codePointAt(i - 1)` reads
    the LOW surrogate alone (0xDC00–0xDFFF), which is not `\p{L}` → guard
    misses. AFTER side is fine: `codePointAt(end)` at a HIGH surrogate
    returns the full pair. BMP (草, é, Ω, Þ) are single units — both sides fine.
- `test/segment.test.ts`: existing rule-3 suite at ~L144–160
  (ΩbsidianMirror → [], hexish adjacency, deadbeef草), astral-offset case at
  L238/L268–273 (𝕏 offsets; 草sword). Uses a `raws()` helper (map over
  tokenize → raw strings) and vitest describe/it with .js imports.
- Parallel item P1.M2.T2.S3 (secret paste battery) touches ingest/tests
  only — no overlap with segment.ts.
- P1.M4.T2.S1 owns the README known-limitations sweep; this task replaces
  only the JSDoc note.

## Fix design (per work item + PRD rec: "step by full code points")
- New helper beside isUniLetter:
  ```ts
  function isUniLetterBefore(text: string, index: number): boolean {
    const cu = text.charCodeAt(index - 1); // may be NaN at index 0 → falsy
    if (cu >= 0xdc00 && cu <= 0xdfff) { // low surrogate: pair with previous unit
      return isUniLetter(text.codePointAt(index - 2));
    }
    return isUniLetter(text.codePointAt(index - 1));
  }
  ```
  `codePointAt(index - 2)` on a high surrogate returns the full astral code
  point. Guard NaN/undefined: `codePointAt` beyond string edge returns
  undefined → isUniLetter returns false (existing behavior); `charCodeAt`
  returns NaN → NaN >= comparisons are false → falls to codePointAt path →
  undefined → false. Safe at index 0.
- Replace BOTH before-side calls (`codePointAt(m.index - 1)` in base pass,
  `codePointAt(start - 1)` in hexish pass) with `isUniLetterBefore(text, idx)`.
  Keep after-side `codePointAt(m.index + m[0].length)` / `codePointAt(end)`
  unchanged.
- Remove the "Limitation: … Accepted v1 trade-off" sentences from the
  isUniLetter JSDoc; describe code-point-correct behavior (Mode A docs).

## Test cases to add (TDD — write first, watch '𝔘sword' fail)
- tokenize('𝔘sword') → [] (the bug)
- tokenize('sword𝔘') → [] (already-passing regression, pin it)
- tokenize('ΩbsidianMirror') → [] (BMP before-side, pin existing)
- tokenize('Þórhildur') → [] (BMP)
- BMP 'é' adjacency both sides: 'éabc' → [], 'abcé' → []
- astral letter BETWEEN two ASCII runs kills both: 'a𝔘b' → [] (base
  run can't actually span 𝔘 — both runs 'a'(<2) and 'b'(<2) trivially
  drop; better: 'aa𝔘bb' → [])
- hexish variant with astral prefix: '𝔘0f3a9c2' → [] (hexish pass
  before-guard) and confirm no 'f3a9c2' leak (dead-tail bookkeeping)
- astral AFTER hexish: '0f3a9c2𝔘' → [] (already correct; pin)
- astral not adjacent: '𝔘 sword' → ['sword'] (space boundary — unaffected)
- offsets/san case at L238 style: astral elsewhere in line doesn't disturb
  spans (𝕏 case already exists — keep green)
