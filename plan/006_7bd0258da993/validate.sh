#!/usr/bin/env bash
# ============================================================================
# hapax — comprehensive validation script
#
# Phases (mirrors the project's own definition of green, spec/09 + README
# "Checks", plus real end-to-end user-journey verification):
#   1. Type checking          — tsc --noEmit (strict)
#   2. Unit + perf-gate tests — vitest --run (includes perf-gates.test.ts)
#   3. Dictionary artifact    — integrity + deterministic rebuild byte-compare
#   4. Calibration probe      — spec-04 admission verdicts spot-check
#   5. Benchmarks             — vitest bench (informational; hard bounds in 2)
#   6. Live TTY E2E           — real pi in tmux (spec 09 binding technique);
#                               the README "Quick start" user journey:
#                               seed vocab → ze→Zendesk → Tab insert → #l→lwlock
#                               → prose no-menu. Skipped (with a notice) when
#                               tmux/pi are unavailable or HAPAX_SKIP_LIVE=1.
#
# Exit 0 = all applicable phases green. Any phase failure exits 1.
# ============================================================================
set -u
cd "$(dirname "$0")"

PASS=0; FAIL=0
note()  { printf '%s\n' "$*"; }
good()  { printf 'PASS: %s\n' "$*"; PASS=$((PASS+1)); }
bad()   { printf 'FAIL: %s\n' "$*"; FAIL=$((FAIL+1)); }
section() { printf '\n========== %s ==========\n' "$*"; }

# ---------------------------------------------------------------- Phase 1
section "Phase 1: Type checking (npm run check)"
if npm run check >/tmp/hapax-val-check.log 2>&1; then
  good "tsc --noEmit clean"
else
  bad "typecheck failed — tail:"
  tail -20 /tmp/hapax-val-check.log
fi

# ---------------------------------------------------------------- Phase 2
section "Phase 2: Unit + adversarial + perf-gate tests (npm test)"
if npx vitest --run --reporter=dot >/tmp/hapax-val-test.log 2>&1; then
  good "vitest suite green ($(grep -oE 'Tests[[:space:]]+[0-9]+ passed( \| [0-9]+ skipped)?' /tmp/hapax-val-test.log | tail -1 | tr -s ' '))"
else
  bad "vitest suite has failures — summary:"
  grep -E "Test Files|Tests |FAIL" /tmp/hapax-val-test.log | tail -20
fi

# ---------------------------------------------------------------- Phase 3
section "Phase 3: Dictionary artifact integrity + deterministic rebuild"
DICT=dict/common-en.bin
if [ ! -f "$DICT" ]; then
  bad "shipped dictionary $DICT missing"
else
  SIZE=$(stat -c%s "$DICT")
  [ "$SIZE" -eq 850554 ] && good "artifact size $SIZE == spec 03 (850,554 bytes)" \
                         || bad "artifact size $SIZE != 850554 (spec 03)"
  if node tools/build-dict.mjs --out /tmp/hapax-val-rebuild.bin tools/corpus/en-50k.tsv \
       >/tmp/hapax-val-build.log 2>&1 \
     && grep -q "verified: 48802/48802 entries OK, no duplicate keys" /tmp/hapax-val-build.log; then
    good "rebuild self-verified (48,802 entries, no duplicate keys)"
    cmp -s "$DICT" /tmp/hapax-val-rebuild.bin \
      && good "rebuild is byte-identical to shipped artifact (deterministic)" \
      || bad "rebuild differs from shipped artifact"
  else
    bad "build-dict failed — see /tmp/hapax-val-build.log"
  fi
fi

# ---------------------------------------------------------------- Phase 4
section "Phase 4: Calibration probe — spec 04 admission verdicts"
CAL=$(node tools/calibrate-bands.mjs the context provider node uploads 2>/dev/null)
echo "$CAL" | sed 's/^/    /'
[ -n "$CAL" ] || CAL=" " # guard for set -u grep below
echo "$CAL" | grep -Eq "the[[:space:]]+len=3[[:space:]]+q=240[[:space:]]+R_eff=30[[:space:]]+REJECT" \
  && good "'the' rejects (prose head)" || bad "'the' verdict wrong"
echo "$CAL" | grep -Eq "context[[:space:]]+len=7[[:space:]]+q=51[[:space:]]+R_eff=30[[:space:]]+REJECT" \
  && good "'context' rejects (PRD's named example)" || bad "'context' verdict wrong"
echo "$CAL" | grep -Eq "node[[:space:]]+len=4[[:space:]]+q=23[[:space:]]+R_eff=30[[:space:]]+g1" \
  && good "'node' admits g1 (2026-10 R=30 flip)" || bad "'node' verdict wrong"
echo "$CAL" | grep -Eq "uploads[[:space:]]+len=7[[:space:]]+q=absent[[:space:]]+R_eff=30[[:space:]]+REJECT" \
  && good "'uploads' rejects (conjugation guard on absent inflection)" || bad "'uploads' verdict wrong"

# ---------------------------------------------------------------- Phase 5
section "Phase 5: Benchmarks (npm run bench — informational)"
if npm run bench >/tmp/hapax-val-bench.log 2>&1; then
  good "bench suite completed (hard bounds already asserted in Phase 2 perf gates)"
  grep -E "^\s+· gate" /tmp/hapax-val-bench.log | sed 's/^/    /' || true
else
  bad "bench suite failed — see /tmp/hapax-val-bench.log"
fi

# ---------------------------------------------------------------- Phase 6
section "Phase 6: Live TTY E2E (spec 09 binding technique)"
if [ "${HAPAX_SKIP_LIVE:-0}" = "1" ]; then
  note "SKIP: HAPAX_SKIP_LIVE=1"
elif ! command -v tmux >/dev/null || ! command -v pi >/dev/null; then
  note "SKIP: tmux or pi not on PATH (live verification unavailable)"
else
  S=hapaxval$RANDOM; OUT=/tmp/hapax-val-live; mkdir -p "$OUT"
  bottom() { tmux capture-pane -t "$S" -p | grep -v '^[[:space:]]*$' | tail -6; }
  # menu rows only (fallback vertical menu): arrow pointer / "session xN"
  # description rows — transcript text never matches this shape
  menurows() { tmux capture-pane -t "$S" -p | grep -E "→|session x[0-9]" | grep -v "Working"; }
  STORE_DUMP=/tmp/hapax-store.txt
  DUMP_BEFORE=$(stat -c%Y "$STORE_DUMP" 2>/dev/null || echo 0)
  tmux kill-session -t "$S" 2>/dev/null
  # NOTE: MCP connection errors from the user's global pi config are
  # environmental noise, not hapax failures — hapax itself must load clean.
  tmux new-session -d -s "$S" -x 200 -y 50 "pi --no-session -e $(pwd)" && sleep 4

  # Journey step 1 (BEFORE any Escape press — pi's editor may start in a
  # mode-switchable state; at startup it is INSERT): prose 'th' must not
  # surface hapax vocabulary (never-hijack probe). Assert 'th' actually
  # reached the input so the probe cannot pass vacuously.
  tmux send-keys -t "$S" t; sleep 0.12; tmux send-keys -t "$S" h; sleep 1.0
  bottom > "$OUT/C-th.txt"; menurows > "$OUT/C-th-menu.txt"
  grep -qE "^th" "$OUT/C-th.txt" \
    && good "probe sanity: 'th' reached the input line (INSERT mode)" \
    || bad "probe sanity: 'th' not in input (editor not in INSERT at startup?)"
  if grep -qiE "zendesk|lwlock|quokkaflux" "$OUT/C-th-menu.txt"; then
    bad "prose 'th' surfaced hapax vocabulary on the menu (see $OUT/C-th-menu.txt)"
  else
    good "prose 'th' shows no hapax menu rows (common words never menu)"
  fi
  tmux send-keys -t "$S" C-c; sleep 0.5
  for i in $(seq 4); do tmux send-keys -t "$S" BSpace; sleep 0.04; done

  # Journey step 2: seed the store (README Usage scenario)
  tmux send-keys -t "$S" "Zendesk lwlock quokkaflux integration check"; sleep 0.3
  tmux send-keys -t "$S" Enter; sleep 3
  tmux send-keys -t "$S" C-c; sleep 1; tmux send-keys -t "$S" C-c; sleep 0.5

  # Journey step 3: 'ze' → menu offers Zendesk; Tab inserts it (cased)
  tmux send-keys -t "$S" z; sleep 0.12; tmux send-keys -t "$S" e; sleep 1.0
  bottom > "$OUT/A-ze-menu.txt"
  tmux send-keys -t "$S" Tab; sleep 0.5
  bottom > "$OUT/A-ze-after-tab.txt"
  tmux send-keys -t "$S" C-c; sleep 0.3

  # Journey step 4: '#l' → lwlock (trigger char)
  tmux send-keys -t "$S" '#'; sleep 0.15; tmux send-keys -t "$S" l; sleep 1.0
  bottom > "$OUT/B-hash-l.txt"
  tmux send-keys -t "$S" C-c; sleep 0.5
  tmux kill-session -t "$S" 2>/dev/null

  grep -q "Zendesk" "$OUT/A-ze-menu.txt" \
    && good "'ze' offers Zendesk on the suggestion surface" \
    || bad "'ze' did not offer Zendesk (see $OUT/A-ze-menu.txt)"
  grep -q "Zendesk" "$OUT/A-ze-after-tab.txt" \
    && good "Tab inserted 'Zendesk' (cased) into the input" \
    || bad "Tab did not insert Zendesk (see $OUT/A-ze-after-tab.txt)"
  grep -q "lwlock" "$OUT/B-hash-l.txt" \
    && good "'#l' offers lwlock (trigger char)" \
    || bad "'#l' did not offer lwlock (see $OUT/B-hash-l.txt)"
  # No persistence invariant: the debug store dump must not be (re)written
  # by the live session with debug off. Compare mtimes: the TEST SUITE
  # (test/debug.test.ts) legitimately writes this path via the sanctioned
  # /acwords command — only a live-session write is a violation.
  DUMP_AFTER=$(stat -c%Y "$STORE_DUMP" 2>/dev/null || echo 0)
  [ "$DUMP_AFTER" -gt "$DUMP_BEFORE" ] \
    && bad "debug store dump rewritten by live session (persistence invariant)" \
    || good "no debug store dump written by live session (RAM-only invariant)"
fi

# ---------------------------------------------------------------- Summary
printf '\n========== SUMMARY ==========\n'
printf 'passed checks: %d   failed checks: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  note "VERDICT: ISSUES FOUND"
  exit 1
fi
note "VERDICT: ALL GREEN"
exit 0
