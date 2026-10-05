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
 *     then the dual-path display branch (spec 07 h2.42): an editor
 *     factory installed → widget PRIMARY (the widget composition wraps
 *     the factory; NO autocomplete provider is registered); no factory →
 *     FALLBACK — the display-debounced autocomplete provider, today's
 *     pre-2026-10 behavior verbatim. /acwords when config.debug and the
 *     fire-and-forget history restore are shared by both paths (fresh
 *     store only for a genuinely new AND empty session; PRD §05 h2.33).
 *
 *   session_tree — /tree branch navigation (P2.M1.T2.S1; spec 05 h2.37,
 *     06 h2.42, 07 h2.46/h3.9/h3.12): guard (disabled / no session /
 *     newLeafId === oldLeafId, both nullable) → discard the pending
 *     ingest queue → release the line claim → gated IN-PLACE rebuild:
 *     flush the in-flight drain into the OLD store, store.reset() on the
 *     SAME instance (the permanently-registered fallback provider must
 *     never be orphaned), then restoreFromHistory replays the active
 *     branch oldest→newest; both display paths are rebound BEFORE the
 *     background task — the widget recomposes around the remembered
 *     pre-hapax factory bound to this rebuild's readiness promise, the
 *     fallback gate re-arms (same provider, never re-registered) — so
 *     every query path waits behind the ≤ 500 ms bound until replay
 *     settle. summaryEntry is never ingested.
 *
 *   message_end — feed the pipeline. NEVER returns a value: pi treats a
 *     MessageEndEventResult as a message REPLACEMENT (PRD §02 h2.12), so
 *     every code path here returns undefined.
 *
 *   session_shutdown — dispose the display provider (popup-scheduler
 *     timers) and the pipeline (debounce timer + pending queue), then
 *     drop every reference. Nothing to persist (no persistence by design).
 *
 *   before_agent_start — resets the Tab-chain machine to idle
 *     (P2.M2.T2.S1, PRD §07 h2.43): a new user turn never inherits an
 *     armed chain.
 *
 * Compaction events are intentionally NOT registered: the store survives
 * compaction (PRD §05 h2.32). session_tree is the ONLY branch-reaction
 * event — compaction NEVER triggers a rebuild (spec 05 h2.37 interplay).
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
import { isEnterSubmitWrapper, wrapEditorFactory } from "./editor.js";
import { IngestPipeline, restoreFromHistory } from "./ingest.js";
import { resolveDictPath } from "./paths.js";
import {
  createChainMachine,
  createDisplayProvider,
  createHapaxProvider,
  createStartupGate,
} from "./provider.js";
import type { ChainMachine, StartupGateHandle } from "./provider.js";
import {
  createLineClaim,
  createWidgetEditorFactory,
  isWidgetWrapper,
  widgetOptsOf,
} from "./widget.js";
import type { LineClaim } from "./widget.js";

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

    /** Failure probe (BUG-004): true once the load threw; never resets
     *  (no lazy retry). Consumed by the factory's isDisabled wiring for
     *  IngestPipeline and (P1.M3.T1.S2) by restoreFromHistory's replay
     *  abort. */
    get failed(): boolean {
      return failed;
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
  let chain: ChainMachine | null = null;
  // Line claim (spec §07 "Line claim", 2026-10): the widget row's
  // per-prompt reservation controller. Fresh per session and injected
  // into the widget composition so before_agent_start can release it
  // alongside the chain (submit-key release lives in the widget key
  // layer itself; this slot is the belt-and-braces turn boundary).
  let claim: LineClaim | null = null;
  let disabled = false;
  // session_tree rebuild slots (P2.M1.T2.S1, spec 05 h2.37): the pieces
  // the branch handler needs that session_start builds — re-assigned on
  // every session_start, cleared on session_shutdown alongside the rest.
  // The fallback path's startup gate: addAutocompleteProvider has no
  // unregister, so a /tree rebuild re-ARMS this same gate (07 h3.12)
  // instead of re-registering. Assigned inside the registration callback.
  let sessionGate: StartupGateHandle | null = null;
  // The live session's config and input-clock tick — the fresh widget
  // composition on /tree needs both (same values the initial install
  // used); per-session consts inside session_start, hoisted here because
  // the session_tree handler runs outside that callback's scope.
  let sessionConfig: ReturnType<typeof loadConfig> | null = null;
  let sessionTickInputClock: (() => void) | null = null;

  pi.on("session_start", (event, ctx) => {
    if (disabled) return; // prior dict failure — permanent no-op runtime

    const config = loadConfig({
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
      notify: (m, l) => ctx.ui.notify(m, l),
    });

    // Bound to a local const, not the nullable factory slot: the hook
    // below — and any drain already in flight when session_shutdown
    // nulls `store` — must always reach this session's store instance,
    // the same object the pipeline's own #store field holds.
    const sessionStore = new CandidateStore();
    store = sessionStore;
    // Tab-chain machine (P2.M2.T2.S1): fresh per session, hoisted to the
    // factory slot so before_agent_start can reset it (nullable like
    // store/pipeline — cleared on session_shutdown alongside them).
    const sessionChain = createChainMachine();
    chain = sessionChain;
    // Line claim (spec §07): one controller per session, shared with the
    // widget composition below (render arms it at the first non-empty
    // paint; the submit key and before_agent_start release it).
    const sessionClaim = createLineClaim();
    claim = sessionClaim;
    lazyDict = createLazyDictionary(resolveDictPath(), () => {
      ctx.ui.notify("hapax: dictionary failed to load", "error");
      disabled = true; // permanent for this extension runtime
    });
    pipeline = new IngestPipeline({
      store: sessionStore,
      dictionary: lazyDict,
      // Ongoing commonness dial (2026-09): flows the user/project
      // config's reject band straight into admission — "lists" (q = 49)
      // et al. stop leaking once the user sets rejectCommonness ≤ 49.
      rejectCommonness: config.rejectCommonness,
      // Sticky dict-failure flag → ingestion gate (BUG-004): stops
      // admissions the instant a lookup observes the failed load —
      // covering the message drain AND restoreFromHistory replay (both
      // funnel through processText).
      isDisabled: () => disabled,
      // Bigram capture (PRD §06 h2.38), live only when enabled (PRD §08):
      // adjacency RUNS of admitted whole-token keys (P1.M1.T3.S2 — strict
      // whitespace-only adjacency, PRD 002 §06 h3.6) → bigram upserts. The
      // store reads currentOrdinal() itself — the message's ordinal was already
      // issued by processText (nextOrdinal before the first slice).
      //
      // Chaining gate (PRD §08 h2.46, re-pointed by P1.M3.T1.S2):
      // recordBigramRuns is the ONLY successor-index path — the store
      // builds its word → top-3 successor index inside it and nowhere
      // else — so with enableChaining:false this hook stays unwired: no
      // bigrams, no successors, and the chain machine can never arm
      // from real data. Word completion is unaffected (the pipeline
      // still ingests candidates; this hook only feeds the bigram
      // layer), and before_agent_start's chain?.reset() is already
      // no-op-safe when the layer is disabled (idle machine).
      // Plan 006 widening: the payload now carries RunMembers
      // ({key, rawCasing, series?}) — the shim projects keys so
      // recordBigramRuns' input stays byte-identical until P1.M1.T2.S2
      // consumes the enrichment (series casing + cap-run marks).
      ...(config.enableChaining
        ? {
            onAdmittedTokens: (runs) =>
              sessionStore.recordBigramRuns(
                runs.map((r) => r.map((m) => m.key)),
              ),
          }
        : {}),
    });

    // Stack the hapax provider on pi's current one. Re-registration on
    // reload is acceptable (fresh session, fresh provider); no unregister
    // API exists, and degradation after a dict failure keeps this provider
    // registered with an empty store — zero candidates → delegation.
    // Startup gate (2026-09, src/pi/provider.ts createStartupGate): the
    // replay signal resolves when history restore settles (end, abort,
    // or error — see restoreFromHistory's onSettled). First queries wait
    // for it (≤ 500 ms) so a word typed while the store replays gets a
    // LATE menu instead of a permanently missing one (pi-tui asks once
    // per word). Fresh sessions with no replay resolve immediately.
    let markReady = (): void => {};
    const restoreReady = new Promise<void>((resolve) => {
      markReady = resolve;
    });

    // Shared input clock — hoisted ABOVE the display branch: BOTH paths
    // need it (the widget composition ticks it via the editor layer; the
    // fallback's enter-submit wrap ticks it today). The display layer's
    // hesitation gate reads clock.prevAt: the keystroke before the one
    // triggering the current query.
    const inputClock = { lastAt: null as number | null, prevAt: null as number | null };
    const tickInputClock = () => {
      const t = Date.now();
      inputClock.prevAt = inputClock.lastAt;
      inputClock.lastAt = t;
    };
    // session_tree rebuild slots (P2.M1.T2.S1): these per-session consts
    // are the cross-handler seams the branch handler reads.
    sessionConfig = config;
    sessionTickInputClock = tickInputClock;

    // Dual-path display architecture (spec 07 h2.42): an editor factory
    // means some extension owns the editor — hapax composes around it and
    // renders its own one-line widget (PRIMARY). No factory → the proxy
    // cannot install; register the provider and use pi-tui's vertical
    // menu (FALLBACK, pre-2026-10 behavior). TOCTOU with later extensions
    // is the same accepted tolerance as today's enter-submit wrap.
    const editorFactory = ctx.ui.getEditorComponent?.();
    if (editorFactory && !isWidgetWrapper(editorFactory)) {
      // PRIMARY: no addAutocompleteProvider — ever. The widget layer owns
      // display + key semantics (skeleton here; S2/T2/T3 extend it). The
      // composition itself includes the Enter-submits guard — never ALSO
      // call wrapEditorFactory (that would stack guards).
      ctx.ui.setEditorComponent?.(
        createWidgetEditorFactory({
          inner: editorFactory,
          store: sessionStore, // bound const, not the nullable slot
          config, // triggerChar, maxSuggestions, menuDelayMs,
          // fuzzThreshold, trigger modes… (S2/T2/T3 consume)
          chain: sessionChain,
          claim: sessionClaim, // render-armed; submit key + turn boundary release
          restoreReady, // startup gate — shared with the fallback
          onKeystroke: tickInputClock, // shared input clock (hesitation timing)
        }),
      );
      // Display-provider slot audit: the widget path leaves the slot
      // empty — every consumer is already null-safe (shutdown disposes
      // via ?., nothing else dereferences it).
      displayProvider = null;
    } else if (editorFactory) {
      // Reload cycle (2026-10 stale-store fix, live-observed via the
      // §09 tmux technique): our widget wrapper is already installed,
      // but this session_start fired for a NEW session (resume/switch,
      // in-process) and built a FRESH store/pipeline/chain/restoreReady
      // above — the installed wrapper still closes over the FIRST
      // session's store, so everything ingested after the re-fire lands
      // in a store the widget never reads: completions served the
      // previous session's vocabulary forever (violating acceptance
      // item 3's resume guarantee). RE-BIND instead of skip: wrap the
      // ORIGINAL pre-hapax factory (remembered in the wrapper's
      // WIDGET_OPTS — this arm only runs when getEditorComponent()
      // still returns OUR wrapper, i.e. no other extension took editor
      // ownership since) in a FRESH composition bound to THIS session's
      // deps. Replacing our own wrapper with a fresh wrapper of the
      // same unwrapped inner preserves the no-stacking invariant
      // (WIDGET_WRAPPED still guards the first branch above) — never
      // nests, never composes around itself.
      const priorInner = widgetOptsOf(editorFactory)?.inner;
      if (priorInner !== undefined) {
        ctx.ui.setEditorComponent?.(
          createWidgetEditorFactory({
            inner: priorInner,
            store: sessionStore, // THIS session's store — never the stale one
            config,
            chain: sessionChain,
            claim: sessionClaim, // fresh composition → unclaimed row (rebind release)
            restoreReady,
            onKeystroke: tickInputClock,
          }),
        );
      }
      displayProvider = null;
    } else {
      // FALLBACK: today's steps 3–4, byte-for-byte (provider registration
      // with createStartupGate + hesitation-gate options; the enter-submit
      // wrap below cannot install — there is no factory — the tolerated
      // pre-2026-10 state).

      // Stack the hapax provider on pi's current one. Re-registration on
      // reload is acceptable (fresh session, fresh provider); no unregister
      // API exists, and degradation after a dict failure keeps this provider
      // registered with an empty store — zero candidates → delegation.
      // Startup gate (2026-09, src/pi/provider.ts createStartupGate): the
      // replay signal resolves when history restore settles (end, abort,
      // or error — see restoreFromHistory's onSettled). First queries wait
      // for it (≤ 500 ms) so a word typed while the store replays gets a
      // LATE menu instead of a permanently missing one (pi-tui asks once
      // per word). Fresh sessions with no replay resolve immediately.
      ctx.ui.addAutocompleteProvider((current) => {
        // The gate is captured into the factory slot: session_tree re-arms
        // THIS instance (07 h3.12 verbatim reuse) — the provider object is
        // registered once and never replaced.
        const gate = createStartupGate(
          createHapaxProvider(store!, config, current, sessionChain),
          restoreReady,
        );
        sessionGate = gate;
        const p = createDisplayProvider(gate, {
            // Hesitation gate (2026-09 menuDelayMs): full-speed typing
            // never pops the menu. Explicit intent bypasses: trigger-char
            // prefixes and armed-chain successor sets (description
            // "chain") always show immediately.
            firstPaintDelayMs: config.menuDelayMs,
            getPreviousKeystrokeAt: () => inputClock.prevAt,
            isIntentResult: (r) =>
              (config.triggerChar !== "" && r.prefix.startsWith(config.triggerChar)) ||
              r.items.some((i) => i.description === "chain"),
          },
        );
        displayProvider = p;
        return p;
      });

      // Enter-submits guard (2026-09, src/pi/editor.ts): with menus
      // auto-opening on typing, pi-tui's Enter-accepts-word-menu behavior
      // would insert candidates instead of submitting. Wrap whatever
      // editor factory an extension set (pi-vim etc.) — capture-previous
      // composition per the extension docs. Idempotent across reloads
      // (a factory that is already ours is not re-wrapped).
      //
      // The proxy ALSO feeds `inputClock` — one tick per real keystroke,
      // the only such seam (a closed menu gets one getSuggestions call
      // per WORD, useless for inter-keystroke timing — the first-cut
      // menuDelayMs gate measured word-to-word gaps and never suppressed;
      // that bug is why this clock exists). The display layer's hesitation
      // gate reads clock.prevAt: the keystroke before the one triggering
      // the current query.
      //
      // Dual-path note: this block is INERT on the fallback path — there
      // is no factory here (a factory would have taken the widget branch,
      // whose composition includes the same guard). Kept byte-for-byte so
      // the tolerated state is unchanged.
      if (editorFactory && !isEnterSubmitWrapper(editorFactory)) {
        ctx.ui.setEditorComponent?.(wrapEditorFactory(editorFactory, tickInputClock));
      }
    }

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
      // BUG-004: abort the replay the moment the dictionary fails.
      // `disabled` flips DURING the replay (the first lookup triggers the
      // failed load), so this must close over the live flag — its value
      // here is still false.
      restoreFromHistory(pipeline, ctx.sessionManager, () => disabled, markReady);
    } else {
      markReady(); // no replay → gate is a pure no-op
    }
  });

  pi.on("session_tree", (event, ctx) => {
    // Branch navigation rebuild (P2.M1.T2.S1, spec 05 h2.37 — adopted
    // ahead of implementation; this handler is that spec landing; 06
    // h2.42 branch purity: the rebuilt store is identical to a fresh
    // /resume of the same branch, pinned by T2.S2's battery).
    //
    // Guard (h2.37 step 1 + the binding preconditions): a disabled
    // runtime, a pre-session_start/post-shutdown factory, or a no-op
    // navigation (newLeafId === oldLeafId — both nullable, so null ===
    // null is covered) touch NOTHING: no discard, no claim release, no
    // rebind, not even a getBranch read. Guard order matters — a
    // disabled runtime must not even discard.
    if (disabled || !pipeline || !store) return;
    if (event.newLeafId === event.oldLeafId) return;
    // h2.37 step 2: drop the pending ingest queue FIRST (sync, sub-ms).
    // Debounce-window texts are pre-navigation; any on the new path is
    // re-captured by the branch snapshot replay, any other is dead
    // branch — discard is always correct.
    pipeline.discardPending();
    // 07 h3.9 release set: session_tree is a rebind — the claimed row is
    // removed and the fresh composition starts unclaimed (the SAME
    // LineClaim object is reused below, release gives it the unclaimed
    // row; release is idempotent).
    claim?.release();
    // Gate readiness promise (07 h3.12): created SYNCHRONOUSLY so the
    // rebinds below bind it before any post-navigation query can race —
    // resolved exactly once when the replay settles (restoreFromHistory
    // onSettled: finish / abort on dict failure / collection throw).
    let markTreeReady = (): void => {};
    const restoreReady = new Promise<void>((resolve) => {
      markTreeReady = resolve;
    });
    // 07 h2.46 "Branch navigation": the same fresh-composition rule as
    // the session_start reload branch, decided by what currently owns the
    // editor slot. Widget path: recompose around the REMEMBERED pre-hapax
    // factory (wrapper introspection seam) bound to THIS rebuild's
    // readiness promise and the SAME store instance (reset in place
    // below — never reassign the `store` slot: the fallback provider's
    // closure would be orphaned). A foreign wrapper (no remembered inner)
    // is skipped silently — the same TOCTOU tolerance as session_start.
    // Fallback path: re-arm the hoisted gate — same provider object,
    // never re-registered; un-settling swaps in the fresh readiness
    // promise so every query (forced requests included) waits under the
    // ≤ 500 ms bound until settle.
    const editorFactory = ctx.ui.getEditorComponent?.();
    if (editorFactory && isWidgetWrapper(editorFactory)) {
      const priorInner = widgetOptsOf(editorFactory)?.inner;
      if (
        priorInner !== undefined &&
        sessionConfig &&
        chain &&
        claim &&
        sessionTickInputClock
      ) {
        ctx.ui.setEditorComponent?.(
          createWidgetEditorFactory({
            inner: priorInner,
            store, // SAME instance — reset in place by the rebuild below
            config: sessionConfig,
            chain,
            claim, // reused session claim — released above → unclaimed row
            restoreReady,
            onKeystroke: sessionTickInputClock,
          }),
        );
      }
    } else {
      sessionGate?.arm(restoreReady);
    }
    // h2.37 steps 3–5: the background rebuild. flush() lets any in-flight
    // drain finish landing its straggler upserts in the OLD store (so
    // the wholesale drop erases them too — reset-before-flush would
    // leak them into the rebuilt store); reset() is the h2.42 in-place
    // wholesale drop (ordinal re-zeroed — the replay re-issues 1..N
    // exactly like a fresh /resume); restoreFromHistory snapshots
    // getBranch() synchronously at call time (the h2.37 "snapshot" —
    // never copied here) and replays oldest→newest through the
    // IDENTICAL restore pipeline, releasing the gate/widget via
    // onSettled exactly once. summaryEntry is never read: branch
    // summaries never enter the store (h2.37 summary rule); abandoned
    // branch vocabulary re-enters only via real messages on the new
    // branch. Synchronous handler cost stays sub-ms (h2.37 performance
    // note) — queue drop + slot reads only; the replay is background.
    const livePipeline = pipeline;
    const liveStore = store;
    void (async () => {
      await livePipeline.flush();
      liveStore.reset();
      restoreFromHistory(livePipeline, ctx.sessionManager, () => disabled, markTreeReady);
    })();
    // No return value: pi result semantics (same discipline as
    // message_end — hapax only observes).
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
    chain = null;
    claim = null; // spec §07 Line claim — session_shutdown release
    store = null;
    sessionGate = null; // session_tree rebuild slots — dropped with the session
    sessionConfig = null;
    sessionTickInputClock = null;
  });

  pi.on("before_agent_start", () => {
    // New user turn → the chain machine goes idle (P2.M2.T2.S1, PRD §07
    // h2.43). Still no return value: pi would treat a result as a reply.
    chain?.reset();
    // …and the line claim releases (spec §07 "Line claim" release set:
    // submit / turn reset / rebind — the submit key usually got here
    // first; this covers any submission path the key layer never saw).
    claim?.release();
  });
}