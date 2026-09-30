# Bug Fix Requirements

## Overview
Baseline: npm run check clean, full suite 1053 passed / 1 skipped. Method: deep read of all core and pi modules against the spec, then creative end-to-end probing of the REAL compiled modules through a node TS-stripping harness (real shipped dictionary, real IngestPipeline/CandidateStore/query/provider/widget/editor/index factory), plus 50k-iteration fuzzing of the tokenizer (span invariants) and query core (ranking/match/plural invariants). Areas verified CLEAN against the PRD: segmentation exemplars (4a-4d incl. path trims, 96/97 cap, line:col, and/or, interior '..'), shape gate + maskSecrets (17-vector adversarial secret battery: zero leaks), admission banding incl. R_eff ramp and conjugation-guard boundary behavior, proper-noun relief provably dead, anchored-fuzzy tiers/scores/thresholds, tier-0 fallback and '#' loose mode (per-mode 45/60 resolution, explicit override), ranking order (tier>count>len>lex) and plural pruning under fuzz, zero-fragment '#' listing, store upsert/eviction (userTyped survival, no ghost keys), bigram window rules (comma/backtick/newline/digit/intervening-word breaks), fallback provider behaviors (stock-context delegation, close-on-space, forced single-item Tab return, chain arming/one-shot grant/re-arm, display debounce + anchor-safety, startup gate), widget key decision table, rendering caps/truncation/highlight reset, insertHighlighted spans (path absolute-slash, compound hyphens, '--' survival, trigger-char consumption, caret fix), Enter-always-submits forwarding, never-mutation of the inner editor, visibility state machine (suppression/disqualification/stock contexts/trigger bypass), /acwords full dump to /tmp/hapax-store.txt, config layering/clamps/repairs/collisions, dictionary corruption handling, extension lifecycle incl. session rebind after resume and dictionary-failure disable-once. Four real defects found: the headline one is that M2 chained completion — a core milestone goal the spec explicitly requires on the widget line — is structurally dead on the widget PRIMARY path (never arms; only the rarely-active fallback path chains); plus a tokenizer overlap invariant violation producing duplicate menu candidates for '_'-suffixed literals, a cross-message suppression leak that silently hides the first word's menu after a column-0 acceptance/dismissal, and rare 64KB chunk-boundary token shredding that stores junk halves and loses the real token.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

None.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

### Issue 1: M2 chained completion (zero-typed-char successor offers) is entirely non-functional on the widget PRIMARY display path
**Severity**: Major
**ID**: BUG-001
**Location**: src/pi/widget.ts:835 (insertHighlighted 'CHAIN ARMS: NEVER'), src/pi/widget.ts:988 (createVisibilityMachine called without isIntentBypass/chain wiring), src/pi/index.ts (widget branch registers no provider)

**Description**:
Spec 07 'M2: chained completion' defines a path-independent state machine ('armed only via Tab acceptance of a whole-word candidate') and explicitly requires: 'Chain offers render on the widget line (or fallback menu) like any result set' (spec/07-completion-ui.md:472). Goal 7 of spec 01 ('accepting a word arms its most-likely successor for zero-additional-typing Tab completion') is a core M2 milestone feature. The implementation deliberately never arms the chain on the widget path: src/pi/widget.ts insertHighlighted documents 'CHAIN ARMS: NEVER (plan 04)' and never calls chain.arm, and createWidgetEditorFactory never wires the chain machine into the visibility machine (the isIntentBypass seam is left unwired). The only arming site is the fallback provider's applyCompletion (src/pi/provider.ts), which is never registered when an editor factory exists. Since the widget path is PRIMARY whenever any extension installs an editor (pi-vim, split-editor), in typical real sessions the successor chain never arms and the zero-typed-char successor offer never appears — the entire M2 chaining feature is dead on the primary path. test/widget.test.ts:1053 pins this no-arm behavior as 'BY DESIGN' and plan/004's validate.sh Journey B only exercises chaining through the fallback provider, so the gap was never caught. The spec has never been amended to record the descope, violating the repo's binding spec-maintenance policy (AGENTS.md).

**Steps to Reproduce**:
1. Build a store with a bigram: ingest 'ZorpWibble quuxblat mode. ZorpWibble quuxblat again.' via IngestPipeline with onAdmittedTokens -> store.recordBigramRuns (store.topSuccessors('zorpwibble') === [{next:'quuxblat',count:2}]). 2. Compose the widget editor via createWidgetEditorFactory({inner, store, config, chain, ...}). 3. Type 'zorp' — the widget line shows ['Zorp','ZorpWibble']. 4. Press Tab — 'Zorp' inserts, but chain.state() stays null (insertHighlighted never arms). 5. Press space (cursor at empty word start) — per spec the zero-typed-char successor offer 'quuxblat' must render on the widget line; instead the line stays hidden (verified end-to-end through the composed proxy: 'zero-char successor offer visible: false'). Fallback path comparison: through createHapaxProvider the same sequence arms the chain and offers ['lwlock'/'quuxblat'] with description 'chain' at the empty word start.


## Minor Issues (Nice to Fix)
Small improvements or polish items.

### Issue 1: Tokenizer emits OVERLAPPING tokens when a technical literal's trailing '_' trim straddles a base token — duplicate menu candidates
**Severity**: Minor
**ID**: BUG-002
**Location**: src/core/segment.ts (pass 4 literal classification/trailing-symbol trim + absorber merge loop, ~lines 560-680)

**Description**:
tokenize()'s documented structural invariant ('Returns one token per disjoint match span... Never emits overlapping tokens', src/core/segment.ts) is violated for rule-4c technical literals whose edge-trim removes a trailing '_': the base pass [A-Za-z][A-Za-z0-9_]* can capture an identifier that starts INSIDE the literal's span and extends past its post-trim end (base tokens may contain '_'), so the strict-containment absorber misses it and BOTH tokens are emitted with overlapping spans. Both are then admitted as separate candidates, so the menu offers near-duplicates (one a strict prefix of the other) for a real identifier class (trailing-underscore names like FOO_1_, USER_2_TOKEN_ — Python keyword-avoidance and C/system naming). Verified: tokenize('FOO_1_') -> ['FOO_1','FOO_1_'] with overlapping spans [0,5) and [0,6); after ingesting 'rename FOO_1_ and USER_2_TOKEN_ constants', the store holds both FOO_1 and FOO_1_ (and USER_2_TOKEN / USER_2_TOKEN_), and typing 'foo_' offers BOTH ('["FOO_1","FOO_1_"]') — duplicate completion targets. A 20k-iteration random fuzz over the full literal/segment alphabet reproduces the overlap class broadly (e.g. 'X=1ZZ' + 'ZZ_', 'cY1Z' + 'cY1Z_'). Plural pruning does not cover this pair (not an 's' pair).

**Steps to Reproduce**:
import { tokenize } from './src/core/segment.ts'; tokenize('FOO_1_') returns two tokens whose spans overlap ([0,5) literal and [0,6) base). Full user-visible path: IngestPipeline.processText('rename FOO_1_ and USER_2_TOKEN_ constants') -> store.entries() contains both foo_1 and foo_1_ -> rankMatches(store, 'foo_') returns ['FOO_1','FOO_1_']. Root cause: pass-4's literal absorption checks only strict containment (fn.start <= tok.start && tok.end <= fn.end) against the post-trim bounds, and the final merge's overlap-safety branch (segment.ts 'overlap safety') emits the absorber AND keeps the straddling base token.

### Issue 2: Widget suppression keyed by numeric fragment START leaks across messages — first word of the next message silently loses its completion line
**Severity**: Minor
**ID**: BUG-003
**Location**: src/pi/widget.ts createVisibilityMachine — onDismissed(explicit) suppressedFragmentStart recording and the R4 release check (~lines 649-680)

**Description**:
Spec 07 key handling: 'Explicit dismissal (Escape, boundary-Esc) suppresses the line for the REST OF THE WORD. Re-open only at the next word start or trigger char.' The visibility machine implements suppression release by comparing the numeric fragment START column (suppressedFragmentStart === start => stay suppressed). After a Tab acceptance (insertHighlighted calls machine.onDismissed(true)) or an Enter dismissal at column 0 — i.e. whenever the completed/dismissed word began a message — suppression is recorded at start 0 and is NEVER released for the first word of subsequent messages, which also sits at start 0 in the freshly cleared buffer. The first word of every following message is treated as 'the same word', so its widget line never renders (silent menu miss) until the user reaches a non-zero-start word, whose paint releases suppression. Verified end-to-end through the composed widget proxy: message 1 'ze' -> Tab (inserts 'Zendesk') -> Enter submits; message 2 fresh buffer 'lw' -> visible=false (want true; lwlock is stored), while the second word 'qu' shows correctly. A new message's first word IS 'the next word start' per the spec's intent.

**Steps to Reproduce**:
Compose createWidgetEditorFactory over a stateful fake inner editor (getLines/getCursor/setText/setCursorCol; Enter clears the buffer). Type 'ze' (line visible), press Tab ('Zendesk' inserted; suppression recorded at start 0), press Enter (submits; buffer clears). Type 'lw' in the fresh buffer: machine.getState().visible === false and currentSet === [] despite 'lwlock' matching — suppression start 0 equals the new fragment's start 0. Typing the second word (' qu') shows the line again (different start releases).

### Issue 3: 64KB chunk-boundary token shredding: a word straddling a slice edge is split, storing junk fragments and losing the real token
**Severity**: Minor
**ID**: BUG-004
**Location**: src/pi/ingest.ts processText (~line 400): slice-local #admitSegment/tokenize with no boundary token stitching

**Description**:
IngestPipeline.processText tokenizes each <=64KB slice independently (spec 05 chunking), so a token straddling a slice boundary is shredded into its two halves. The leading half is usually lost (glued to whatever precedes it, or gate-rejected), and the trailing half can be admitted as a junk dictionary-absent candidate. Verified: a 135KB message containing 'Zorpwibble' exactly at offset 65536 yields store entries ['ibble','quuxblat'] — 'Zorpwibble' never becomes a candidate (so its successor bigrams also cannot form), while the junk fragment 'ibble' (entropy 1.92 bits/char) is admitted as a rare word. Impact is bounded (one shredded token per 64KB of a SINGLE message; typical messages are far smaller and restore replays per-message), but it contradicts segmentation's maximal-run semantics and pollutes the store. The run-assembly layer (openLine/openTail) explicitly stitches RUNS across chunk boundaries, so token stitching was clearly intended but never implemented.

**Steps to Reproduce**:
const big = 'a'.repeat(65536-5) + 'Zorpwibble quuxblat ' + 'b'.repeat(70000); await pipeline.processText(big, true); store.entries() contains 'ibble' (junk half) and 'quuxblat', but NOT 'zorpwibble'; store.topSuccessors('zorpwibble') is empty. (65536-5 places 'Zorpwibble' so the 64KB slice boundary falls inside it.)

## Testing Summary
- Total bugs found: 4
- Critical: 0
- Major: 1
- Minor: 3

## Recommendations
- BUG-001: either implement chain arming on the widget path (arm in insertHighlighted via the WidgetLayerOptions.chain instance, wire an isIntentBypass seam so zero-char successor offers bypass the hesitation gate, and consult successors at empty word starts in the visibility machine) or amend spec/07 to record the descope — the repo's binding spec-maintenance policy requires one or the other; the current state ships an unamended spec clause for a dead core feature.
- BUG-002: in pass 4 of tokenize, treat a base/hexish token as absorbed when it OVERLAPS the literal's post-trim span (tok.start < litEnd && tok.end > litStart), or defer to the base token when it strictly contains the trimmed literal (mirror of the equal-span defer) — the union filter already implements this for compound-vs-literal ties.
- BUG-003: release suppression when the editor fingerprint (buffer text) changes since dismissal rather than comparing numeric fragment starts, or additionally treat start===0 with a different surrounding context (fresh buffer) as a new word start; alternatively reset suppression on submit (enter-submit seam).
- BUG-004: carry the trailing partial token of a slice (the suffix after the last boundary char) into the next slice for tokenization, mirroring the existing openLine/openTail run-stitching pattern.
- Spec-text drift worth an interactive-session sync (not counted as bugs): spec/04's 9-char boundary example 'q=82 rejects' is arithmetically wrong under the spec's own formula (R_eff(9)=82.15, so q=82 admits — pinned by test/score.test.ts:129); spec/09:86 'exactly one eviction' vs spec/06:58 'evict in batches of 256' (implementation follows 06, tests pin the batch).
