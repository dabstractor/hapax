# Research notes — P1.M1.T2.S2 (plan 003): shape-gate path-class cap 4–96 + secret/entropy application

## Upstream contract (P1.M1.T2.S1, in flight)
- segment.ts emits path CandidateDrafts: key = trimmed lowercase, display =
  ORIGINAL raw (edges/`:line:col` preserved in display? — key trimmed,
  display raw), `path: true`, `isSubword: false`, `properName: false`.
- types.ts gains `CandidateDraft.path?: boolean`.

## Verified live source (shapeGate.ts)
- Constants: MIN_LENGTH=2 (L68), MAX_WHOLE_LENGTH=64 (L71),
  MAX_SUBWORD_LENGTH=32 (L73).
- passesShape (L171–194): `const max = draft.isSubword ? MAX_SUBWORD_LENGTH :
  MAX_WHOLE_LENGTH;` → then length checks → isSecretShaped(draft.display)
  → entropy floor only if /[a-z]/.test(key) && charEntropy < 1.5 →
  unigramRun → consonantRun. No per-class cap mechanism today — add a
  path-keyed branch.
- isSecretShaped(display) rules (order): prefixes; '@'+'.'; base64 run ≥24
  mixed+`+/`; pure hex ≥20; pure decimal ≥16; base64url run ≥16 w/ lower+
  upper+≥2 digits; charset-relative entropy residues. All apply to path
  drafts unchanged — paths are letter-bearing so entropy floor applies.
- Test helper: `draft(key, isSubword=false)` builds CandidateDraft with
  display===key; needs a path variant (key, display, path:true).

## Design
- In passesShape, compute class caps:
  ```ts
  const min = draft.path ? 4 : MIN_LENGTH;
  const max = draft.path ? 96
            : draft.isSubword ? MAX_SUBWORD_LENGTH : MAX_WHOLE_LENGTH;
  ```
  Everything else unchanged (secret on display, entropy on key, etc.).
- Note: S1's classifyPath already enforces 4–96 at segmentation; the gate
  re-check is defense-in-depth AND the spec's stated home for the cap
  (h2.25 rule 1: "path-class candidates 4–96, rule 4d"). Export? Keep
  constants module-private, matching MIN_LENGTH/MAX_WHOLE_LENGTH style.
- TDD in test/shapeGate.test.ts: 96/97 boundary (needs display since window
  is 96 — construct directly with draft helper), floor 4 (a 3-char path key
  → tooShort even though MIN_LENGTH=2), texture cases: URL-ish display with
  '@' and '.' → secret reject; base64url-texture segment in a path → whole
  reject; ordinary deep path admits; low-entropy 'a/a/a/a' → lowEntropy.
- Boundary construction gotcha: key ≤ 96 chars is easy (raw window is 96,
  trim only shortens); a 97-char KEY can't come from the 96-window scan —
  the gate test constructs the draft directly (that's fine; the gate is the
  contract holder, segment can't produce it anyway).

## Gotchas
- Entropy: '/' isn't [a-z]; /[a-z]/ test still true for real paths → floor
  applies as-is. 'a/a/a/a' charEntropy low → dies lowEntropy (spec'd).
- display≠key for path drafts — isSecretShaped(display) sees ORIGINAL edges
  incl. trimmed ':42:13' and leading '../' — fine (conservative, spec'd).
- Subword caps unchanged (paths are never subwords, isSubword:false pinned).
- NodeNext .js imports; vitest style double quotes.
