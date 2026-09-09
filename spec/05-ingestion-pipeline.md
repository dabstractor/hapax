# 05 — Ingestion Pipeline

## Event contract

Single hook: `pi.on("message_end", handler)`.

`event.message` is a finalized `AgentMessage`. Ingest exactly these:

| Condition | Action |
|---|---|
| `role === "user"` | Ingest text content (prompt text; images ignored) |
| `role === "assistant"` | Ingest **only `block.type === "text"` blocks**. Skip `thinking` blocks. Code fences inside text blocks are **included** (explicit agent output). Skip tool_use blocks |
| Anything else (`toolResult`, custom types) | **Ignore entirely** |

Rationale (settled): everything the agent explicitly tells the user — not
thinking tokens — is fair game. Generated-or-ingested content (tool results,
file reads) is not.

User message content may be a string or a content-block array; handle both
shapes.

## Debounce and scheduling (`src/pi/ingest.ts`)

- On each `message_end`, push the extracted text into a pending queue and
  (re)start a **300 ms** debounce timer.
- When the timer fires, process all queued texts in order.
- Rationale: agents emit several messages in quick succession during tool
  loops; batching avoids repeated chunk-yield overhead mid-typing.

## Chunked processing

- Process in ≤ 64 KB slices; `await` a microtask/yield between slices
  (`setImmediate` or `scheduler.yield()` if available) so the event loop
  breathes. A pathological multi-MB message must never block a keystroke.
- Track cumulative stats (words seen, admitted, rejected-by-gate) for the
  debug command (see 08).

## Session restore (rebuild)

On `session_start` with reason `"startup"` or `"resume"`:

1. Access session history via the pi session API (read messages from the
   current session in order).
2. Replay oldest → newest through the identical pipeline (same gates, same
   counters) in the background (chunked, debounced startup is fine — the
   store fills progressively).
3. Oldest-first ordering matters: `lastSeen` ordinals and display casing must
   end in the correct final state.
4. Completion signal: the replay invokes `onSettled` exactly once (finish,
   abort on dictionary failure, or collection throw) so the provider's
   startup gate (07) can bound-wait for a full store — otherwise a word
   typed during replay queries a partial store, and pi-tui's
   one-query-per-word makes its menu permanently missing until retyped.

Budget: 200k tokens (~800 KB) ≈ 30–50 ms total. This is the **only** cold-start
work; there is no persistence layer by design (rebuild beats deserialize at
this scale; see decision log).

## Compaction

Compaction rewrites context but fires no event we consume. **The store survives
compaction untouched** (settled decision). Consequences:

- `sessionCount` / `lastSeen` continue their monotonic counters across the
  compaction boundary.
- Words only present in compacted-away text remain candidates (acceptable:
  they were real session vocabulary).
- No integration with compaction summaries in M1/M2. ("Integrate with tree
  later" is deferred explicitly.)

## Eviction interplay

The store cap (see 06) applies during restore too: a huge history may evict
early words as it replays. Eviction scores use the same salience formula, so
survivors are the right survivors. Cap is 20,000 whole-token candidates; at
typical vocabulary sizes (~10–20k uniques per 300k tokens) eviction rarely
triggers.

## What ingestion must NOT do

- Never block, mutate, or rewrite the message (no `{ message }` return).
- Never read files or run tools.
- Never hold message text after processing: extract candidates, drop the
  string. The store holds words + counters only, never message bodies.
- Never process text on the keystroke path — all ingest work is debounced and
  chunked.