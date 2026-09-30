/**
 * One-shot grant tracker (spec/07:450–457, bugfix 001_1a2f4ffe408f,
 * plan 004 P1.M1.T2.S2) — the armed-chain word-boundary counter, shared
 * by BOTH display paths so they cannot drift:
 *
 *   - the fallback provider's armed branch (src/pi/provider.ts) ticks it
 *     on every armed answer with a live prefix;
 *   - the widget's chain consult branch (src/pi/widget.ts) ticks it
 *     before painting its offers;
 *   - every arm site (provider applyCompletion, widget Tab acceptance)
 *     calls reset() beside chain.arm — a fresh grant per acceptance.
 *
 * WHY: without the tracker, an armed chain keeps popping successor offers
 * at EVERY word start for the rest of the message (the 2026-09
 * live-reproduced popping this grant was built to stop). The spec's
 * one-shot grant: exactly ONE word per acceptance; typing through the
 * offered word without accepting disarms at the NEXT word boundary (the
 * normal path answers that same keystroke); acceptance re-arms with a
 * fresh grant.
 *
 * The tick/word-boundary logic and its comment are ported VERBATIM from
 * provider.ts (where the canary suites pin the behavior byte-for-byte) —
 * do not "clean it up" here; change both via the shared helper only.
 *
 * Pure: closure state only, no imports, no config surface. Instances are
 * CHEAP and PER-OWNER: the provider creates one inside
 * createHapaxProvider, the widget factory one beside the chain machine —
 * never module-level (two providers must not share grant state).
 */

/** The one-shot grant seam consumed by both display paths. */
export interface ChainGrantTracker {
  /**
   * Feed the armed branch's current prefix read each tick: "" at an empty
   * word start, the trailing word-regex fragment, or omit the call when
   * no fragment is live (null prefixes skip the tick entirely —
   * disqualification is the caller's other guards' job). Returns true
   * when the grant is spent (second word reached) — the caller MUST
   * chain.reset() and fall through; the tracker has already zeroed
   * itself, so never double-reset.
   */
  tick(curArmedPrefix: string): boolean;
  /** Fresh grant — call at every arm site, beside chain.arm. */
  reset(): void;
}

/** Create a per-owner grant tracker (see module doc for ownership). */
export function createChainGrantTracker(): ChainGrantTracker {
  let seen = 0;
  let lastPrefix: string | null = null;
  return {
    tick(cur: string): boolean {
      // Word-boundary detection, empty-prefix asymmetry and all:
      //   - first armed answer of this arming → the GRANTED word
      //     (counts as word 1)
      //   - "" → non-empty = typing INTO the granted offer (same word)
      //   - non-empty → "" = moved past a typed-through word (new word)
      //   - two non-empties with no prefix relation = different words;
      //     mutual prefix relation (incl. backspace) = same word
      const isNewWord =
        lastPrefix === null
          ? false
          : cur === "" && lastPrefix !== ""
            ? true
            : cur !== "" &&
                lastPrefix !== "" &&
                !cur.startsWith(lastPrefix) &&
                !lastPrefix.startsWith(cur);
      if (lastPrefix === null) {
        seen = 1; // the granted offer's word
      } else if (isNewWord) {
        seen += 1;
      }
      if (seen >= 2) {
        // Typed through the granted offer without accepting → spent.
        // Zero HERE (the caller must not double-reset) and report, so the
        // caller resets the chain and falls through on this SAME tick.
        seen = 0;
        lastPrefix = null;
        return true;
      }
      lastPrefix = cur;
      return false;
    },
    reset() {
      seen = 0;
      lastPrefix = null;
    },
  };
}
