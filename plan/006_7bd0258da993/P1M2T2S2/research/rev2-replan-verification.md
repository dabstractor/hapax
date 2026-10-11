# REV 2 re-plan research (2026-10-09 session)

Attempt-1 issue feedback said the feature was fully delivered and the sole
blocker was environmental. Every claim was re-verified live before REV 2
was written:

## 1. WP-A feature state — DELIVERED AND COMMITTED

- `git log`: `95b1727 feat(pi): widget path series offers + typed arming`
  (before HEAD `a618343` acwords). Commit message documents chainShim
  run-casing, cap-on-combined-list, the three typed-arm gates (uppercase
  first letter, direct series-flag consult, enableChaining + chain-idle),
  grant reset beside arm, arm-and-close, and both test suites.
- Worktree grep of `src/pi/widget.ts`: series JSDoc :664, series branch
  :681–684, SERIES FIRST composition comment :891, `succ.map(chainShim)`
  :932, TYPED-WORD ARMING seam :984 — all present.
- Worktree ALSO carries uncommitted sibling work (P4.M1.T1.S1-flavored:
  post-Tab extension offer, T3 seam, h3.10/h3.11 comments; +235 lines in
  test/widget.test.ts). Plan dirs for P4.M1.T1.S1/S2 exist. => REV 2
  frames WP-A as verify-or-rebuild and forbids reverting these diffs.

## 2. The environmental failure — STILL REPRODUCES

`npx vitest --run test/acceptance.test.ts` (this session):
26 passed, 1 failed — `pi -p -e loads the real extension and answers
cleanly` at test/acceptance.test.ts:649: `expected 1 to be +0`.
Duration 1.96 s => crash-on-load, not network. Matches the feedback:
repo-pinned `node_modules/.bin/pi` (0.84.4; package.json pins
`~0.84.4`) discovers the user's GLOBAL extensions from `~/.pi/agent`
(contains `extensions/`, `auth.json`, `models.json`); the updated global
pi-subagents calls an API absent in 0.84.x and kills the subprocess.

## 3. Remediation — found and VERIFIED

- `node_modules/.bin/pi --help`: `--no-extensions, -ne  Disable extension
  discovery (explicit -e paths still work)` — exists in pinned 0.84.4.
- Live proof (this session):
  `node_modules/.bin/pi -p -ne -e "$PWD" --no-builtin-tools "say Zendesk lwlock" </dev/null`
  → exit 0, model answered ("Zendesk lwlock." + follow-up), stderr empty.
  hapax loads via the explicit `-e`; auth resolves from the untouched
  default config dir.
- Rejected: `PI_CODING_AGENT_DIR=<temp>` (documented in
  ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/environment-variables.md
  as the config-dir override) — `auth.json`/`models.json` live in the
  config dir, so isolation removes credentials; the resulting no-provider
  failure is an assertion failure that never reaches the probe's
  environmental-skip catch (skip regex only sees spawn errors/timeouts),
  i.e. it would convert an environmental failure into a hard one.
- Rejected: PATH → global pi 1.0.2 (un-tests the pinned runtime the probe
  exists to exercise); bumping the devDependency / editing ~/.pi/agent
  (orchestrator/human decisions, outside repo scope).

## 4. Old PRP recovery

REV 1 was deleted in the worktree (`git status`: `D .../PRP.md`); recovered
from HEAD via `git show HEAD:plan/.../PRP.md` (254 lines, md5 matched the
feedback's 22d91946…). Its verified anchors and battery list were carried
into REV 2's WP-A section unchanged.
