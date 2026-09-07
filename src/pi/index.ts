/**
 * hapax extension entry (PRD §02 h2.13, P1.M3.T5.S1): the ONLY module pi
 * loads (package.json "pi".extensions). The default export is the
 * extension factory; its body registers pi.on handlers exclusively — no
 * I/O, no timers, no constructors, no config reads — so pi can call it
 * cleanly on every (re)load and all real work defers to session_start
 * (PRD §02: everything deferred).
 *
 * Handler wiring per event:
 *
 *   session_start — load config (trust-gated, warning-notifying), build a
 *     fresh CandidateStore + lazily-loading dictionary + IngestPipeline,
 *     register the display-debounced autocomplete provider, register
 *     /acwords when config.debug, and kick a fire-and-forget history
 *     restore (fresh store only for a genuinely new AND empty session;
 *     PRD §05 h2.33).
 *
 *   message_end — feed the pipeline. NEVER returns a value: pi treats a
 *     MessageEndEventResult as a message REPLACEMENT (PRD §02 h2.12), so
 *     every code path here returns undefined.
 *
 *   session_shutdown — dispose the display provider (popup-scheduler
 *     timers) and the pipeline (debounce timer + pending queue), then
 *     drop every reference. Nothing to persist (no persistence by design).
 *
 *   before_agent_start — explicit no-op stub in M1; the chain-reset
 *     machine lands in P2.M2.T2.S1.
 *
 * Compaction events are intentionally NOT registered: the store survives
 * compaction (PRD §05 h2.32).
 *
 * Failure model: a dictionary that fails to load disables INGESTION
 * permanently for this extension runtime — exactly one "error" notify,
 * then every later event degrades to a no-op — while the (empty)
 * provider stays registered so pi's built-in completion is delegated to
 * (never-hijack, PRD §07): zero candidates, zero interference, no crash.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadDictionary } from "../core/dictionary.js";
import { CandidateStore } from "../core/store.js";
import type { Dictionary } from "../core/types.js";
import { loadConfig } from "./config.js";
import { registerAcwordsCommand } from "./debug.js";
import { IngestPipeline, restoreFromHistory } from "./ingest.js";
import { resolveDictPath } from "./paths.js";
import { createDisplayProvider, createHapaxProvider } from "./provider.js";

/**
 * Dictionary path resolution lives in ./paths.js (P1.M3.T5.S2): the seam
 * S1 left PROVISIONAL was extracted there so the jiti-safe dual
 * __dirname / import.meta.url pattern is testable in isolation.
 * Re-exported under the same name so the S1 import contract is stable.
 */
export { resolveDictPath };

/**
 * Dictionary that defers loadDictionary(path) to the FIRST lookup
 * (PRD §02: session_start must not do heavy I/O; lookups happen in the
 * background drain, never on a keystroke path). Satisfies the exact
 * Dictionary contract the IngestPipeline consumes
 * ({ lookup(word): number | null; version; entryCount }).
 *
 * Failure is sticky: the first failed load calls onLoadError() EXACTLY
 * once (the caller notifies + permanently disables ingestion), and every
 * later lookup returns null without retrying — the extension must never
 * re-throw from a message drain or stack up repeated error toasts.
 * version/entryCount are getter-backed and report 0 until the dictionary
 * loads (nothing reads them on the ingest path; they exist for
 * completeness of the Dictionary contract).
 */
export function createLazyDictionary(
  path: string,
  onLoadError: () => void,
): Dictionary {
  let dict: Dictionary | null = null;
  let failed = false;

  return {
    lookup(word: string): number | null {
      if (failed) return null;
      if (dict === null) {
        try {
          dict = loadDictionary(path);
        } catch {
          failed = true;
          onLoadError();
          return null;
        }
      }
      return dict.lookup(word);
    },

    get version(): number {
      return dict?.version ?? 0;
    },

    get entryCount(): number {
      return dict?.entryCount ?? 0;
    },
  };
}

/**
 * hapax extension factory (pi's entry point). Holds ALL mutable
 * session state in factory-scope closure variables so a shutdown →
 * session_start cycle (quit/reload/session replacement re-runs both
 * handlers within the same extension runtime) re-initializes everything
 * fresh; `disabled` is the one exception — a dictionary load failure is
 * permanent for the runtime and survives session restarts.
 */
export default function hapax(pi: ExtensionAPI): void {
  let store: CandidateStore | null = null;
  let lazyDict: Dictionary | null = null;
  let pipeline: IngestPipeline | null = null;
  let displayProvider: { dispose(): void } | null = null;
  let disabled = false;

  pi.on("session_start", (event, ctx) => {
    if (disabled) return; // prior dict failure — permanent no-op runtime

    const config = loadConfig({
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
      notify: (m, l) => ctx.ui.notify(m, l),
    });

    store = new CandidateStore();
    lazyDict = createLazyDictionary(resolveDictPath(), () => {
      ctx.ui.notify("hapax: dictionary failed to load", "error");
      disabled = true; // permanent for this extension runtime
    });
    pipeline = new IngestPipeline({ store, dictionary: lazyDict });

    // Stack the hapax provider on pi's current one. Re-registration on
    // reload is acceptable (fresh session, fresh provider); no unregister
    // API exists, and degradation after a dict failure keeps this provider
    // registered with an empty store — zero candidates → delegation.
    ctx.ui.addAutocompleteProvider((current) => {
      const p = createDisplayProvider(
        createHapaxProvider(store!, config, current),
      );
      displayProvider = p;
      return p;
    });

    // /acwords only in debug mode (PRD §08 h2.48): the command must not
    // exist in normal runs.
    if (config.debug) registerAcwordsCommand(pi, { store, pipeline, config });

    // Restore gating (PRD §05 h2.33): the store starts fresh ONLY for a
    // genuinely new AND empty session; every other reason (startup,
    // reload, resume, fork) restores, as does "new" that unexpectedly
    // carries history. restoreFromHistory is itself a no-op on empty
    // history — the pre-check just honors the contract explicitly. The
    // probe is guarded: a pi API change must degrade to "no restore",
    // never break session start.
    let hasHistory = false;
    try {
      hasHistory =
        ctx.sessionManager.getBranch().length > 0 ||
        ctx.sessionManager.getEntries().length > 0;
    } catch {
      /* treat as empty */
    }
    if (event.reason !== "new" || hasHistory) {
      restoreFromHistory(pipeline, ctx.sessionManager);
    }
  });

  pi.on("message_end", (event) => {
    if (!disabled && pipeline) pipeline.onMessageEnd(event.message);
    // NEVER return a value: a MessageEndEventResult would REPLACE the
    // finalized message (PRD §02 h2.12). hapax only observes.
  });

  pi.on("session_shutdown", () => {
    // Popup-scheduler timers (display debounce), then the pipeline's
    // debounce timer + pending queue. Nothing to persist.
    displayProvider?.dispose();
    pipeline?.dispose();
    displayProvider = null;
    pipeline = null;
    lazyDict = null;
    store = null;
  });

  pi.on("before_agent_start", () => {
    /* no-op in M1 — the chain-reset machine is P2.M2.T2.S1 */
  });
}