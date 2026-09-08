/**
 * BUG-004 disable-gate suite (P1.M3.T1.S1 bugfix): a dictionary load
 * failure must stop INGESTION, not just the message_end handler. Three
 * seams are proven: (1) the lazy dictionary's `failed` probe — false
 * until the first load throw, then sticky true forever; (2) the
 * IngestPipeline `isDisabled` gate at the top of processText (covers
 * the drain AND restore replay, which funnel through it); (3) the
 * load-bearing per-segment check inside #admitSegment's token loop —
 * without it, every word of the message whose first lookup triggers
 * the failure would admit as rank group 0 (the BUG-004 repro: whole
 * history ingested as ultra-rare candidates on a resumed session with
 * a missing dict).
 *
 * Per the work item, the failing dictionary is a REAL
 * createLazyDictionary on a nonexistent path — nothing is mocked:
 * loadDictionary throws on the first lookup, `failed` flips, lookups
 * return sticky null. The eager-dictionary test proves `failed`
 * optionality (a plain stub without the field compiles and works).
 */

import { describe, expect, it, vi } from "vitest";
import { CandidateStore } from "../src/core/store.js";
import { rankMatches } from "../src/core/query.js";
import type { Dictionary, Sighting } from "../src/core/types.js";
import { IngestPipeline } from "../src/pi/ingest.js";
import { createLazyDictionary } from "../src/pi/index.js";

/** A path that never exists → loadDictionary throws ENOENT on first
 *  lookup; the lazy wrapper flips `failed` and fires onLoadError once. */
const MISSING_DICT = "/nonexistent/common-en.bin";

describe("lazy dictionary failed probe (BUG-004)", () => {
  it("false before any lookup; true after the first failed load; never resets", () => {
    const onLoadError = vi.fn();
    const dict = createLazyDictionary(MISSING_DICT, onLoadError);

    expect(dict.failed).toBe(false); // nothing touched yet
    expect(dict.lookup("warmup")).toBeNull(); // the very first lookup triggers it
    expect(dict.failed).toBe(true);
    expect(onLoadError).toHaveBeenCalledOnce();

    // Sticky: later lookups return null with no retry, probe stays true.
    expect(dict.lookup("other")).toBeNull();
    expect(dict.lookup("more")).toBeNull();
    expect(dict.failed).toBe(true);
    expect(onLoadError).toHaveBeenCalledOnce();
  });
});

describe("disable gate (BUG-004)", () => {
  it("processText with a failed dict stores NOTHING (the BUG-004 repro, now clean)", async () => {
    const onLoadError = vi.fn();
    const dict = createLazyDictionary(MISSING_DICT, onLoadError);
    const store = new CandidateStore();
    const pipeline = new IngestPipeline({
      store,
      dictionary: dict,
      isDisabled: () => dict.failed === true,
      yieldFn: async () => {},
    });

    // Observe the failure BEFORE the message (the very first lookup
    // triggers the load): replay must then be a total no-op.
    expect(dict.lookup("warmup")).toBeNull();
    expect(dict.failed).toBe(true);

    await pipeline.processText(
      "with extraordinary vocabulary the session accumulated zephyr candidates",
      true,
    );

    expect(store.size).toBe(0);
    expect(pipeline.getStats().admitted).toBe(0);
    expect(pipeline.getStats().wordsSeen).toBe(0);
    expect(rankMatches(store, "with")).toEqual([]); // exact BUG-004 probe
    expect(onLoadError).toHaveBeenCalledOnce(); // never retried
  });

  it("mid-message failure: the trigger word admits, the rest of the message (and every later message) is blocked", async () => {
    const onLoadError = vi.fn();
    const dict = createLazyDictionary(MISSING_DICT, onLoadError);
    // isDisabled wired to a mutable boolean that flips on the FIRST
    // store.upsert (the PRP's store-upsert-wrapping fake pattern).
    const flag = { dead: false };
    class FlipOnFirstUpsert extends CandidateStore {
      override upsert(sighting: Sighting): void {
        super.upsert(sighting);
        flag.dead = true;
      }
    }
    const store = new FlipOnFirstUpsert();
    const onAdmittedTokens = vi.fn();
    const pipeline = new IngestPipeline({
      store,
      dictionary: dict,
      isDisabled: () => flag.dead,
      onAdmittedTokens,
      yieldFn: async () => {},
    });

    // Plain lowercase words: one draft each, one lookup each. "alpha"'s
    // lookup triggers the failed load (null → group 0 → admitted +
    // upserted → flag flips); "beta"…"delta" then break at the token-loop
    // gate — the load-bearing check.
    await pipeline.processText("alpha beta gamma delta", true);

    expect(store.get("alpha")).toBeDefined(); // trigger token got through
    expect(store.get("beta")).toBeUndefined();
    expect(store.get("gamma")).toBeUndefined();
    expect(store.get("delta")).toBeUndefined();
    expect(store.size).toBe(1);
    expect(pipeline.getStats().admitted).toBe(1);
    expect(pipeline.getStats().wordsSeen).toBe(1);
    // Outer-loop early exit: remaining slices skipped AND the phrase
    // hook never fires for a half-dead message.
    expect(onAdmittedTokens).not.toHaveBeenCalled();
    expect(dict.failed).toBe(true);

    // Sticky: the second message is a top-gate total no-op.
    await pipeline.processText("more words arrive right here", true);
    expect(store.size).toBe(1);
    expect(pipeline.getStats().admitted).toBe(1);
    expect(onAdmittedTokens).not.toHaveBeenCalled();
    expect(onLoadError).toHaveBeenCalledOnce(); // exactly one, ever
  });
});

describe("backward compatibility (no gate wired)", () => {
  it("absent isDisabled + eager stub Dictionary WITHOUT `failed`: behaves exactly as before", async () => {
    // No `failed` field — proves the probe is optional (typechecks).
    const dict: Dictionary = { lookup: () => null, version: 1, entryCount: 0 };
    expect(dict.failed).toBeUndefined(); // consumers must use `=== true`
    const store = new CandidateStore();
    const onAdmittedTokens = vi.fn();
    const pipeline = new IngestPipeline({
      store,
      dictionary: dict,
      onAdmittedTokens,
      yieldFn: async () => {},
    });

    await pipeline.processText("alpha beta gamma delta", true);

    // Null lookups admit as group 0 — the pre-fix behavior, preserved
    // whenever no gate is wired.
    expect(store.size).toBe(4);
    expect(pipeline.getStats().admitted).toBe(4);
    expect(onAdmittedTokens).toHaveBeenCalledWith([
      ["alpha", "beta", "gamma", "delta"],
    ]);
  });
});