/**
 * Session-fixture loader (P1.M4.T1.S1): parse the synthetic pi-session
 * JSONL transcripts under test/fixtures/sessions/ into entry arrays that
 * feed src/pi/ingest.ts's restoreFromHistory exactly like a real session
 * manager would.
 *
 * TOLERANCE CONTRACT: fixture lines are parsed as opaque JSON objects and
 * never validated field-by-field — unknown fields on entries and messages
 * (model, stopReason, usage, …) are preserved untouched, mirroring the
 * loader discipline pi applies to its own session files. Only two things
 * are assumed, matching the real `pi --export` shape the fixtures were
 * authored against: each non-header line is an object with a `type`
 * (string) and, for message entries, a `message` object with `role` and
 * `content` (string | text blocks).
 *
 * restoreFromHistory consumes pi's SessionEntry union; fixture entries are
 * structurally compatible but not nominally typed, so `asSessionManager`
 * performs the single documented cast at the boundary (same discipline as
 * test/ingest-restore.test.ts's header-entry fixture).
 */

import { readFileSync } from "node:fs";

/** One parsed fixture line — deliberately loose (tolerance contract above). */
export interface FixtureEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: {
    role: string;
    content: unknown;
    [extra: string]: unknown;
  };
  [extra: string]: unknown;
}

/**
 * Parse a session fixture file. Blank lines are skipped; every remaining
 * line must be a JSON object (a malformed fixture is a test-authoring bug
 * and SHOULD throw loudly here, not degrade silently).
 */
export function parseSessionFixture(path: string): FixtureEntry[] {
  const raw = readFileSync(path, "utf8");
  const entries: FixtureEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error(`session fixture ${path}: line is not a JSON object`);
    }
    entries.push(parsed as FixtureEntry);
  }
  return entries;
}

/** Drop the "session" header line (and any non-message lines) — the
 *  pure-message view some tests want. restoreFromHistory filters by
 *  type itself, so the acceptance suite usually passes ALL entries. */
export function messageEntriesOf(entries: FixtureEntry[]): FixtureEntry[] {
  return entries.filter((e) => e.type === "message");
}

/**
 * Wrap fixture entries in the RestoreSessionManager shape src/pi/ingest.ts
 * consumes (getBranch: leaf → root newest-first; getEntries: oldest-first).
 * The fixtures are linear chains in file order, so getBranch is a REVERSED
 * copy — never mutating the parsed array, exactly like pi's contract.
 * The cast to pi's SessionEntry-based interface is the one boundary cast;
 * see the module doc.
 */
export function asSessionManager(entries: FixtureEntry[]): {
  getBranch: () => FixtureEntry[];
  getEntries: () => FixtureEntry[];
} {
  return {
    getBranch: () => [...entries].reverse(),
    getEntries: () => entries,
  };
}