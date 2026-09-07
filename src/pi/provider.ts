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
 */

import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

import { rankMatches } from "../core/query.js";
import type { CandidateStore } from "../core/store.js";
import type { RankedMatch } from "../core/types.js";
import type { HapaxConfig } from "./config.js";

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
  const t = before.match(/[A-Za-z][A-Za-z0-9_]*$/);
  if (t && t[0].length >= config.threshold) {
    return { mode: "threshold", fragment: t[0], prefix: t[0] };
  }

  // DELEGATE: neither mode matched — S2 must return
  // current.getSuggestions(...) unchanged.
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
 *   2. extractMatchState returns null → delegate (never-hijack rules:
 *      pi's path/slash completion stays exactly as before).
 *   3. rankMatches returns [] → clear the live cache, then delegate
 *      (zero candidates never render a menu).
 *
 * Delegation forwards the ORIGINAL arguments object unchanged — no
 * cloning, no dropping `force`. All other members pass straight
 * through: applyCompletion and shouldTriggerFileCompletion always
 * delegate (current may leave the latter undefined → default true, pi's
 * own behavior). triggerCharacters mirrors config.triggerChar, and is
 * undefined — not [] — when trigger mode is disabled ("").
 *
 * The store is accepted, never constructed (src/core architecture); the
 * config is trusted (loadConfig already validated it); no debounce or
 * hysteresis lives here — that is S3's job. This factory holds the only
 * per-provider state (the live cache), published for S3 / P2.M2.T2.S1
 * via __hapaxLive / __hapaxKey.
 */
export function createHapaxProvider(
  store: CandidateStore,
  config: HapaxConfig,
  current: AutocompleteProvider,
): HapaxProvider {
  // Live-result cache — written on every query, read by S3 / P2.M2.T2.S1
  // through the accessors below. Never read by getSuggestions itself:
  // each keystroke is answered fresh from the store.
  let lastLive: LiveResult | null = null;
  const liveKeyByValue = new Map<string, string>(); // item.value → RankedMatch.key

  return {
    triggerCharacters: config.triggerChar ? [config.triggerChar] : undefined,

    async getSuggestions(lines, cursorLine, cursorCol, options) {
      // 1. Aborted → pass pi's request through, arguments untouched.
      if (options.signal.aborted) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      // 2. No hapax match state (S1 null) → pi's completion stays in charge.
      const state = extractMatchState(lines, cursorLine, cursorCol, config);
      if (!state) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      // 3. Synchronous store query — PRD §07 rule 1: zero awaits, zero
      // I/O before this point; the menu data exists when we return.
      const matches = rankMatches(store, state.fragment, {
        limit: config.maxSuggestions,
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
      return {
        items: matches.map((m) => ({
          value: m.display,
          label: m.display,
          description: m.description,
        })),
        prefix: state.prefix,
      };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
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

  // PopupScheduler state (PRD §07 rules 2–3) — all closure-private.
  // displayed* is what pi was last told to paint; pending* is the swap
  // scheduled inside the suppression window (superseded per keystroke).
  let displayedSig: string | null = null; // "\u0000"-joined values on screen
  let displayedItems: AutocompleteItem[] = [];
  let displayedPrefix = "";
  let lastPaintAt = 0; // Date.now() of the last visible-set change
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

      // 4c. Suppression window: keep what's on screen; remember the new set
      // (superseding any earlier pending) and schedule its promotion. pi
      // pulls the promoted set on a later getSuggestions call.
      pendingSig = sig;
      pendingItems = items;
      pendingPrefix = result.prefix;
      scheduleSwap();
      return { items: copyOf(displayedItems), prefix: displayedPrefix };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
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