/**
 * Match-state extraction — the autocomplete decision gate (PRD §07,
 * P1.M3.T3.S1). For one cursor position this decides HOW hapax offers
 * suggestions, or whether it offers any at all:
 *
 *   1. trigger mode — the configured trigger char (default "#") at
 *      line start or after a space/tab, followed by an optional
 *      fragment containing no whitespace and no further trigger
 *      chars; zero-length fragments count (a bare "#" matches).
 *   2. threshold mode — a trailing identifier
 *      ([A-Za-z][A-Za-z0-9_]*) whose length reaches config.threshold;
 *      fires EVERYWHERE, any word start, no position gating.
 *   3. null — neither matched: the caller (S2's getSuggestions) must
 *      return pi's built-in completion untouched so path/slash
 *      completion keeps working exactly as before (never-hijack
 *      rules). Trigger mode wins over threshold mode.
 *
 * `prefix` is the exact text pi-tui's applyCompletion replaces on
 * acceptance: triggerChar + fragment in trigger mode, the bare
 * fragment in threshold mode.
 *
 * extractMatchState (above) is PURE and SYNCHRONOUS: no I/O, no state,
 * no runtime pi imports — S2 consumes it per keystroke and S3's debounce
 * and S4's acceptance tests rely on purity. HapaxConfig is trusted:
 * loadConfig (P1.M3.T1.S1) already validated and clamped it, so no
 * re-validation happens here.
 *
 * S2 (P1.M3.T3.S2) appends createHapaxProvider below: the hapax
 * AutocompleteProvider factory that queries the store synchronously on
 * EVERY keystroke (PRD §07 "Debounce, flicker, and the Tab contract"
 * rule 1) and maps RankedMatch[] to pi's AutocompleteSuggestions,
 * delegating untouched on abort / null match state / zero candidates so
 * pi's built-in path/slash completion is never hijacked.
 *
 * classifyStockContext (below; BUG-001 fix part 1) is the stock-side
 * mirror of that decision: a pure, synchronous, line-local,
 * CONFIG-INDEPENDENT classifier that detects when the cursor sits in a
 * context pi's built-in completion owns (slash command, @-mention,
 * quoted path, unquoted path), mirroring pi-tui editor.js exactly. A
 * non-null StockContext means hapax MUST delegate; S2 (P1.M1.T1.S2)
 * supplies the classifier and P1.M1.T1.S2 (BUG-001 wiring) gates
 * getSuggestions with it ahead of extractMatchState.
 */

import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

import { matchFragment, rankMatches } from "../core/query.js";
import type { CandidateStore } from "../core/store.js";
import type { RankedMatch, Successor } from "../core/types.js";
import { resolveFuzzThreshold, type HapaxConfig } from "./config.js";
import { createChainGrantTracker } from "./chain-grant.js";

/**
 * How hapax should respond at a cursor position. `fragment` is the
 * partial word to complete against; `prefix` is what the editor
 * replaces on completion.
 */
export type MatchState =
  | { mode: "trigger"; fragment: string; prefix: string }
  | { mode: "threshold"; fragment: string; prefix: string };

/**
 * Extract the match state for the cursor sitting at column `col` of
 * `lines[line]`. Only the text BEFORE the cursor on the cursor's line
 * is inspected — the regexes are line-local; lines are never joined.
 * Trigger mode is skipped entirely when config.triggerChar is ""
 * (the config-sanctioned way to disable it). Out-of-range line/col
 * return null defensively. Null means DELEGATE: the caller must pass
 * the request through to pi's built-in completion.
 */
export function extractMatchState(
  lines: string[],
  line: number,
  col: number,
  config: HapaxConfig,
): MatchState | null {
  if (line < 0 || line >= lines.length) return null;
  const text = lines[line];
  if (col < 0 || col > text.length) return null;
  const before = text.slice(0, col);

  // Trigger mode (PRD §07 rule 1): the trigger char anchored to line
  // start or a space/tab; the fragment excludes whitespace and the
  // trigger char itself, and may be empty (bare "#"). The char is
  // regex-escaped so trigger chars like "+", "\" or "/" build a
  // sound pattern (raw "+" or "\" would throw or mis-match).
  if (config.triggerChar !== "") {
    const esc = config.triggerChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = before.match(new RegExp(`(?:^|[ \\t])${esc}([^\\s${esc}]*)$`));
    if (m) {
      return { mode: "trigger", fragment: m[1], prefix: config.triggerChar + m[1] };
    }
  }

  // Threshold mode (PRD §07 rule 2): a trailing identifier of length
  // >= config.threshold, fires everywhere — no whitespace/position
  // gating. prefix is the bare fragment (no leading trigger char).
  // Hyphens are admitted INSIDE the fragment (and as a trailing char):
  // hyphenated compounds are single candidates (spec 04 compound rule),
  // so mid-compound continuation must query the compound prefix —
  // "load-b" → fragment "load-b", not "b" (a hyphen-terminating regex
  // here restarted the menu at every segment). Still letter-initial:
  // "-v"/"--flag" never match.
  const t = before.match(/[A-Za-z][A-Za-z0-9_-]*$/);
  if (t && t[0].length >= config.threshold) {
    return { mode: "threshold", fragment: t[0], prefix: t[0] };
  }

  // DELEGATE: neither mode matched — S2 must return
  // current.getSuggestions(...) unchanged.
  return null;
}

/** A cursor context owned by pi's built-in completion. Non-null means
 *  hapax MUST delegate (getSuggestions passes through to `current`). */
export type StockContext = "slash" | "mention" | "quoted-path" | "path";

/**
 * Classify whether the cursor sits in a stock pi completion context
 * (BUG-001 fix, part 1). Pure, synchronous, line-local (only the text
 * before the cursor on the cursor's line is inspected) and
 * config-independent — stock contexts belong to pi, not to hapax's
 * HapaxConfig. Priority: slash → mention → quoted-path → path; null
 * means the context is hapax's (or nobody's). Mirrors pi-tui's
 * editor.js semantics exactly (§09 integration item 6: "path/slash/@
 * behaviors identical to stock pi"). Out-of-range line/col return
 * null defensively, same convention as extractMatchState.
 */
export function classifyStockContext(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
): StockContext | null {
  if (cursorLine < 0 || cursorLine >= lines.length) return null;
  const text = lines[cursorLine];
  if (cursorCol < 0 || cursorCol > text.length) return null;
  const before = text.slice(0, cursorCol);
  const trimmed = before.trimStart();

  // slash — mirrors pi-tui editor.js isInSlashCommandContext (:1775:
  // line 0 only, leading whitespace allowed via trimStart) PLUS
  // handleTabCompletion's no-space guard (:1812): once a space is
  // typed, args/word fragments are no longer the command name. Both
  // clauses are required or delegation diverges from stock.
  if (cursorLine === 0 && trimmed.startsWith("/") && !trimmed.includes(" ")) {
    return "slash";
  }
  // mention — trailing identifier fragment immediately after '@' at a
  // word start (line start or after whitespace/tab).
  if (/(?:^|[ \t])@[A-Za-z][A-Za-z0-9_-]*$/.test(before)) return "mention";
  // quoted-path — an unclosed '"' on the cursor line (odd count).
  // Stock applyCompletion treats '"' and '@"' prefixes specially.
  if ((before.match(/"/g) ?? []).length % 2 === 1) return "quoted-path";
  // path — a '/' earlier in `before` whose tail (the cursor-adjacent
  // fragment) is whitespace-free ("src/roun" → "roun" after '/').
  // Prose URLs ("https://…/roun") also classify as path — accepted:
  // stock file completion is consulted for them too.
  const lastSlash = before.lastIndexOf("/");
  if (lastSlash !== -1 && !/\s/.test(before.slice(lastSlash + 1))) {
    return "path";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// S2 — live synchronous query + AutocompleteSuggestions mapping
// (P1.M3.T3.S2, PRD §07 rule 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The live result of the most recent successful hapax query — the seam
 * consumed by S3 (display debounce / hysteresis) and P2.M2.T2.S1
 * (Tab-armed chaining). `prefix` is state.prefix (what applyCompletion
 * would replace: triggerChar + fragment in trigger mode, the bare
 * fragment in threshold mode); `ts` is Date.now() at query time so S3
 * can compare it against paint time. Cleared to null whenever the
 * provider delegates — a stale live result would break S3's
 * "close on disqualification" hysteresis.
 */
export interface LiveResult {
  matches: RankedMatch[];
  prefix: string;
  ts: number;
}

/**
 * What createHapaxProvider returns: pi's AutocompleteProvider contract
 * plus the two documented internal seams (kept out of pi's interface so
 * pi never sees them — they are read only by hapax's own later stages).
 * `__hapaxLive()` exposes the live-result cache; `__hapaxKey(value)`
 * maps an emitted item's value (the display string) back to its store
 * key so M2 can detect Tab acceptance of a hapax item without polluting
 * `description`.
 */
export type HapaxProvider = AutocompleteProvider & {
  __hapaxLive: () => LiveResult | null;
  __hapaxKey: (value: string) => string | undefined;
};

/**
 * Wrap pi's current autocomplete provider with hapax suggest-on-every-
 * keystroke. Contract (PRD §07 rule 1): the store query is SYNCHRONOUS
 * — getSuggestions is async only because pi's interface says so, and
 * the hapax path contains ZERO awaits; Tab resolves against the live
 * result instantly. Delegation is the safety net, in priority order:
 *
 *   1. options.signal.aborted → delegate, original arguments untouched
 *      (never signal.throwIfAborted() — delegate, don't throw).
 *   2. classifyStockContext fires (slash / @-mention / quoted path /
 *      path) → delegate VERBATIM (BUG-001: pi's stock menus keep working
 *      exactly as before — before the armed branch and the force read,
 *      so stock contexts win even while a chain is armed and under a
 *      forced Tab).
 *   3. extractMatchState returns null → delegate (never-hijack rules:
 *      pi's path/slash completion stays exactly as before).
 *   4. rankMatches returns [] → clear the live cache, then delegate
 *      (zero candidates never render a menu).
 *
 * P1.M2.T1.S1 (plan 002, PRD §07 h2.43 redesign) keeps TWO chain
 * behaviors:
 *
 *   - the ARMED BRANCH: while a word W is armed, the zero-typed-char
 *     word start (line start or right after a space/tab) offers W's
 *     unfiltered top successors with BARE single-word values at prefix
 *     "", and any typed fragment filters that set live — at chain
 *     threshold 0 for the whole chain duration (never config.threshold;
 *     extractMatchState stays bypassed on this path).
 *   - an `enableChaining` gate on the whole chain layer (P1.M3.T1.S2):
 *     with the flag false the armed branch never runs and the arming
 *     intercept never arms — the provider behaves exactly as M1
 *     word-only (the flag disables the successor chain layer, NOT word
 *     completion).
 *
 * Delegation forwards the ORIGINAL arguments object unchanged — no
 * cloning, no dropping `force`. All other members pass straight
 * through: applyCompletion and shouldTriggerFileCompletion always
 * delegate (current may leave the latter undefined → default true, pi's
 * own behavior). triggerCharacters mirrors config.triggerChar PLUS
 * every identifier character ([A-Za-z0-9_]) so pi-tui's keystroke
 * auto-trigger fires on plain word typing too (its pattern is
 * `(?:^|\s)[<chars>][^\s]*$` with its own word-start gating) —
 * and threshold-mode word completion never auto-opens. The list is
 * therefore never empty/undefined, even when trigger mode is
 * disabled ("").
 *
 * The store is accepted, never constructed (src/core architecture); the
 * config is trusted (loadConfig already validated it); no debounce or
 * hysteresis lives here — that is S3's job. This factory holds the only
 * per-provider state (the live cache), published for S3 / P2.M2.T2.S1
 * via __hapaxLive / __hapaxKey.
 *
 * `chain` (P2.M2.T2.S1) is the Tab-armed successor-chaining machine:
 * getSuggestions consults it AFTER the aborted and stock-context checks
 * (a stock-context call delegates before the armed branch is reached —
 * BUG-001) — while armed it
 * swaps the suggestion set for the armed word's successors (zero-typed-
 * char word-start offer, then threshold-0 live fragment filtering — a
 * fuzzy MEMBERSHIP gate through the shared anchored matcher, §07 h2.49;
 * ranking stays successor-count-based) — and
 * applyCompletion arms through it as a side-effect BEFORE delegating
 * verbatim (never-hijack case (b) pins that pass-through).
 * Optional with a fresh idle default so direct 3-argument callers (the
 * P1 test suites) get a machine that can never arm; index.ts is the
 * production caller and passes its per-session machine.
 */
export function createHapaxProvider(
  store: CandidateStore,
  config: HapaxConfig,
  current: AutocompleteProvider,
  chain: ChainMachine = createChainMachine(),
): HapaxProvider {
  // Live-result cache — written on every query, read by S3 / P2.M2.T2.S1
  // through the accessors below. Never read by getSuggestions itself:
  // each keystroke is answered fresh from the store.
  let lastLive: LiveResult | null = null;
  const liveKeyByValue = new Map<string, string>(); // item.value → RankedMatch.key
  // One-shot chain tracker (2026-09): words answered per arming + the
  // last answered armed prefix (word-boundary detection). Reset on
  // every acceptance (applyCompletion below).
  // One-shot grant tracker (spec/07:450–457) — shared helper, plan 004
  // T2.S2; the widget path consumes the same logic via src/pi/chain-grant.ts.
  const grant = createChainGrantTracker();

  // Identifier trigger chars: pi-tui only auto-requests suggestions
  // on plain-letter keystrokes when the char is a registered trigger
  // character (editor.js: char-in-triggerCharacters at a word start,
  // then triggerPattern per following char). Registering [A-Za-z0-9_]
  // makes the dropdown open automatically while typing a word instead
  // of only via Tab's force path; hapax still delegates whenever
  // extractMatchState misses, so stock contexts are unaffected.
  const IDENTIFIER_TRIGGERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

  return {
    triggerCharacters: [
      ...(config.triggerChar ? [config.triggerChar] : []),
      ...IDENTIFIER_TRIGGERS,
    ],

    async getSuggestions(lines, cursorLine, cursorCol, options) {
      // 1. Aborted → pass pi's request through, arguments untouched.
      if (options.signal.aborted) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      // 1.2 Stock-context gate (BUG-001): the cursor sits in a context pi's
      // built-in completion owns (slash / @-mention / quoted path / path —
      // see classifyStockContext above). Delegate VERBATIM, before the armed
      // branch and the force read, so typing-path, forced Tab, and
      // armed-chain-overlapped stock contexts all delegate. Options are the
      // ORIGINAL object — never cloned (existing tests assert identity).
      if (classifyStockContext(lines, cursorLine, cursorCol)) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      // 1.1 Force read (PRD §07 h3.8 Tab-opens-menu mitigation). pi-tui's
      // editor Tab-with-no-menu path calls getSuggestions with force:true,
      // then applies a single-item result IMMEDIATELY — its fast path is
      // `options.force && options.explicitTab && suggestions.items.length
      // === 1` (components/editor.js ~1903, verified against
      // @earendil-works/pi-tui ~0.84.4; >1 items opens the menu in its
      // 'force' state). This mitigation leans on that contract: every
      // hapax-owned return below narrows to the single live top item when
      // forced, so Tab completes in the same keypress and only ever
      // completes — never opens, toggles, or summons a menu. PIN: if
      // pi-tui changes the items.length === 1 fast path, this mitigation
      // needs revisit (the zero-char chain offer and auto-open rules are
      // unaffected). Strict === true — force is optional and foreign
      // callers may pass truthy non-booleans that must not fire the
      // branch. Branch order is the contract: abort → stock context →
      // armed → force-aware returns → normal; aborted and stock-context
      // calls still delegate above (force never outranks abort, and stock
      // menus are never answered from hapax — the Tab-opens-menu fix).
      const forced = options.force === true;
      // 1.5 Tab-armed chaining (PRD §07 h2.43, redesigned in plan 002
      // P1.M2.T1.S1): while a word W is armed, the chain answers INSTEAD
      // of extractMatchState — at chain threshold 0 for the WHOLE chain
      // duration, so config.threshold is never consulted on this path
      // (extractMatchState is deliberately not called here: it would
      // enforce config.threshold and kill short chain fragments).
      //
      //   (a) ZERO-TYPED-CHAR OFFER: the cursor at an empty word start —
      //       line start or right after a space/tab — offers W's
      //       unfiltered top successors. This is the keystroke right
      //       after the user separates the accepted word from the next
      //       ("Tab alpha, type space"): the PRD's "zero typed
      //       characters" means zero chars of the NEXT word.
      //   (b) TYPED FRAGMENT: a trailing [A-Za-z][A-Za-z0-9_]* AT A WORD
      //       START (line start or right after a space/tab) filters the
      //       successor set live through the anchored-fuzzy MEMBERSHIP
      //       gate (§07 h2.49: same matcher as the query path, threshold
      //       0, successor-count order kept); typing never disarms while
      //       the fragment still fuzzy-matches a successor. A fragment
      //       GLUED to the trigger
      //       char or other punctuation ("#b", "!be") is NOT a chain
      //       fragment (BUG-005): pi-tui's applyCompletion deletes exactly
      //       prefix.length chars blindly, so answering at prefix "b" for
      //       buffer "#b" would strand the "#" — glued fragments
      //       disqualify instead, and trigger mode wins at prefix "#b"
      //       (PRD §07: trigger-char match has priority; any
      //       disqualifying non-Tab key → idle).
      //   (c) DISQUALIFICATION: punctuation, word-less non-start input,
      //       zero matching successors, or an empty successor index all
      //       chain.reset() and FALL THROUGH to the normal path on this
      //       SAME keystroke — the user sees normal candidates (or pi's
      //       stock delegate) immediately, never a closed or empty menu
      //       (PRD §01 invariant 3).
      //
      // BARE VALUES (pi-tui insertion semantics, confirmed from the
      // @earendil-works/pi-tui dist editor.js — external_deps.md §2a):
      // with prefix "" applyCompletion splices item.value VERBATIM at
      // the cursor, and the text before the cursor already ends with the
      // user's separating space — a BARE word inserts word-separated
      // ("alpha " + "beta" → "alpha beta") while a leading-space value
      // would double-space ("alpha  beta"). pi's plain path adds NO
      // trailing space, so chaining relies on the user's space as the
      // word boundary. Item values are bare single words everywhere
      // (PRD §06 h2.38 one-word invariant) — no leading-space, no
      // multi-word values anywhere.
      //
      // enableChaining gate (P1.M3.T1.S2): the entire layer — armed
      // branch and arming intercept below — is inert under
      // enableChaining:false; word completion is untouched.
      const armed = chain.state();
      if (armed && config.enableChaining) {
        const before = lines[cursorLine]?.slice(0, cursorCol) ?? "";

        // ONE-SHOT CHAIN OFFERS (2026-09 fix, "menus show immediately
        // forever after one acceptance"): an acceptance grants exactly
        // ONE immediate successor offer — the next word. If the user
        // types through that offer without accepting, the chain
        // DISARMS at the next word boundary; the normal gated path
        // answers from there. Without this, the armed chain re-offered
        // at EVERY word start for the rest of the message, and chain
        // results carry the display layer's intent bypass — menus
        // popped immediately at full speed indefinitely after a single
        // Tab (live-reproduced and instrumented). Word detection: a NEW
        // word is an armed-branch query whose prefix neither extends
        // nor is-extended-by the previously answered one (same-word
        // narrowing, including backspace, keeps the chain). Acceptance
        // re-arms (applyCompletion → chain.arm) and resets the tracker,
        // so chained acceptance flows Tab→offer→Tab→offer exactly as
        // before.
        const curArmedPrefix =
          before === "" || /[ \t]$/.test(before)
            ? ""
            : (before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0] ?? null);
        if (curArmedPrefix !== null && grant.tick(curArmedPrefix)) {
          // Typed through the granted offer without accepting → idle.
          // Fall through: the normal path (under the hesitation gate)
          // answers this SAME keystroke. (The tracker already zeroed
          // itself — never double-reset.)
          chain.reset();
        }
        if (chain.state() !== null) {

        // Publish an armed successor set through the SAME lastLive seam
        // as the normal path so S3's classification (result.prefix ===
        // live.prefix) and debounce compose unchanged — the published
        // prefix MUST equal the returned prefix. Entries are registered
        // under CHAIN_KEY_PREFIX so applyCompletion can tell "successor
        // accepted → armed(next)" from "word candidate accepted →
        // armed(word)" (plain key). Values are BARE single words — never
        // leading-space (see the casing note below).
        //
        // VALUES carry the successor's CANDIDATE DISPLAY CASING (PRD §07:
        // "value = the string to insert — always exactly one word
        // (candidate display casing)"; PRD §04: "Insertion uses the
        // candidate's display casing"). The successor index is lowercase-
        // keyed (h2.27), so the display comes from the word's own store
        // entry — the same most-recent-casing-wins display a word
        // completion inserts (store.ts upsert contract). A successor whose
        // word entry was already evicted (word eviction never touches
        // successors) falls back to the lowercase key — the pre-fix
        // behavior, reachable only past a 20k-store eviction of a
        // recently-seen word. Arming stays lowercase: liveKeyByValue maps
        // the display value to CHAIN_KEY_PREFIX + s.next (the key).
        const successorDisplay = (s: Successor): string =>
          store.get(s.next)?.display ?? s.next;
        const publishChain = (succ: readonly Successor[], prefix: string) => {
          const items = succ.map((s) => ({
            value: successorDisplay(s), // BARE — pi-tui splices verbatim at prefix ""
            label: successorDisplay(s),
            description: "chain", // provenance marker, role of query.ts's
          }));
          lastLive = {
            matches: succ.map((s) => ({
              key: CHAIN_KEY_PREFIX + s.next,
              display: successorDisplay(s),
              description: "chain",
              salience: -s.count, // higher count → stronger, count-desc order
              sessionCount: s.count, // RankedMatch key-2 field (§04 h2.29); publishChain's order is already count-desc
            })),
            prefix,
            ts: Date.now(),
          };
          liveKeyByValue.clear(); // rebuilt every query — same as normal path
          for (const s of succ) {
            liveKeyByValue.set(successorDisplay(s), CHAIN_KEY_PREFIX + s.next);
          }
          return { items, prefix };
        };

        // (a) Zero-typed-char offer — cursor at an empty word start.
        // Mutually exclusive with (b): a word start has no trailing word
        // chars, so the fragment regex below cannot match here; the
        // word-start check runs first to make the intent explicit.
        if (before === "" || /[ \t]$/.test(before)) {
          const succ = store
            .topSuccessors(armed.word)
            .slice(0, config.maxSuggestions); // ≤3 stored; cap for symmetry
          if (succ.length > 0) {
            const r = publishChain(succ, "");
            // Forced (PRD §07 h3.8): only the RETURNED payload narrows —
            // publishChain already published the FULL successor set to
            // lastLive/liveKeyByValue above. items[0] is topSuccessors'
            // count-desc top; never re-sorted. Prefix ("") unchanged.
            return forced ? { items: [r.items[0]], prefix: r.prefix } : r;
          }
          chain.reset(); // no successors → idle; the normal path answers NOW
        }

        // (b) Typed fragment — threshold-0 live filtering through the
        // SAME anchored fuzzy matcher as the query path, as a pure
        // MEMBERSHIP gate (§07 h2.49). `armed` may be stale after an (a)
        // reset, but a word start never matches the fragment regex, so
        // this only produces a menu for genuine fragments where `armed`
        // is still current.
        const frag = before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0];
        // BUG-005 word-start guard: a fragment glued to the trigger char
        // ("#b") or any punctuation ("!be") is NOT a chain fragment —
        // pi-tui's applyCompletion deletes exactly prefix.length chars
        // blindly, so answering at prefix "b" for buffer "#b" would
        // strand the "#" in the buffer. Require the fragment to sit at a
        // WORD START (line start or right after a space/tab); otherwise
        // disqualify exactly like the zero-successors case: reset + fall
        // through so the normal path (extractMatchState) answers on this
        // SAME keystroke — trigger mode wins at prefix "#b".
        const fragAt = frag === undefined ? -1 : before.length - frag.length;
        const fragAtWordStart =
          frag !== undefined &&
          (fragAt === 0 || /[ \t]/.test(before[fragAt - 1] ?? ""));
        const succ =
          frag === undefined || !fragAtWordStart
            ? []
            : store
                .topSuccessors(armed.word)
                // §07 h2.49 membership gate: matchFragment(frag, s.next)
                // returns a tier+score or null — ANY tier (3/2/1) passes
                // at chain threshold 0 (fuzzThreshold is never consulted
                // here), the score field is ignored, and NO re-sort
                // happens: the menu keeps topSuccessors' successor-count
                // order (the chain's ranking identity). matchFragment
                // lowercases both arguments internally — frag goes in
                // raw; the old explicit toLowerCase() is gone.
                .filter(
                  (s) =>
                    s.next !== frag.toLowerCase() && // exact-equal exclusion (§07 h2.49 parity with §04 h2.29)
                    matchFragment(frag, s.next) !== null,
                )
                .slice(0, config.maxSuggestions); // ≤3 stored; cap for symmetry
        if (frag === undefined || !fragAtWordStart || succ.length === 0) {
          // (c) Disqualify: punctuation, word-less non-start input, a
          // fragment not at a word start (BUG-005), or zero matching
          // successors → idle. Never return an empty hapax set — the
          // normal path (extractMatchState → rankMatches) or pi's stock
          // delegate answers on this SAME keystroke.
          chain.reset();
        } else {
          const r = publishChain(succ, frag); // prefix = the raw typed fragment
          // Forced: single-item return; lastLive above keeps the full set.
          return forced ? { items: [r.items[0]], prefix: r.prefix } : r;
        }
        } // end still-armed (one-shot check passed)
      }

      // 1.8 CLOSE-ON-SPACE (2026-09, "stuck file menu" fix): a non-forced
      // query at a plain trailing space — no '@', no '/', menu not in a
      // stock context — must CLOSE the menu (return null), never
      // delegate. Rationale: pi's stock provider treats text ending in a
      // space as the start of a file-completion context
      // (extractPathPrefix returns "" → the ENTIRE cwd listing), which in
      // stock pi is only reachable through deliberate flows (Tab-forced
      // file menu, '@' attachments). With hapax menus opening during
      // prose typing, the space after a word delegated straight into that
      // rule and REPLACED our menu with pi's file listing. Forced (Tab)
      // requests keep native delegation; '@'/'/'-bearing text keeps stock
      // path/mention behavior; the armed chain's zero-char offer (handled
      // above, before this guard) is untouched.
      const beforeText = lines[cursorLine]?.slice(0, cursorCol) ?? "";
      if (
        options.force !== true &&
        /\s$/.test(beforeText) &&
        !beforeText.includes("@") &&
        !beforeText.includes("/")
      ) {
        lastLive = null;
        liveKeyByValue.clear();
        return null;
      }
      // 2. No hapax match state (S1 null) → pi's completion stays in charge.
      // AUTO-OPEN (PRD §07 live-editor reality): pi-tui's handleChar fires
      // getSuggestions for plain letters ONLY at a word start (the
      // trigger-character branch's space/tab guard) — and the menu, once
      // open, self-updates every keystroke via updateAutocomplete. A
      // threshold above 1 is therefore UNOBSERVABLE on the typing path:
      // the word-start request arrives with a 1-char fragment, and if we
      // delegate there the menu never opens and no further request comes.
      // The effective threshold is clamped to 1 HERE (S1's pure threshold
      // semantics and its unit tests are untouched): the word-start
      // request answers with prefix-matched candidates, the menu opens,
      // and narrowing happens per keystroke from then on.
      const state = extractMatchState(lines, cursorLine, cursorCol, {
        ...config,
        threshold: 1,
      });
      if (!state) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      // 3. Synchronous store query — PRD §07 rule 1: zero awaits, zero
      // I/O before this point; the menu data exists when we return.
      // Per-mode fuzz resolution (spec §04 h2.28, plan 004): trigger mode
      // is hapax's explicit search-the-vocabulary gesture — looser
      // threshold (TRIGGER_FUZZ_THRESHOLD 45) AND the anchorless tier-0
      // pass consulted even over non-empty anchored results; ambient word
      // typing keeps the strict 60 default with the fallback only as a
      // zero-rescue. An explicit fuzzThreshold setting overrides BOTH
      // mode defaults (resolveFuzzThreshold; pinned by config.test.ts).
      const mode = state.mode === "trigger" ? "trigger" : "ambient";
      const matches = rankMatches(store, state.fragment, {
        limit: config.maxSuggestions,
        fuzzThreshold: resolveFuzzThreshold(config, mode),
        loose: state.mode === "trigger",
      });
      if (matches.length === 0) {
        // Zero candidates never render a menu: drop the live cache so
        // S3's hysteresis closes instead of repainting a stale result.
        lastLive = null;
        liveKeyByValue.clear();
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      // 4. Publish the live result and map to pi's menu shape. value and
      // label use the stored display casing verbatim (h2.27);
      // description is query.ts's provenance string — never reformatted.
      lastLive = { matches, prefix: state.prefix, ts: Date.now() };
      liveKeyByValue.clear(); // rebuilt every query — keys shift after eviction
      for (const m of matches) liveKeyByValue.set(m.display, m.key);
      // Forced (PRD §07 h3.8): only the RETURNED payload narrows to the
      // top-ranked item — lastLive/liveKeyByValue above keep the FULL set
      // (S3's display layer composes and debounces against it; a narrowed
      // cache would fight the hysteresis on the next un-forced keystroke).
      // items[0] is rankMatches' top (tier desc → sessionCount desc →
      // shorter → lexicographic) — never re-sorted. The prefix is
      // unchanged: pi-tui splices prefix.length characters before the
      // cursor verbatim.
      const items = matches.map((m) => ({
        value: m.display,
        label: m.display,
        description: m.description,
      }));
      return forced
        ? { items: [items[0]], prefix: state.prefix }
        : { items, prefix: state.prefix };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      // Arming side-effect ONLY (PRD §07 h2.43): classify what was
      // accepted through the live-key map, then delegate VERBATIM —
      // arguments and return value reach pi's provider untouched.
      // enableChaining gate (P1.M3.T1.S2): with the flag false nothing
      // ever arms — the chain layer is inert and the provider behaves
      // exactly as M1 word-only. Delegation itself is unconditional.
      //
      // liveKeyByValue keys come in exactly TWO shapes, checked in this
      // order:
      //   1. CHAIN_KEY_PREFIX + next — a chain successor was accepted;
      //      re-arm at it (armed(next)).
      //   2. a single token — a whole-word candidate; arm the mapped
      //      store key. This is also how trigger-mode completions
      //      arm: they are whole-word insertions (pinned by
      //      test/chain.test.ts case 11).
      //   Phrase keys no longer exist: rankMatches is words-only since
      //   P1.M1.T2.S2 (PRD §06 h2.38 one-word invariant), so plan 002's
      //   P1.M2.T1.S1 deleted the old space-joined phrase arm branch
      //   (BUG-005 part 2) as dead code.
      if (config.enableChaining) {
        const key = liveKeyByValue.get(item.value);
        if (key !== undefined) {
          if (key.startsWith(CHAIN_KEY_PREFIX)) {
            // A chain successor was accepted → armed(next); fresh one-shot
            // grant (the immediate offer for the NEXT word).
            chain.arm(key.slice(CHAIN_KEY_PREFIX.length));
            grant.reset(); // fresh one-shot grant (spec/07:450–457)
          } else {
            // Whole-word candidate: single whitespace-free tokens — words
            // and rule-4d path tokens alike. Arm the MAPPED STORE KEY,
            // never a lowercased display: a path display keeps its
            // original edges ("/home/x", "home/x/") while the store key
            // is the trimmed-lowercase form, so lowercasing the value
            // would miss the successor index. liveKeyByValue is the
            // value→key truth (h2.27; keys are stored lowercase). Fresh
            // one-shot grant.
            //
            // TIER-0 SUPPRESSION (spec §04, plan 004): anchorless matches
            // never arm a chain. liveKeyByValue carries only display→key —
            // the tier is not there — so look the accepted item up in
            // lastLive's ≤ 8 records by display. Strict `tier === 0`:
            // chain-shim entries (publishChain) and '#'-alone listing
            // records OMIT the field, so they keep arming; `tier <= 0` or
            // falsy checks would break chaining. Not found (stale/null
            // live set) → arm as before — fail-open; suppression only on
            // a KNOWN tier 0.
            const rec = lastLive?.matches.find((m) => m.display === item.value);
            if (rec?.tier === 0) {
              // tier-0 anchorless: never arms (spec §04).
            } else {
              chain.arm(key);
              grant.reset(); // fresh one-shot grant (spec/07:450–457)
            }
          }
        }
        // Not in the map (path completion / stale value) → never arms.
      }
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },

    __hapaxLive: () => lastLive,
    __hapaxKey: (value) => liveKeyByValue.get(value),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain machine — Tab-armed successor chaining (P2.M2.T2.S1, PRD §07 h2.43)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marker prefixed to every chain entry in liveKeyByValue (and used as
 * the shim RankedMatch.key) so applyCompletion can tell "a successor was
 * accepted → armed(next)" apart from plain word keys. The \u0000 lead
 * byte can never occur in a store key.
 */
const CHAIN_KEY_PREFIX = "\u0000chain:";

/**
 * The chain machine's state: `{ word }` while a Tab-accepted whole-word
 * hapax candidate W is armed, or null when idle.
 */
export type ChainState = { word: string } | null;

/**
 * The Tab-armed successor-chaining state holder (PRD §07 h2.43,
 * redesigned in plan 002 P1.M2.T1.S1). Two states:
 *
 *   idle ──Tab accepts a hapax candidate W──► armed(W)
 *         (W = a whole word or a chain successor — never a
 *         path-completion value)
 *   armed(W):
 *     - the zero-typed-char word start (line start, or right after a
 *       space/tab) → offer W's unfiltered top successors
 *       (store.topSuccessors) with BARE values at prefix ""
 *     - any typed fragment → filter that set live, at chain threshold 0
 *       — NOT config.threshold — for the whole chain duration
 *     - Tab with a highlighted successor → insert (delegated
 *       applyCompletion), transition armed(next)
 *     - disqualification: punctuation, word-less non-start input, zero
 *       matching successors, or an empty successor index → idle; the
 *       normal path (or pi's stock delegate) answers on the SAME
 *       keystroke
 *     - a new user turn (before_agent_start → reset) → idle
 *
 * INVARIANTS (PRD §01 invariant 1): the machine feeds the suggestion
 * set ONLY — it never blocks or captures typing, never swallows a
 * keystroke, never throws. Arming happens exclusively through hapax's
 * own applyCompletion side-effect (a hapax item was accepted: whole
 * word or chain successor); path-completion and out-of-map values never
 * arm. All timing and display composition stay in S3 — armed sets
 * publish through the same lastLive seam as normal results, so the
 * 100ms debounce composes unchanged.
 */
export interface ChainMachine {
  /** Current armed word, or null when idle. */
  state(): ChainState;
  /** Arm on acceptance of a hapax item: a whole word (lowercased), or
   *  a chain successor (already lowercase from the successor index). */
  arm(word: string): void;
  /** Force idle (before_agent_start; also the disqualification path). */
  reset(): void;
}

/**
 * Fresh idle machine. Deliberately dumb: no store reference, no timers,
 * no event listeners — the query side lives in createHapaxProvider's
 * armed branch, the arming side in its applyCompletion intercept, and
 * the reset triggers (disqualification, before_agent_start) call in.
 */
export function createChainMachine(): ChainMachine {
  let armed: string | null = null;
  return {
    state: () => (armed === null ? null : { word: armed }),
    arm: (word) => {
      armed = word;
    },
    reset: () => {
      armed = null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup gate — first queries wait (bounded) for history replay
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bounded startup gate (2026-09, "first typed word after restart missed
 * its menu"): restoreFromHistory replays session history in the
 * background, and pi-tui asks the provider exactly ONCE per word — so a
 * word queried while the store is still replaying got ZERO candidates
 * and never re-asked: its menu was permanently missing until retyped.
 * The gate turns that into "at most `maxWaitMs` late": every
 * getSuggestions call racing an unfinished replay waits for the
 * replay's onSettled signal (or the cap) before querying. Once settled,
 * calls are pure pass-through with zero overhead.
 *
 * Forced (Tab) requests wait too — bounded, and only during the
 * sub-second startup window; the synchronous-query Tab contract (spec
 * 07 rule 1) applies to the steady state, which this preserves.
 *
 * `ready` is a promise that resolves when replay settles; callers pass
 * an already-resolved promise when no restore is needed (fresh
 * sessions), making the gate a no-op there.
 */
export function createStartupGate<
  T extends AutocompleteProvider & { __hapaxLive: () => unknown; __hapaxKey: (v: string) => unknown },
>(base: T, ready: Promise<void>, maxWaitMs = 500): T {
  let settled = false;
  const settledPromise = ready.then(
    () => {
      settled = true;
    },
    () => {
      settled = true; // replay errors must never wedge the gate
    },
  );
  void settledPromise; // fire-and-forget; getSuggestions re-awaits as needed

  const gate = {
    ...base, // closure-based provider: method refs copy safely
    async getSuggestions(
      lines: string[],
      cursorLine: number,
      cursorCol: number,
      options: { signal: AbortSignal; force?: boolean },
    ) {
      if (!settled) {
        await Promise.race([
          settledPromise,
          new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
        ]);
      }
      return base.getSuggestions(lines, cursorLine, cursorCol, options);
    },
  };
  return gate as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 — display debounce + flicker hysteresis (P1.M3.T3.S3, PRD §07 rules 2–3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for createDisplayProvider. Everything optional; {} means
 * defaults.
 */
export interface DisplayProviderOptions {
  /**
   * Minimum milliseconds between visible menu changes (PRD §07 rule 2:
   * "The menu thus updates at most every 100 ms"). Default 100.
   */
  debounceMs?: number;
  /**
   * Hesitation gate for the menu's FIRST appearance (2026-09,
   * `menuDelayMs` config): a closed menu only paints on a word-start
   * query arriving at least this many ms after the PREVIOUS keystroke —
   * typing full speed (gaps under the threshold) never pops the menu,
   * hesitating mid-sentence does. Platform constraint (see provider
   * module doc / spec 07): pi-tui asks the provider exactly once per
   * word (at its first letter) — a suppressed first paint cannot be
   * recovered mid-word — so the gate measures inter-keystroke gaps at
   * the word boundary, not fragment age. 0 disables the gate
   * (immediate first paint, the pre-2026-09 behavior). Default 0 here;
   * index.ts wires the config value (default 150).
   */
  firstPaintDelayMs?: number;
  /**
   * Intent test: results that BYPASS the hesitation gate — explicit
   * completion intent (trigger-char prefix, armed-chain successors)
   * must always show immediately. Called with the fresh hapax result
   * after classification; default: nothing bypasses.
   */
  isIntentResult?: (result: { items: AutocompleteItem[]; prefix: string }) => boolean;
  /**
   * True keystroke clock for the hesitation gate (2026-09 fix): returns
   * the time of the keystroke BEFORE the one that triggered this query,
   * or null when unknown. Wired from the editor proxy's handleInput
   * (src/pi/editor.ts) — the ONLY seam that sees every keystroke.
   * Without it the gate falls back to inter-QUERY gaps, which when the
   * menu is closed are word-start-to-word-start (a whole word apart) and
   * therefore almost never suppress — the bug the first cut shipped
   * with. Default: absent (fallback behavior).
   */
  getPreviousKeystrokeAt?: () => number | null;
}

/**
 * Wrap a live hapax provider (S2's createHapaxProvider) with the display
 * state machine that decides what pi actually PAINTS (PRD §07 rules 2–3).
 * pi is PULL-based: nothing here can push a menu into the editor — pi
 * calls getSuggestions on every keystroke and we answer with the set that
 * should be visible.
 *
 * Contract (rules referenced are PRD §07 "Debounce, flicker, and the Tab
 * contract"):
 *
 *   1. base.getSuggestions runs on EVERY call, before any suppression
 *      decision — the inner provider and its live cache are never gated,
 *      so Tab (which resolves against __hapaxLive) stays instant (rule 1).
 *   1.5. Forced requests (options.force === true — pi-tui's Tab path,
 *      editor.js forwards {signal, force} down the chain) return the
 *      base result UNTOUCHED, immediately after rule 1's base call and
 *      BEFORE any classification: no __hapaxLive() consult, no
 *      suppression window, no paint, no reset, no pending bookkeeping
 *      (PRD §07 h3.8 — forced requests are undelayed by design; the base
 *      layer already narrowed forced hapax returns to the single live
 *      top item, P1.M2.T2.S1, so classifying here would swallow the
 *      single-item result into the debounce machine and re-serve a
 *      stale multi-item set). Forced calls are invisible to the
 *      scheduler: displayed/pending state and timers are left exactly
 *      as the surrounding non-forced keystrokes left them.
 *   2. The result is a HAPAX result iff __hapaxLive() is non-null AND the
 *      inner result carries the live prefix. The prefix check is not
 *      paranoia: S2 does NOT clear its live cache on the null-match-state
 *      / aborted delegate paths (only on zero candidates), so a stale
 *      cache can coexist with a delegated built-in result — that delegate
 *      must never enter the debounce machine, or suppression would hold a
 *      stale hapax set over pi's own path/slash menu.
 *   3. Close / delegate events (null result, delegated result, empty
 *      hapax items — empty is invisible) pass the inner result through
 *      UNCHANGED and reset all scheduler state, so the next qualifying
 *      keystroke re-opens fresh (no stale set, no timers).
 *   4. Non-empty hapax sets: identical signature → repaint (idempotent,
 *      refreshes lastPaintAt); first paint or ≥debounceMs since the last
 *      one → paint immediately; otherwise (suppression window) return the
 *      currently displayed set and remember the new one as PENDING — a
 *      newer keystroke supersedes it. The pending swap applies on the
 *      next getSuggestions call; the timer only promotes internal state
 *      between keystrokes (bookkeeping + a cleanup handle for dispose).
 *      EXCEPTION — acceptance invalidates the anchor: when
 *      applyCompletion has run since the last paint, the buffer changed
 *      underneath the displayed set (pi re-queries at the post-accept
 *      cursor, always inside the window for a fast second Tab), and
 *      re-serving the displayed set would hand pi a stale `prefix` —
 *      applyCompletion replaces prefix.length characters before the
 *      cursor verbatim, so a stale anchor DELETES accepted text (the
 *      rapid Tab-Tab corruption: "discuss National" + stale prefix
 *      "natio" → "discuss NatNational"). In that case the fresh set
 *      paints immediately instead of being parked as pending.
 *
 *      EXCEPTION (BUG-002) — typing invalidates the anchor too: when the
 *      fresh result's prefix differs from the displayed set's, the buffer
 *      moved the anchor (a character typed or deleted), and re-serving
 *      the displayed set would hand pi its OLD prefix. The same verbatim
 *      deletion math then destroys typed text ("ze" paints, "zep" typed
 *      inside the window, Tab on the stale "ze" prefix → "zZendesk",
 *      the PRD's "zzendesk" corruption). The fresh set paints
 *      immediately, exactly as for acceptance. Suppression therefore
 *      only ever re-serves a displayed set whose prefix EQUALS the fresh
 *      prefix — i.e. same-buffer re-queries (store-driven membership
 *      changes), never keystrokes that moved the anchor.
 *
 * Narrowing needs no special case: rule 4 always returns a non-empty set
 * once open, so pi never observes zero-then-nonzero — no close+reopen
 * (rule 3's invariant falls out of "always non-empty"). applyCompletion,
 * shouldTriggerFileCompletion and triggerCharacters pass through to base
 * verbatim — the display layer never touches insertion semantics.
 *
 * dispose() clears every pending timer and all scheduler state;
 * P1.M3.T5.S1 calls it in session_shutdown (PRD §02: everything dies).
 */
export function createDisplayProvider(
  base: AutocompleteProvider & { __hapaxLive: () => LiveResult | null },
  opts: DisplayProviderOptions = {},
): AutocompleteProvider & { dispose: () => void } {
  const debounceMs = opts.debounceMs ?? 100;
  const firstPaintDelayMs = opts.firstPaintDelayMs ?? 0;
  const isIntentResult = opts.isIntentResult ?? (() => false);
  const getPreviousKeystrokeAt = opts.getPreviousKeystrokeAt;

  // PopupScheduler state (PRD §07 rules 2–3) — all closure-private.
  // displayed* is what pi was last told to paint; pending* is the swap
  // scheduled inside the suppression window (superseded per keystroke).
  let displayedSig: string | null = null; // "\u0000"-joined values on screen
  let displayedItems: AutocompleteItem[] = [];
  let displayedPrefix = "";
  let lastPaintAt = 0; // Date.now() of the last visible-set change
  // Hesitation gate (2026-09 menuDelayMs): Date.now() of the previous
  // non-forced getSuggestions call — each such call IS a keystroke in
  // pi-tui's pull model. Null before the first call.
  let lastKeystrokeAt: number | null = null;
  // True once applyCompletion has run since the last paint: the buffer
  // changed underneath the displayed set, so its prefix anchor is stale
  // and must never be re-served (rule 4's acceptance exception).
  let completionSincePaint = false;
  let pendingSig: string | null = null;
  let pendingItems: AutocompleteItem[] = [];
  let pendingPrefix = "";
  const timers = new Set<ReturnType<typeof setTimeout>>(); // dispose() owns these

  const clearTimers = (): void => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  /** Close/delegate cleanup + dispose(): no menu, no pending swap, no timers. */
  const reset = (): void => {
    clearTimers();
    displayedSig = null;
    displayedItems = [];
    displayedPrefix = "";
    lastPaintAt = 0;
    completionSincePaint = false;
    pendingSig = null;
    pendingItems = [];
    pendingPrefix = "";
  };

  /** Stable per-set signature: the display values in menu order. */
  const signatureOf = (items: AutocompleteItem[]): string =>
    items.map((i) => i.value).join("\u0000");

  /** Fresh array of fresh items — pi never gets a live reference into our state. */
  const copyOf = (items: AutocompleteItem[]): AutocompleteItem[] =>
    items.map((i) => ({ ...i }));

  /** Make `items` the displayed set and advance the window clock. */
  const paint = (items: AutocompleteItem[], prefix: string): void => {
    clearTimers(); // an immediate paint supersedes any scheduled swap
    pendingSig = null;
    pendingItems = [];
    pendingPrefix = "";
    displayedSig = signatureOf(items);
    displayedItems = items;
    displayedPrefix = prefix;
    lastPaintAt = Date.now();
    completionSincePaint = false; // this paint reflects the post-accept buffer
  };

  /** Timer callback: promote the pending swap (if it survived) to displayed. */
  const promotePending = (): void => {
    if (pendingSig === null) return; // nothing pending — bookkeeping only
    displayedSig = pendingSig;
    displayedItems = pendingItems;
    displayedPrefix = pendingPrefix;
    lastPaintAt = Date.now();
    pendingSig = null;
    pendingItems = [];
    pendingPrefix = "";
  };

  /** Schedule the pending promotion; a newer keystroke supersedes the old timer. */
  const scheduleSwap = (): void => {
    clearTimers();
    const t = setTimeout(() => {
      timers.delete(t);
      promotePending();
    }, debounceMs);
    timers.add(t);
  };

  return {
    triggerCharacters: base.triggerCharacters,

    async getSuggestions(lines, cursorLine, cursorCol, options) {
      // 1. ALWAYS query the inner provider first — it (and Tab's live
      // cache) is never gated by the display layer.
      const result = await base.getSuggestions(lines, cursorLine, cursorCol, options);

      // 1.5. Forced requests (pi-tui Tab path, editor.js ~1892 forwards
      // {signal, force}) are undelayed BY DESIGN (PRD §07 h3.8): return
      // the base result untouched — no classification, no suppression
      // window, no pending swap scheduling. The base layer already
      // narrowed forced hapax returns to the single live top item
      // (P1.M2.T2.S1); re-serving a displayed/pending set here would
      // resurrect the stale multi-item set pi-tui's single-item fast
      // path is meant to consume. Forced calls do NOT touch scheduler
      // state: displayed* stays as-is and any pending swap stays
      // scheduled for the next NON-forced query (supersede semantics
      // unchanged). Strict === true — force is optional and foreign
      // callers may pass truthy non-booleans that must not fire the
      // branch.
      if (options.force === true) return result;

      // Hesitation-gate bookkeeping: this call is a keystroke. Record
      // the gap to the PREVIOUS one before overwriting (the gate below
      // reads the pre-call value). Forced calls are invisible here —
      // same as everywhere in the scheduler.
      const prevKeystrokeAt = lastKeystrokeAt;
      lastKeystrokeAt = Date.now();

      const live = base.__hapaxLive();

      // 2–3. Close / delegate / defensively-empty: classify AFTER the inner
      // call (see doc comment for the prefix check), pass through untouched.
      const isHapax =
        live !== null &&
        result !== null &&
        result.items.length > 0 &&
        result.prefix === live.prefix;
      if (!isHapax) {
        reset();
        return result;
      }

      const items = result.items.map((i) => ({ ...i })); // defensive copy
      const sig = signatureOf(items);

      // 3.5. Hesitation gate (2026-09 menuDelayMs): while the menu is
      // CLOSED and the fresh result is a word-completion (not explicit
      // intent — trigger char / chain), paint only when the keystroke
      // that triggered this query arrived ≥ firstPaintDelayMs after the
      // PREVIOUS keystroke — full-speed typing (small gaps) never pops
      // the menu. Keystroke times come from the editor proxy's input
      // clock (getPreviousKeystrokeAt); the lastKeystrokeAt fallback
      // below is inter-QUERY timing, which — because a closed menu gets
      // exactly one query per word — measures word-to-word distance and
      // almost never suppresses (the first cut's bug). Platform reality:
      // this query is the word's ONLY one, so suppressing here means no
      // menu for this word — the requested behavior for flow typing.
      // Returning empty items keeps the menu closed (pi-tui cancels on
      // zero items); an empty set carries no prefix anchor (BUG-002
      // invariant holds).
      const prevAt = getPreviousKeystrokeAt?.() ?? prevKeystrokeAt;
      if (
        displayedSig === null &&
        firstPaintDelayMs > 0 &&
        prevAt !== null &&
        Date.now() - prevAt < firstPaintDelayMs &&
        !isIntentResult({ items, prefix: result.prefix })
      ) {
        return { items: [], prefix: result.prefix };
      }

      // 4a. First paint or idempotent repaint — never delay the menu's
      // first appearance; identical sets refresh the window clock.
      if (displayedSig === null || sig === displayedSig) {
        paint(items, result.prefix);
        return { items: copyOf(displayedItems), prefix: displayedPrefix };
      }

      // 4b. Window elapsed → paint immediately.
      if (Date.now() - lastPaintAt >= debounceMs) {
        paint(items, result.prefix);
        return { items: copyOf(displayedItems), prefix: displayedPrefix };
      }

      // 4c-exception. Acceptance invalidates the anchor: applyCompletion
      // ran since the last paint, so the buffer changed underneath the
      // displayed set (a fast second Tab re-queries at the post-accept
      // cursor inside the suppression window). Re-serving the displayed
      // set would hand pi its PRE-acceptance prefix; pi's applyCompletion
      // replaces prefix.length characters before the cursor verbatim, so
      // a stale anchor destroys accepted text ("discuss National" →
      // "discuss NatNational"). Paint the fresh set immediately instead
      // of parking it as pending — normal narrowing suppression (no
      // acceptance in between) is untouched.
      if (completionSincePaint) {
        paint(items, result.prefix);
        return { items: copyOf(displayedItems), prefix: displayedPrefix };
      }

      // 4d-exception (BUG-002). Prefix-anchor invalidation: the fresh
      // result's prefix differs from the displayed set's, so the buffer
      // changed in a way that moved the anchor (narrowing typed a char,
      // backspace, etc.). Re-serving the displayed set would hand pi its
      // old prefix; pi's applyCompletion replaces prefix.length characters
      // before the cursor VERBATIM with no re-verification at Tab time
      // (pi-tui autocomplete.js applyCompletion: blind
      // line.slice(0, cursorCol - prefix.length) splice), so a stale
      // anchor destroys typed text ("zep" typed inside the window + Tab
      // on the stale "ze" prefix → "zZendesk", the PRD's "zzendesk"
      // corruption).
      // HARD INVARIANT: this provider NEVER returns a prefix that is not
      // the exact suffix of the current line at the cursor. Paint the
      // fresh set immediately. Suppression may only re-serve a displayed
      // set whose prefix still equals the fresh prefix (suffix-matches
      // the buffer — the isHapax check in steps 2–3 guarantees fresh
      // prefixes are computed from the CURRENT buffer). Do NOT
      // re-validate against the buffer here: fresh results are
      // buffer-derived by construction; refusing to re-serve stale ones
      // is the whole fix.
      if (result.prefix !== displayedPrefix) {
        paint(items, result.prefix);
        return { items: copyOf(displayedItems), prefix: displayedPrefix };
      }

      // 4d. Suppression window (identical-prefix set changes only — a
      // moved anchor never reaches this branch, see the 4d-exception):
      // keep what's on screen; remember the new set (superseding any
      // earlier pending) and schedule its promotion. pi pulls the
      // promoted set on a later getSuggestions call.
      pendingSig = sig;
      pendingItems = items;
      pendingPrefix = result.prefix;
      scheduleSwap();
      return { items: copyOf(displayedItems), prefix: displayedPrefix };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      // Acceptance invalidates the displayed set's prefix anchor (see the
      // 4c-exception in getSuggestions): flag it so the next query inside
      // the suppression window paints fresh instead of re-serving the
      // stale pre-acceptance set.
      completionSincePaint = true;
      return base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return base.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },

    dispose() {
      reset();
    },
  };
}