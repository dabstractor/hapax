#!/usr/bin/env bash
# validate.sh — hapax comprehensive validation
#
# Phases (only what exists in this codebase):
#   1. Type checking        — `npm run check` (tsc --noEmit, strict). No
#                             separate linter/formatter config exists.
#   2. Architecture check   — src/core/ purity invariant (no pi imports).
#   3. Unit + integration   — `npm test` (vitest): 38 files covering the
#                             full spec §09 battery, perf gates (CI 3× rule),
#                             no-persistence filesystem assertion, adversarial
#                             suites, live `pi -p -e` extension smoke.
#   4. Artifact integrity   — shipped dict/common-en.bin header vs spec §03,
#                             plus a full rebuild from tools/corpus/en-50k.tsv
#                             that must be BYTE-IDENTICAL to the artifact.
#   5. Calibration probe    — spec §04's measured-effect exemplars must keep
#                             their recorded verdicts under R_eff.
#   6. Live TTY E2E         — spec §09's BINDING live-verification technique:
#                             ephemeral `pi --no-session` in tmux; seed a
#                             session, then verify widget display, Tab casing,
#                             trigger char, chain, arrow entry + carousel,
#                             boundary pass-through, Enter-submits, and the
#                             secrets gate. Skips (does not fail) when the
#                             environment lacks tmux/pi/model. Set
#                             HAPAX_SKIP_LIVE=1 to force-skip.
#
# Usage: ./validate.sh
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
SKIPPED=0
declare -a FAILURES=()

ok()   { PASS=$((PASS+1)); echo "  [PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); FAILURES+=("$1"); echo "  [FAIL] $1"; }
skip() { SKIPPED=$((SKIPPED+1)); echo "  [SKIP] $1"; }

section() { echo; echo "=== $1 ==="; }

# ─────────────────────────────────────────────────────────────────────────────
section "Phase 1: Type checking (tsc --noEmit, strict)"

if npx tsc --noEmit; then
  ok "typecheck clean"
else
  bad "typecheck failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Phase 2: Architecture invariant — src/core/ has no pi imports"

CORE_PI_IMPORTS=$(grep -rEn "from ['\"]@earendil-works|from ['\"]\.\./pi/" src/core/ 2>/dev/null | wc -l)
if [ "$CORE_PI_IMPORTS" -eq 0 ]; then
  ok "src/core/ is pi-free (pure, agent-agnostic layer)"
else
  bad "src/core/ contains pi imports ($CORE_PI_IMPORTS):"
  grep -rEn "from ['\"]@earendil-works|from ['\"]\.\./pi/" src/core/ || true
fi

# src/pi/index.ts must be the single pi entry (package.json manifest)
if node -e '
  const p = require("./package.json");
  if (!p.pi?.extensions?.includes("./src/pi/index.ts")) process.exit(1);
'; then
  ok "package.json pi manifest points at src/pi/index.ts"
else
  bad "package.json pi manifest missing/incorrect"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Phase 3: Unit + integration tests (vitest)"

if [ "${CI:-0}" = "1" ]; then
  # CI: suite already contains perf-gates.test.ts (the 3× CI rule) and the
  # live pi -p -e smoke (environmental-skip aware).
  if npx vitest --run; then ok "vitest suite green"; else bad "vitest suite failed"; fi
else
  OUT=$(npx vitest --run 2>&1); CODE=$?
  echo "$OUT" | tail -6
  if [ $CODE -eq 0 ]; then
    ok "vitest suite green"
    # The suite must actually contain the required §09 files (not silently
    # unregistered): count them explicitly.
    for f in segment shapeGate score store dictionary query provider widget \
             perf-gates no-persistence acceptance; do
      if ls test/$f.test.ts >/dev/null 2>&1; then :; else bad "missing test/$f.test.ts"; fi
    done
    ok "required §09 test files present"
  else
    bad "vitest suite failed"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Phase 4: Dictionary artifact integrity + reproducible rebuild"

DICT_NODE_PROBE='
const fs = require("fs");
const buf = fs.readFileSync("dict/common-en.bin");
const fail = (m) => { console.error("artifact: " + m); process.exit(1); };
if (buf.subarray(0,4).toString("ascii") !== "HAPX") fail("bad magic");
if (buf.readUInt16LE(4) !== 1) fail("bad version");
const entryCount = buf.readUInt32LE(8), blobLen = buf.readUInt32LE(12),
      bucketCount = buf.readUInt32LE(16), seed = buf.readUInt32LE(20);
if (buf.length !== 850554) fail("size " + buf.length + " != spec 850554");
if (entryCount !== 48802) fail("entryCount " + entryCount + " != 48802");
if (bucketCount !== 65536 || (bucketCount & (bucketCount-1)) !== 0)
  fail("bucketCount " + bucketCount + " not pow2 65536");
const expected = 24 + blobLen + (entryCount+1)*4 + entryCount + bucketCount*4;
if (expected !== buf.length) fail("layout math: " + expected + " vs " + buf.length);
console.log("artifact OK: " + entryCount + " entries, LF " + (entryCount/bucketCount).toFixed(3));
'
if node -e "$DICT_NODE_PROBE"; then ok "shipped dictionary header/layout per spec §03"; else bad "dictionary artifact corrupt"; fi

# Full rebuild from the shipped corpus must be byte-identical (calibration
# guarantee, README h4.2) and self-verified by the tool (every entry
# re-looked-up, no duplicate keys).
TMPD=$(mktemp -d /tmp/hapax-validate.XXXXXX)
trap 'rm -rf "$TMPD"; tmux kill-session -t hapaxval 2>/dev/null || true' EXIT
if node tools/build-dict.mjs --out "$TMPD/rebuilt.bin" tools/corpus/en-50k.tsv \
    >/dev/null 2>&1 \
  && cmp -s dict/common-en.bin "$TMPD/rebuilt.bin"; then
  ok "rebuild from corpus is byte-identical to shipped artifact"
else
  bad "rebuild diverges from shipped artifact (calibration guarantee broken)"
fi

# Corrupt-file behavior (spec §03: invalid magic/version → load throws)
if npx vitest --run test/dictionary.test.ts test/bad-dict-gate.test.ts test/shipped-dict.test.ts >/dev/null 2>&1; then
  ok "dictionary loader contracts (round-trip, corrupt, shipped) green"
else
  bad "dictionary loader contract tests failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Phase 5: Calibration probe — spec §04 measured-effect exemplars"

CAL_PROBE_OUT=$(timeout 120 node tools/calibrate-bands.mjs \
  the provider default cache node spec null everything government information \
  organization relationship characteristics infrastructure responsibility \
  lists deleted uploads 2>&1)
echo "$CAL_PROBE_OUT" | sed 's/^/    /'

check_verdict() { # word expected(REJECT|g0|g1)
  local line
  line=$(echo "$CAL_PROBE_OUT" | awk -v w="$1" '$1==w{print}')
  if [ -z "$line" ]; then bad "calibrate: $1 missing from probe output"; return; fi
  if echo "$line" | grep -q " $2 "; then ok "calibrate: $1 → $2"
  else bad "calibrate: $1 expected $2 — got: $line"; fi
}
# Noise class stays rejected at the floor (2026-09 audit words)
for w in the provider default cache node spec null everything lists deleted uploads; do
  check_verdict "$w" "REJECT"
done
# Ramp admissions stay admitted at group 1; absent stays group 0
check_verdict government g1
check_verdict information g1
check_verdict organization g1
check_verdict characteristics g1
check_verdict infrastructure g1
check_verdict responsibility g1

# ─────────────────────────────────────────────────────────────────────────────
section "Phase 6: Live TTY E2E (spec §09 binding technique — tmux + real pi)"

run_live() {
  command -v tmux >/dev/null 2>&1 || { skip "tmux not installed"; return 0; }
  command -v pi   >/dev/null 2>&1 || { skip "pi not installed";   return 0; }

  SES=hapaxval
  tmux kill-session -t "$SES" 2>/dev/null || true
  tmux new-session -d -s "$SES" -x 200 -y 50 'cd /tmp && pi --no-session'

  # Boot wait: status bar with model indicator shows up. Bail (environmental)
  # if pi never renders a prompt.
  if ! timeout 60 bash -c "until tmux capture-pane -t $SES -p 2>/dev/null | grep -qE 'INSERT|MCP'; do sleep 0.5; done"; then
    tmux kill-session -t "$SES" 2>/dev/null || true
    skip "pi failed to boot a TTY UI (no model/auth?) — environmental"
    return 0
  fi
  # Wait for MCP connection phase to settle
  timeout 30 bash -c "until ! tmux capture-pane -t $SES -p | grep -q 'connecting to'; do sleep 0.5; done" || true

  pane() { tmux capture-pane -t "$SES" -p; }
  # Widget region ONLY: lines between the editor border (INSERT) and the
  # status line — transcript text above the input must never satisfy a
  # widget assertion (e.g. the echoed secret message itself).
  wid() { tmux capture-pane -t "$SES" -p | awk 'f{print} /INSERT/{f=1}' | grep -v "❯"; }
  wait_for() { # regex timeout_s label
    timeout "$2" bash -c "until tmux capture-pane -t $SES -p | grep -qE '$1'; do sleep 0.3; done" >/dev/null 2>&1
  }
  type_slow() { for ((i=0;i<${#1};i++)); do tmux send-keys -t "$SES" -l "${1:i:1}"; sleep 0.10; done; }

  # 1 — Seed: one short user message mentioning rare words; then Ctrl+C the turn.
  tmux send-keys -t "$SES" -l "Remember the Zendesk lwlock integration"
  tmux send-keys -t "$SES" Enter
  if ! wait_for "Zendesk" 60; then bad "live: seed message never echoed"; return 1; fi
  tmux send-keys -t "$SES" C-c
  timeout 30 bash -c "until ! tmux capture-pane -t $SES -p | grep -q 'Working'; do sleep 0.5; done" || true
  sleep 1.5   # 300ms ingest debounce + margin

  # 2 — Widget happy path + INVARIANT 2 probe: the line must open on the
  #     1st char of a matching word (SPEC.md invariant 2; spec 07 "effective
  #     from 1 typed char"). 'z' alone must already offer Zendesk.
  type_slow "z"
  sleep 0.3
  if wid | grep -q "Zendesk"; then ok "live: 'z' (1st char) → widget offers Zendesk (invariant 2)"
  else bad "live: 'z' alone shows no widget — line opens only at the 2nd char (spec invariant 2: 'opens automatically on the 1st char of a matching word'; root cause: widget.ts extractMatchState uses raw config.threshold=2, unlike provider.ts which clamps to 1)"; fi
  tmux send-keys -t "$SES" -l "e"
  sleep 0.3
  if wid | grep -q "Zendesk"; then ok "live: 'ze' → one-line widget offers Zendesk"
  else bad "live: 'ze' widget line missing (expected standalone 'Zendesk' line)"; fi

  # 3 — Tab completes with display casing (input line becomes the cased word)
  tmux send-keys -t "$SES" Tab; sleep 0.3
  if pane | tail -8 | grep -q "^Zendesk$"; then ok "live: Tab inserts cased Zendesk"
  else bad "live: Tab did not complete"; fi

  # 4 — Trigger char: clear, '#l' → lwlock
  tmux send-keys -t "$SES" C-c; sleep 0.4
  type_slow "#l"; sleep 0.3
  if wid | grep -q "lwlock"; then ok "live: '#l' → widget offers lwlock"
  else bad "live: '#l' trigger-char offer missing"; fi

  # 5 — Arrow entry + carousel on the multi-word zero-fragment line
  tmux send-keys -t "$SES" C-c; sleep 0.4
  tmux send-keys -t "$SES" -l "#"; sleep 0.4
  # zero-fragment listing: multi-word ' | ' joined line (order is
  # sessionCount-driven — do NOT pin a fixed word order)
  if ! wid | grep -qE ' \| '; then bad "live: '#' zero-fragment listing missing"; return 1; fi
  ok "live: '#' zero-fragment listing renders"
  # un-entered ← must DISMISS the line (boundary pass-through)
  tmux send-keys -t "$SES" Left; sleep 0.3
  if wid | grep -qE ' \| '; then
    bad "live: un-entered ← did not dismiss the line (pass-through broken)"
  else ok "live: un-entered ← dismisses line (boundary pass-through)"; fi
  # re-open and enter: C-c first (the ← forwarded press moved the caret
  # BEFORE the '#'; typing '#' there would build '##' — a non-trigger run)
  tmux send-keys -t "$SES" C-c; sleep 0.3
  tmux send-keys -t "$SES" -l "#"; sleep 0.4
  local hl_before hl_after
  hl_before=$(tmux capture-pane -t "$SES" -e -p | awk 'f{print} /INSERT/{f=1}' | grep " | " | tail -1 | cat -v)
  tmux send-keys -t "$SES" Right; sleep 0.3
  hl_after=$(tmux capture-pane -t "$SES" -e -p | awk 'f{print} /INSERT/{f=1}' | grep " | " | tail -1 | cat -v)
  if [ "$hl_before" != "$hl_after" ]; then ok "live: → enters the list (highlight moves)"
  else bad "live: → did not move the highlight"; fi
  # carousel: navigate past the end then wrap (highlight rendering changes again)
  local i
  for i in 2 3 4 5 6 7 8 9; do tmux send-keys -t "$SES" Right; sleep 0.10; done
  tmux send-keys -t "$SES" Right; sleep 0.3
  local hl_wrap
  hl_wrap=$(tmux capture-pane -t "$SES" -e -p | awk 'f{print} /INSERT/{f=1}' | grep " | " | tail -1 | cat -v)
  if [ "$hl_wrap" != "$hl_after" ]; then ok "live: carousel wraps at the edges"
  else bad "live: carousel wrap not observed"; fi
  # Escape dismisses
  tmux send-keys -t "$SES" Escape; sleep 0.3
  if wid | grep -qE ' \| '; then bad "live: Escape did not dismiss"
  else ok "live: Escape dismisses"; fi

  # 6 — Chained completion: Tab→space→offer→Tab (M2 acceptance journey)
  tmux send-keys -t "$SES" C-c; sleep 0.4
  type_slow "zend"; sleep 0.3
  tmux send-keys -t "$SES" Tab; sleep 0.4
  tmux send-keys -t "$SES" Space; sleep 0.4
  if wid | grep -q "lwlock"; then ok "live: chain successor offered at empty next word"
  else bad "live: chain successor offer missing after Tab+space"; fi
  tmux send-keys -t "$SES" Tab; sleep 0.4
  if pane | grep -q "Zendesk lwlock"; then ok "live: chain Tab inserts successor (Zendesk lwlock)"
  else bad "live: chain Tab did not insert"; fi

  # 7 — Enter ALWAYS submits (never inserts the candidate)
  tmux send-keys -t "$SES" C-c; sleep 0.4
  type_slow "zend"; sleep 0.3
  wid | grep -qx "Zendesk" || bad "live: precondition — widget visible before Enter test"
  tmux send-keys -t "$SES" Enter
  if wait_for "^\s+zend$|^\s*zend$" 30; then
    ok "live: Enter submitted 'zend' verbatim (no candidate insertion)"
  else
    bad "live: Enter did not submit the typed text verbatim"
  fi
  tmux send-keys -t "$SES" C-c
  timeout 30 bash -c "until ! tmux capture-pane -t $SES -p | grep -q 'Working'; do sleep 0.5; done" || true
  sleep 1.5

  # 8 — Secrets never appear (acceptance item 5): submit an sk- key, then probe
  tmux send-keys -t "$SES" -l "my key is sk-abc123XYZdef456GHIjkl789MNOqrs"
  tmux send-keys -t "$SES" Enter
  wait_for "sk-abc" 60 || true
  tmux send-keys -t "$SES" C-c
  timeout 30 bash -c "until ! tmux capture-pane -t $SES -p | grep -q 'Working'; do sleep 0.5; done" || true
  sleep 1.5
  tmux send-keys -t "$SES" -l "#sk"; sleep 0.4
  if wid | grep -q "abc123\|sk-abc"; then bad "live: secret leaked into suggestions"
  else ok "live: '#sk' returns zero candidates (secret gated)"; fi
  tmux send-keys -t "$SES" C-c; sleep 0.3
  tmux send-keys -t "$SES" -l "#abc"; sleep 0.4
  if wid | grep -q "abc123\|XYZdef"; then bad "live: secret body fragment leaked into suggestions"
  else ok "live: '#abc' returns zero candidates (secret gated)"; fi

  tmux send-keys -t "$SES" C-c; sleep 0.2
  tmux kill-session -t "$SES" 2>/dev/null || true
  return 0
}

PERSIST_BEFORE=$(ls /tmp 2>/dev/null | grep -i "hapax" | sort)
if [ "${HAPAX_SKIP_LIVE:-0}" = "1" ]; then
  skip "live E2E (HAPAX_SKIP_LIVE=1)"
else
  run_live
fi
PERSIST_AFTER=$(ls /tmp 2>/dev/null | grep -i "hapax" | sort)
NEW_PERSIST=$(comm -13 <(echo "$PERSIST_BEFORE") <(echo "$PERSIST_AFTER") | grep -v "^hapax-validate\." | head -5)
if [ -z "${NEW_PERSIST//$'\n'/}" ]; then
  ok "live run wrote no persistence artifacts"
else
  bad "live run wrote unexpected files: $NEW_PERSIST"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "SUMMARY"
echo "  passed: $PASS   failed: $FAIL   skipped: $SKIPPED"
if [ $FAIL -gt 0 ]; then
  echo "  failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  exit 1
fi
echo "  VALIDATION GREEN"
exit 0
