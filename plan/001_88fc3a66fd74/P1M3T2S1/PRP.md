# PRP — P1.M3.T2.S1: extractText: AgentMessage role/content handling

## Goal

**Feature Goal**: Implement `extractText(message)` in a new `src/pi/ingest.ts`
— a pure, allocation-light function that maps a finalized pi `AgentMessage`
to the text hapax should ingest (or `null` when the message must be ignored),
exactly per PRD §05's event-contract table.

**Deliverable**:
1. `src/pi/ingest.ts` — `extractText(message: AgentMessage): string | null`
   (pure module; no pi runtime usage, no timers, no listeners — those are
   P1.M3.T2.S2's IngestPipeline).
2. `test/ingest.test.ts` — unit suite covering all three roles, both user
   content shapes, and assistant text/thinking/toolCall block mixes.

**Success Definition**: `npm run check` (tsc --noEmit) and `npm test`
(vitest --run, including the new suite) pass; extractText never mutates its
input and returns `null` for anything not `user`/`assistant`.

## Why

- PRD §05 (h2.28): `message_end` fires for every finalized message; hapax
  must ingest user prompt text and assistant **text blocks only** (thinking
  and tool calls are not agent output to the user; tool results are
  generated-or-ingested content, not fair game).
- This is the first half of the ingestion wiring (P1.M3.T2). P1.M3.T2.S2's
  `IngestPipeline` (300 ms debounce queue + chunked core pipeline + stats)
  calls `extractText` on every `message_end` event and enqueues non-`null`
  results. P1.M3.T2.S3 (session restore) reuses the same function for
  history replay.

## What

### Behavior contract (exact)

```ts
export function extractText(message: AgentMessage): string | null;
```

| Input | Output |
|---|---|
| `role: "user"`, `content: string` | the string itself |
| `role: "user"`, `content: (TextContent \| ImageContent)[]` | text blocks (`block.type === "text"`) joined with `"\n"`; images silently skipped |
| `role: "user"`, content array with **no** text blocks (images only) | `null` (join of zero parts ⇒ nothing to ingest; do NOT return `""`… see decision below) |
| `role: "assistant"` | ONLY `block.type === "text"` blocks joined with `"\n"`; `thinking` and `toolCall` blocks skipped; code fences inside text blocks are naturally included (they live inside the text) |
| `role: "assistant"`, all-thinking/all-toolCall | `null` |
| `role: "toolResult"` or any custom role | `null` |

**Join/empty decision (settled)**: if after filtering there are **zero** text
parts, return `null` (caller S2 skips enqueueing on `null` — cheaper than
enqueueing an empty string through the pipeline). When ≥ 1 part, join with
`"\n"` even if some parts are empty strings.

**Purity (PRD §05 "must NOT")**:
- Never mutate the message or its content array (read-only iteration).
- Never hold the message or extracted string after return (no module-level
  state; the function holds no closures over the input).
- No I/O, no timers, no tool use — pure synchronous string work.

### Success Criteria

- [ ] `extractText` handles all rows of the table above exactly.
- [ ] Input message object is deep-frozen-in-test and remains unmodified.
- [ ] No `pi.on`/timer/store code in this module (that belongs to S2).
- [ ] `npm run check` and `npm test` green.

## All Needed Context

### Context Completeness Check

Validated against the installed packages (`@earendil-works/pi-ai` types via
pi-coding-agent's nested deps, and `@earendil-works/pi-agent-core` types via
`dist/core/extensions/types.d.ts`). Everything below was read from the actual
`.d.ts` files, not guessed.

### Documentation & References

```yaml
- file: plan/001_88fc3a66fd74/architecture/pi_extension_api.md
  why: §3 "AgentMessage shapes" — the validated ingest filter contract
  critical: tool calls are type 'toolCall' (NOT 'tool_use' as PRD prose says);
    roles are exactly 'user' | 'assistant' | 'toolResult' + custom roles (ignore)

- file: /home/dustin/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/types.d.ts
  why: authoritative UserMessage/AssistantMessage/TextContent shapes (lines ~163, 206–231)
  pattern: |
    UserMessage:      { role: "user", content: string | (TextContent|ImageContent)[], timestamp }
    AssistantMessage: { role: "assistant", content: (TextContent|ThinkingContent|ToolCall)[], api, provider, model, usage, stopReason, ... }
    TextContent:      { type: "text", text: string, textSignature? }
    ThinkingContent:  { type: "thinking", ... }
    ToolCall:         { type: "toolCall", ... }

- file: /home/dustin/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: MessageEndEvent definition (lines 544–547): { type: "message_end"; message: AgentMessage }
  critical: AgentMessage is NOT re-exported from the pi-coding-agent root
    index.d.ts. Import it as MessageEndEvent["message"] instead (see Gotchas).

- file: test/segment.test.ts
  why: project test conventions — vitest describe/it/expect, header comment
    citing PRD sections, plain-literal fixtures
  pattern: import { describe, expect, it } from "vitest"; import from "../src/core/segment.js"

- file: src/pi/index.ts
  why: shows the type-only import style already used: import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
```

### Current Codebase tree (relevant)

```bash
src/
  core/            # pure computation (segment, shapeGate, score, store, query, dictionary, types)
  pi/
    index.ts       # placeholder factory; full wiring in P1.M3.T5.S1
test/
  *.test.ts        # vitest suites, flat (no per-dir test dirs)
  helpers/
package.json       # ESM ("type": "module"), devDeps: pi-coding-agent ~0.84.4, pi-tui ~0.84.4, typescript ^5, vitest ^4
tsconfig.json      # strict tsc --noEmit via `npm run check`
```

### Desired Codebase tree with files to be added

```bash
src/pi/ingest.ts       # extractText (+ the AgentMessage type alias) — ONLY this function in S1
test/ingest.test.ts    # unit suite for extractText
```

### Known Gotchas of our codebase & Library quirks

```ts
// CRITICAL: AgentMessage is NOT exported from "@earendil-works/pi-coding-agent"'s
// root index.d.ts (verified). It comes from a nested transitive dep
// (@earendil-works/pi-agent-core) which is NOT a direct devDependency of hapax.
// DO NOT add that dependency and DO NOT deep-import it.
// SOLUTION: derive the type from the exported event type:
import type { MessageEndEvent } from "@earendil-works/pi-coding-agent";
export type AgentMessage = MessageEndEvent["message"];
// MessageEndEvent IS exported from the root (confirmed in dist/index.d.ts
// extensions export block).

// CRITICAL: tool-call blocks are `{ type: "toolCall", ... }` — the PRD prose
// says "tool_use" but that is Anthropic API naming; the runtime type is "toolCall".

// GOTCHA: content discriminating must narrow via block.type === "text" and then
// read block.text. ImageContent/ThinkingContent/ToolCall have no `.text` field
// usable for ingestion.

// GOTCHA: user content array may contain ImageContent blocks — silently skip,
// do not throw, do not include placeholders.

// GOTCHA: custom agent messages (module augmentation via CustomAgentMessages)
// widen AgentMessage's role to string — the `default: return null` branch
// handles them; never `throw` on unknown roles.

// GOTCHA: ESM project — internal imports use ".js" extension
// (e.g. no internal imports needed here, but keep the convention in mind).

// GOTCHA: `src/core/` must never import pi packages (architecture rule);
// `src/pi/ingest.ts` MAY, but only as `import type` (erased at runtime).
```

## Implementation Blueprint

### Data models and structure

No new data models — this module only narrows existing pi types. The single
type alias + function signature:

```ts
import type { MessageEndEvent } from "@earendil-works/pi-coding-agent";

/** Finalized agent message as delivered by pi's message_end event. */
export type AgentMessage = MessageEndEvent["message"];

/** Extract ingestable text from a finalized message; null = ignore message. */
export function extractText(message: AgentMessage): string | null;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/pi/ingest.ts
  - IMPLEMENT: extractText exactly per the behavior-contract table above
  - STRUCTURE:
      1. role "user": content is string → return it; array → filter
         block.type === "text", map to block.text, join "\n"; zero parts → null
      2. role "assistant": filter block.type === "text" (thinking/toolCall
         skipped), join "\n"; zero parts → null
      3. default (toolResult, custom roles) → null
  - NAMING: extractText (exported), AgentMessage type alias (exported, for S2/S3)
  - FOLLOW pattern: src/core/*.ts — pure functions, no side effects,
    exported JSDoc one-liners
  - PLACEMENT: src/pi/ingest.ts
  - CONSTRAINT: read-only access to message.content; no module-level state;
    `import type` only (no runtime pi import)

Task 2: CREATE test/ingest.test.ts
  - IMPLEMENT: unit tests, plain object literals (add only the fields the
    types require; cast with `as const`-friendly literals — AssistantMessage
    requires api/provider/model/usage/stopReason fields, so build a small
    `assistantMsg(content)` factory helper inside the test file that supplies
    minimal valid values, e.g. usage: { totalTokens: 0, cost: { input: 0,
    output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } as any-level minimal,
    stopReason: "stop")
  - NAMING: describe("extractText — PRD §05 event contract") blocks
  - CASES (all required):
      - user, string content → same string
      - user, array [text, image, text] → two texts joined "\n"
      - user, images-only array → null
      - user, empty string content → "" is a valid string → return ""
        (pipeline may drop it later; extractText is faithful)
      - assistant, [text, thinking, toolCall, text] → two texts joined "\n";
        thinking/toolCall bodies NOT present in output
      - assistant, thinking+toolCall only → null
      - assistant, text containing markdown code fences → fences included
        verbatim (single text block returned as-is)
      - toolResult role → null
      - custom role e.g. "system" (cast) → null
      - purity: deepFreeze(message) before call; expect no throw and output
        still correct (verifies non-mutation)
  - FOLLOW pattern: test/segment.test.ts (vitest describe/it/expect, header
    comment citing PRD §05)
  - PLACEMENT: test/ingest.test.ts (flat, matches existing layout)
```

### Implementation Patterns & Key Details

```ts
// Reference shape of the whole module (keep it this small):
import type { MessageEndEvent } from "@earendil-works/pi-coding-agent";

export type AgentMessage = MessageEndEvent["message"];

/**
 * Extract ingestable text per PRD §05: user → prompt text (string content or
 * text blocks; images ignored); assistant → text blocks only (thinking and
 * toolCall skipped); everything else → null. Join multiple blocks with "\n".
 * Zero text parts → null. Pure: never mutates or retains the message.
 */
export function extractText(message: AgentMessage): string | null {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content;
    const parts = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (message.role === "assistant") {
    const parts = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null; // toolResult, custom roles — ignore entirely
}
// Note: TS narrowing — after `message.role === "user"`, content narrows to
// string | (TextContent|ImageContent)[]; TextContent has `.text`. This compiles
// under strict mode against the real AgentMessage union.
```

### Integration Points

```yaml
NO integration points in this task:
  - No changes to src/pi/index.ts (wiring happens in P1.M3.T5.S1).
  - No store/query integration (P1.M3.T2.S2 consumes extractText).
  - No config consumption needed (S1 has no knobs).
  - No package.json changes (MessageEndEvent already exported by existing devDep).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check          # tsc --noEmit — must be clean (project's only linter)
# Expected: no errors. If AgentMessage narrowing fails, the role-check order
# above is wrong — re-check against the contract table, do not cast to any.
```

### Level 2: Unit Tests

```bash
npm test -- ingest     # or: npx vitest --run test/ingest.test.ts
npm test               # full suite — all pre-existing suites stay green
# Expected: new suite passes; zero regressions in core suites.
```

### Level 3: Integration Testing

Not applicable — this module is consumed by S2/S3 wiring (later tasks);
nothing runs at runtime yet.

### Level 4: Domain-Specific Validation

```bash
# Sanity-check the type derivation resolves (would fail at build time otherwise):
npm run check
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` fully green including `test/ingest.test.ts`
- [ ] No runtime (non-type) imports of pi packages in `src/pi/ingest.ts`

### Feature Validation

- [ ] All behavior-contract table rows covered by tests and passing
- [ ] 'toolCall' (not 'tool_use') discriminated correctly in code and tests
- [ ] Non-mutation verified via frozen-input test
- [ ] Zero-text-parts cases return `null`, not `""`

### Code Quality Validation

- [ ] Follows src/core pure-function style; module ≤ ~40 lines
- [ ] `AgentMessage` alias exported for S2/S3 reuse
- [ ] No timers, queues, listeners, or store logic (deferred to S2)

## Anti-Patterns to Avoid

- ❌ Don't import AgentMessage from "@earendil-works/pi-agent-core" (nested
  transitive dep — not a direct devDependency; deep imports break).
- ❌ Don't use "tool_use" as the block type string.
- ❌ Don't return "" for image-only or thinking-only messages — return null so
  the S2 pipeline skips enqueueing.
- ❌ Don't add debounce/queue/stats here — that is P1.M3.T2.S2.
- ❌ Don't `throw` on unknown roles — custom roles must silently yield null.
- ❌ Don't mutate or retain the message (PRD §05 "must NOT").