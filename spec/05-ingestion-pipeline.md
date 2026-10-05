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
- A slice boundary never splits a token: the trailing partial token
  (suffix of token-class characters) is carried into the next slice and
  tokenized there exactly once, mirroring the open-line/open-tail run
  carry.
- Track cumulative stats (words seen, admitted, rejected-by-gate) for the
  debug command (see 08).

## Session restore (rebuild)

On `session_start` with reason `"startup"` or `"resume"`:

1. Access session history via the pi session API (read messages from the
   current session in order — the ACTIVE branch, `sessionManager.getBranch()`;
   never every tree entry: abandoned branches are alternative histories).
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

## Branch navigation rebuild (`session_tree`; 2026-10 owner rule; status: adopted ahead of implementation — code lands with this spec)

Pi fires `session_tree` (`{ newLeafId, oldLeafId, summaryEntry?,
fromExtension? }`) after every `/tree` navigation — and NO `session_start`
accompanies it (that event's reasons are `startup | reload | new | resume |
fork` only), so before this rule hapax had no reaction to branch switches:
words ingested from messages on an abandoned branch lingered as append-only
residue (owner scenario: a misspelled word submitted, then `/tree` back to
edit it away — the misspelling, dictionary-absent and therefore rank group 0,
kept surfacing as a top suggestion on branches where it never existed).

**Rule: the store is a pure function of the active branch's replayable
history.** On `session_tree`:

1. **Guard:** `newLeafId === oldLeafId` → skip (no-op navigation).
2. **Discard the pending ingest queue.** Texts in the 300 ms debounce
   window are from pre-navigation messages; any of them on the new path is
   re-captured by the snapshot (below), any other is dead branch — discard
   is always correct: never loses a live word, never double-counts.
3. **Snapshot** `ctx.sessionManager.getBranch()` — the platform-sanctioned
   source for branch-sensitive state.
4. **Replay** the snapshot oldest→newest through the IDENTICAL restore
   pipeline above (same gates, counters, bigram capture, eviction),
   IN-PLACE: the old store is dropped first and the replay fills a fresh
   store + successor index. No query can observe the intermediate state —
   every query path is held at the gate until settle (07), which is what
   makes the in-place rebuild safe (no transient double-store memory
   spike).
5. **`onSettled`** fires exactly once (finish, abort on dictionary
   failure, or collection throw), releasing the gate — same contract as
   restore.

**Performance (from 09's measured basis):** the handler's synchronous work
(queue discard + entry-reference snapshot) is sub-millisecond — the `/tree`
operation itself gains ~0 ms. The replay is background and chunk-yielded per
the standard ≤ 64 KB rule (~30–60 ms at ~150k tokens / 400 KB at the
measured ~8 KB/ms ingest throughput; ~100 ms at 300k), never blocking a
keystroke. The only user-visible cost is the first post-`/tree` query
waiting behind the ≤ 500 ms gate — it resolves at replay settle (tens of
ms), typically before a human finishes editing the re-opened prompt.

**Compaction interplay (binding):** the rebuild triggers ONLY on
`session_tree`. Compaction events NEVER trigger one — the store survives
compaction untouched ("Compaction" below, unchanged). Accepted consequence:
a post-compaction tree navigation rebuilds from the branch as-replayable,
losing pre-compaction words — exactly the store a `/resume` of that branch
would build. Unioning pre-compaction survivors into the replay was rejected
(it resurrects dead-branch words too).

**Branch summaries are never ingested.** `summaryEntry` text never enters
the store; abandoned-branch vocabulary re-enters only via real messages on
the new branch (if the model echoes summary vocabulary in its replies, it
ingests naturally through `message_end`).

**Why not an incremental undo journal (rejected 2026-10, recorded for
history):** exact message-anchored rollback is buildable — a journal of
every admitted sighting and eviction (count deltas, prior display casing,
prior flag states, evicted-record restoration) walked back to the common
ancestor, then the new branch's tail replayed forward. Rejected on cost,
not possibility: the store's merge semantics are lossy by design (sticky
`userTyped`, recency-wins display casing, `rankGroup = min()` merge,
batched eviction that drops records), so an exact undo must journal every
merge input — a second implementation of each semantic whose drift from
forward-apply would yield a store ≠ fresh replay, a bug class visible only
on a `/tree` hop. Journal memory grows with total sightings unbounded by
the 20k store cap (~1–2 MB at 300k tokens against the 6 MB budget), and any
depth-capped journal still requires the full-replay fallback beyond its
cap — the replay path must exist regardless, making the journal purely
additive complexity for an O(dead-tail) speedup over an already-background
30–100 ms pass. Door explicitly open (owner, 2026-10): a journal may layer
on later as an optimization, with this rebuild path demoted to the
determinism check that catches journal drift.

**Known gap (documented, not handled):** `context_edit` message
replacements can leave an edited entry's OLD wording in the store (no
clean event fires; same staleness class, smaller blast radius). Revisit
only if observed to bite.

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