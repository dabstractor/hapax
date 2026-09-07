# Research notes — P1.M3.T2.S1 (extractText)

Verified against installed packages on this machine (pi v0.84.4).

## AgentMessage shape facts

From `.../pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/types.d.ts` (lines ~163–231):

- `UserMessage { role: "user"; content: string | (TextContent | ImageContent)[]; timestamp: number }`
- `AssistantMessage { role: "assistant"; content: (TextContent | ThinkingContent | ToolCall)[]; api; provider; model; usage: Usage; stopReason: StopReason; ... }`
- `ToolResultMessage { role: "toolResult"; toolCallId; toolName; content: (TextContent|ImageContent)[]; isError; ... }`
- `TextContent { type: "text"; text: string; textSignature? }`
- Tool calls: `type: "toolCall"` (NOT "tool_use" — PRD prose uses Anthropic naming).
- Thinking: `type: "thinking"`.

`Usage` requires `totalTokens` plus `cost: { input, output, cacheRead, cacheWrite, total }` — test fixtures need these for AssistantMessage literals (use a small factory).

## Where AgentMessage lives / import path problem

- `AgentMessage` is defined in `@earendil-works/pi-agent-core/dist/types.d.ts:271` as
  `Message | CustomAgentMessages[keyof CustomAgentMessages]`.
- It is **NOT re-exported** from `@earendil-works/pi-coding-agent`'s root `dist/index.d.ts`
  (grepped — no AgentMessage in root exports).
- pi-agent-core is a nested transitive dep; hapax's `node_modules/@earendil-works/` only has
  `pi-coding-agent` and `pi-tui`. Adding pi-agent-core as a devDep or deep-importing is fragile.
- **Solution**: `MessageEndEvent` IS exported from the root (extensions export block,
  `dist/core/extensions/types.d.ts:544-547` defines `{ type: "message_end"; message: AgentMessage }`).
  So: `import type { MessageEndEvent } from "@earendil-works/pi-coding-agent"; export type AgentMessage = MessageEndEvent["message"];`

## Project conventions

- ESM (`"type": "module"`), vitest 4, `npm run check` = `tsc --noEmit` (only linter).
- Tests flat in `test/`, vitest describe/it/expect, header comments citing PRD sections
  (see test/segment.test.ts).
- `src/core/` must never import pi packages; `src/pi/` may, but type-only here.
- src/pi/index.ts currently a placeholder factory — do not touch.