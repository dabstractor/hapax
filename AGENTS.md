# AGENTS.md

hapax is a context-driven autocomplete extension for the pi coding
agent. TypeScript; the pi extension API and pi-tui are the only runtime
dependencies.

## Where truth lives

- `spec/SPEC.md` and the numbered files under `spec/` are the single
  source of truth for ALL requirements and behavior. README and code
  comments never override them.
- Spec maintenance policy (binding): interactive sessions MUST keep
  spec and code in agreement — a change that ships code without the
  matching spec edit (or vice versa) is incomplete; either order is
  fine so long as they land together. Pipeline/plan agents treat
  `spec/*.md` as read-only inputs and record drift in their reports.
- `plan/` directories are historical run artifacts — never edited,
  never authoritative.

## Working in this repo

- Typecheck: `npm run check`. Tests: `npm test` (vitest). Both green
  before committing.
- UI-layer changes need live TTY verification, not unit tests alone —
  the technique is in `spec/09-testing-and-acceptance.md`.
- Questions about why a word/string does or doesn't complete (or
  proposed admission-rule changes): load the `word-review` skill
  (`.agents/skills/word-review/`).

## Non-negotiable invariants

Never hijack typing (Tab-only completion); the menu never renders with
zero candidates; everything stays in RAM — no persistence, no
telemetry, no network. Full list: "Design invariants" in
`spec/SPEC.md`.
