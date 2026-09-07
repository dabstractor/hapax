# pi Extension API Surface — validated against pi v0.84.4 (2026-09)

Authoritative type sources (installed package):
- `/home/dustin/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — ExtensionAPI, all event types, ExtensionContext, ExtensionUIContext, registerCommand.
- `.../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/autocomplete.d.ts` — AutocompleteItem/Provider/Suggestions.
- `.../pi-ai/dist/types.d.ts` — Message/UserMessage/AssistantMessage/ToolResultMessage, TextContent/ThinkingContent/ToolCall.
- Canonical docs: `/home/dustin/projects/pi/packages/coding-agent/docs/extensions.md` (autocomplete section ~line 2559).
- Working example: `/home/dustin/projects/pi/packages/coding-agent/examples/extensions/github-issue-autocomplete.ts`.

## 1. Autocomplete (PRD §07) — CONFIRMED, with corrections

```ts
type AutocompleteProviderFactory = (current: AutocompleteProvider) => AutocompleteProvider;
// ExtensionUIContext:
addAutocompleteProvider(factory: AutocompleteProviderFactory): void;   // void — no disposal handle

// pi-tui:
interface AutocompleteItem   { value: string; label: string; description?: string; }
interface AutocompleteSuggestions { items: AutocompleteItem[]; prefix: string; }
interface AutocompleteProvider {
  triggerCharacters?: string[];
  getSuggestions(lines: string[], cursorLine: number, cursorCol: number,
                  options: { signal: AbortSignal; force?: boolean })
    : Promise<AutocompleteSuggestions | null>;           // <-- ASYNC
  applyCompletion(lines: string[], cursorLine: number, cursorCol: number,
                  item: AutocompleteItem, prefix: string)
    : { lines: string[]; cursorLine: number; cursorCol: number };  // <-- SYNC
  shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
}
```

**Corrections vs PRD:**
- `getSuggestions` is **async**. The PRD's "synchronous search every keystroke"
  invariant is implemented as: perform the store query synchronously (no awaits)
  inside the async method and return an already-resolved object. Never let the
  query path await I/O.
- The return value is **`{ items, prefix }`** (AutocompleteSuggestions), not a bare
  array. `prefix` is the string the editor will replace on completion:
  trigger mode → `"#" + fragment` (docs example: `prefix: \`#${match[1]}\``);
  threshold mode → the bare fragment (e.g. `"ze"`).
- Delegation: when hapax doesn't match, `return current.getSuggestions(lines, line, col, options)`
  unchanged — this keeps path/slash completion intact (PRD §07).
- `options.signal: AbortSignal` — check `signal.aborted` early; abort is normal.
- No disposal: provider re-registration happens on every `session_start`
  (reasons include `"reload"`); registration is idempotent from pi's side.

## 2. Events (PRD §05, §02 lifecycle)

Handlers register on the **`pi` object** (ExtensionAPI), not ctx:
`pi.on("message_end", (event: MessageEndEvent, ctx: ExtensionContext) => {...})`.

| Event | Payload | Notes for hapax |
|---|---|---|
| `message_end` | `{ type, message: AgentMessage }` | result type allows replacing the message — hapax MUST return nothing (never mutate, PRD §05) |
| `session_start` | `{ type, reason: "startup"\|"reload"\|"new"\|"resume"\|"fork", previousSessionFile? }` | PRD names startup/resume; **reload and fork also carry existing history** — replay when `getEntries()` non-empty regardless of reason |
| `session_shutdown` | `{ type, reason: "quit"\|"reload"\|"new"\|"resume"\|"fork" }` | drop store + dictionary refs |
| `before_agent_start` | `{ type, prompt, systemPrompt, ... }` | M2: reset chain state each user turn |

## 3. AgentMessage shapes (ingest filter contract)

```ts
UserMessage:      { role: "user", content: string | (TextContent|ImageContent)[], timestamp }
AssistantMessage: { role: "assistant", content: (TextContent|ThinkingContent|ToolCall)[], ... }
ToolResultMessage:{ role: "toolResult", toolCallId, toolName, content, ... }
TextContent:      { type: "text", text: string, textSignature? }
ThinkingContent:  { type: "thinking", ... }        // SKIP
ToolCall:         { type: "toolCall", ... }        // NOTE: "toolCall", NOT "tool_use"
```

**Corrections vs PRD:** the PRD's "Skip tool_use blocks" maps to real type
`type === "toolCall"`. Roles are exactly `"user" | "assistant" | "toolResult"`
(+ custom roles — ignore everything not user/assistant). Ingest rule:
user → whole content if string, else `block.type === "text"` blocks; assistant →
only `block.type === "text"` blocks (code fences live inside text and are included);
toolResult → ignored entirely.

## 4. Session history (restore path)

`ctx.sessionManager` (ReadonlySessionManager) on ExtensionContext:
- `getEntries(): SessionEntry[]` — ALL entries in append-only file order
  (oldest→newest); filter `entry.type === "message"` → `entry.message: AgentMessage`.
  May include abandoned-branch messages after forking.
- `getBranch(fromId?)` — current-branch path, leaf→root order (reverse for
  oldest→newest); the faithful reconstruction of live context.

**Decision for hapax:** use `getBranch()` reversed as the primary restore source
(matches "current session in order"); fall back to `getEntries()` filtered to
`type === "message"` if branch resolution is unavailable/empty. Both are shallow
copies; ingest rules identical to live pipeline (PRD §05 restore).

## 5. UI & commands

```ts
ctx.ui.notify(message: string, type?: "info" | "warning" | "error"): void;
// PRD's "warn" level does not exist — use "warning".
pi.registerCommand("acwords", {
  description: string,
  handler: async (args: string, ctx: ExtensionCommandContext) => void,
  getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null | Promise<...>,
});
```
Also available: `ctx.ui.setStatus`, `setWidget`, `select/confirm/input`, `ctx.cwd`,
`ctx.isProjectTrusted()`, `ctx.mode` (`"tui"|"rpc"|"json"|"print"` — guard UI calls
when `mode !== "tui"` / `!ctx.hasUI`).

## 6. Factory & module contract

```ts
export default function (pi: ExtensionAPI): void | Promise<void> { ... }
```
- Loaded by jiti (TS transpiled at load; node builtins importable).
- The factory must NOT start timers/listeners beyond `pi.on(...)` registrations;
  all resource creation is deferred to `session_start` (PRD §02 lifecycle).
- Teardown via `session_shutdown` handler; no dispose return value.
- Types for dev/tests: `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"`
  and `import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui"`
  via devDependencies (see external_deps.md). `src/core/` must never import these.