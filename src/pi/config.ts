/**
 * Config — load / merge / validate the hapax extension settings
 * (PRD §08). pi exposes no extension-settings API, so the extension
 * reads plain JSON itself. Three layers merge in order, later wins:
 *
 *   1. built-in defaults (DEFAULT_CONFIG, below),
 *   2. ~/.pi/agent/hapax.json  (user-global),
 *   3. .pi/hapax.json          (project-local, trusted projects only).
 *
 * A layer that fails to parse — or parses to anything that is not a
 * plain object — is discarded entirely with exactly one warning; the
 * previous layers still apply. A present-but-invalid value is repaired
 * to the previous layer's value with one warning per repaired field;
 * out-of-range numbers are clamped silently (clamping is normalization,
 * not repair). Missing files are the normal case and stay silent.
 * Unknown keys are ignored (forward compatibility).
 *
 * Chaining flag (PRD §08 h2.46): the primary key is `enableChaining`,
 * gating ONLY the successor-index chain layer (word completion is
 * unaffected either way). `enablePhrases` is accepted as a DEPRECATED
 * alias KEY, resolved per layer (alias first, primary overrides) with a
 * one-per-layer deprecation notify; it writes `enableChaining` directly
 * — the config object itself carries only `enableChaining` (the
 * transitional mirror field was removed by P1.M3.T1.S2, which re-pointed
 * the last gate reads).
 *
 * This module imports only node builtins plus one pure constant
 * (REJECT_COMMON_THRESHOLD from ../core/score.js — the config default
 * and the baked band stay one number, never two) — zero pi imports —
 * so the loader is trivially unit-testable: notify, cwd, projectTrusted
 * and homeDir are all injected. src/pi/index.ts (P1.M3.T5) wires them
 * to ctx.ui.notify(...) and ctx.isProjectTrusted().
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { REJECT_COMMON_THRESHOLD } from "../core/score.js";

/**
 * Extension settings — deliberately tiny (PRD §08). Never extend this
 * with tuning constants: salience weights, admission bands (100/50),
 * shape-gate rules, the eviction cap, debounce intervals, and popup
 * timing are NOT configurable (settled decision).
 */
export interface HapaxConfig {
  /** single non-word non-space char, or "" to disable trigger mode */
  triggerChar: string;
  /** chars before threshold matching: 1 | 2 | 3. NOTE (2026-09):
   *  inert in the live editor — pi-tui only requests suggestions at a
   *  word start, so the provider clamps the effective threshold to 1
   *  (see provider.ts). Kept for schema compatibility. */
  threshold: number;
  /** 1–20 */
  maxSuggestions: number;
  /** Commonness quantile at/above which a word is REJECTED from the
   *  store (1–255; higher = looser). Default: score.ts's baked
   *  REJECT_COMMON_THRESHOLD (50). This is the ongoing dial for "too
   *  many common words in the menu" — e.g. "lists" sits at q = 49,
   * one notch below the default, so setting 49 rejects it. Probe any
   * word's q with: node tools/calibrate-bands.mjs <word...> */
  rejectCommonness: number;
  /** Hesitation gate for the menu's first appearance (ms; 0–2000).
   *  While the menu is closed, a word-completion paints only when the
   *  keystroke arrived ≥ this many ms after the previous one — typing
   *  full speed never pops the menu; hesitating does. MEASURED AT THE
   *  WORD BOUNDARY: queries only ever fire at word starts (pi-tui asks
   *  once per word), and the space→letter transition is the LONGEST
   *  natural gap in typing (150–250 ms at 100+ WPM) — 150 suppressed
   *  almost nothing in real rhythm (live-reported) despite passing
   *  uniformly-paced tests; 300 clears real flow while a genuine
   *  "what was that word" hesitation (400 ms+) still opens. True
   *  keystroke timing comes from the editor proxy's input clock;
   *  without an editor factory it degrades to query-gap timing (rarely
   *  suppresses). Trigger-char and Tab-chain results bypass the gate
   *  (explicit intent). 0 = always immediate. */
  menuDelayMs: number;
  /** PRIMARY chaining flag (PRD §08 h2.46): gates the successor-index
   *  chain layer ONLY — word completion is unaffected either way. The
   *  deprecated `enablePhrases` alias KEY remains accepted and writes
   *  this field (P1.M3.T1.S2 removed the former mirror field). */
  enableChaining: boolean;
  /** enables /acwords command + store dump */
  debug: boolean;
}

export const DEFAULT_CONFIG: HapaxConfig = {
  triggerChar: "#",
  threshold: 2,
  maxSuggestions: 8,
  rejectCommonness: REJECT_COMMON_THRESHOLD,
  menuDelayMs: 300,
  enableChaining: true,
  debug: false,
};

export interface LoadConfigOptions {
  cwd: string;
  projectTrusted: boolean;
  notify: (msg: string, level: "warning") => void;
  /** override for tests; defaults to os.homedir() */
  homeDir?: string;
}

type Notify = LoadConfigOptions["notify"];

/**
 * triggerChar is valid iff it is exactly one non-word non-space
 * character (/^[^\w\s]$/ — so "##", "a", "_" and " " all fail) or the
 * empty string, which disables trigger mode entirely.
 */
export function validateTriggerChar(value: unknown): value is string {
  return typeof value === "string" && (value === "" || /^[^\w\s]$/.test(value));
}

/**
 * Clamp a number into [min, max] after rounding (threshold 1–3,
 * maxSuggestions 1–20). Out-of-range numbers are a clamp, not a repair
 * — the value is the right type, merely out of bounds — so it never
 * warns.
 */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Best-effort errno code off an unknown throw (node fs errors carry `code`). */
function errCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Human-readable fragment for the unreadable-file warning. */
function describeErr(err: unknown): string {
  return errCode(err) ?? (err instanceof Error ? err.message : String(err));
}

/** Render a repaired-to value for warning text: strings quoted,
 *  numbers/booleans bare. */
function formatValue(value: string | number | boolean): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

/**
 * Read one config layer. Missing file (ENOENT) → undefined, silent —
 * that is the normal case. Any other fs error (EACCES, EISDIR, ENOTDIR,
 * …) is treated as missing plus one warning: a silently-unreadable file
 * must not look identical to an absent one. Malformed content — a JSON
 * parse error, or JSON that is not a plain object (array, string,
 * number, null, …) — discards the whole layer with exactly one warning
 * naming the path.
 */
function readLayer(
  filePath: string,
  notify: Notify,
): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    if (errCode(err) === "ENOENT") return undefined;
    notify(
      `hapax: cannot read ${filePath} (${describeErr(err)}), using defaults`,
      "warning",
    );
    return undefined;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    notify(`hapax: malformed ${filePath}, using defaults`, "warning");
    return undefined;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    notify(`hapax: malformed ${filePath}, using defaults`, "warning");
    return undefined;
  }

  return raw as Record<string, unknown>;
}

/**
 * Merge one parsed layer over `current` (defaults → user → project,
 * later wins). Only present keys are considered: valid values override,
 * invalid values repair to `current` (the previous layers' result) with
 * one warning naming the field and the file. Unknown keys are ignored
 * silently. Accepts only real booleans — no truthy coercion; JSON has
 * real booleans.
 */
function applyLayer(
  current: HapaxConfig,
  raw: Record<string, unknown>,
  filePath: string,
  notify: Notify,
): HapaxConfig {
  const next: HapaxConfig = { ...current };

  if ("triggerChar" in raw) {
    const v = raw.triggerChar;
    if (validateTriggerChar(v)) {
      next.triggerChar = v;
    } else {
      notify(
        `hapax: invalid triggerChar in ${filePath}, using ${formatValue(current.triggerChar)}`,
        "warning",
      );
    }
  }

  if ("threshold" in raw) {
    const v = raw.threshold;
    if (typeof v === "number") {
      next.threshold = clampNumber(v, 1, 3);
    } else {
      notify(
        `hapax: invalid threshold in ${filePath}, using ${formatValue(current.threshold)}`,
        "warning",
      );
    }
  }

  if ("maxSuggestions" in raw) {
    const v = raw.maxSuggestions;
    if (typeof v === "number") {
      next.maxSuggestions = clampNumber(v, 1, 20);
    } else {
      notify(
        `hapax: invalid maxSuggestions in ${filePath}, using ${formatValue(current.maxSuggestions)}`,
        "warning",
      );
    }
  }

  if ("rejectCommonness" in raw) {
    const v = raw.rejectCommonness;
    if (typeof v === "number") {
      next.rejectCommonness = clampNumber(v, 1, 255);
    } else {
      notify(
        `hapax: invalid rejectCommonness in ${filePath}, using ${formatValue(current.rejectCommonness)}`,
        "warning",
      );
    }
  }

  if ("menuDelayMs" in raw) {
    const v = raw.menuDelayMs;
    if (typeof v === "number") {
      next.menuDelayMs = clampNumber(v, 0, 2000);
    } else {
      notify(
        `hapax: invalid menuDelayMs in ${filePath}, using ${formatValue(current.menuDelayMs)}`,
        "warning",
      );
    }
  }

  // Chaining flag (PRD §08 h2.46): the deprecated `enablePhrases`
  // alias resolves FIRST, then the primary `enableChaining` overrides
  // when present and valid — so the primary wins when both appear
  // (in-layer or across layers, via ordinary later-wins). Only real
  // booleans; no truthy coercion. The alias KEY is accepted forever
  // (h2.46) and writes `next.enableChaining` directly — the former
  // mirror FIELD is gone (P1.M3.T1.S2).
  if ("enablePhrases" in raw) {
    const v = raw.enablePhrases;
    if (typeof v === "boolean") {
      next.enableChaining = v;
      notify(
        `hapax: enablePhrases is deprecated; use enableChaining (mapped)`,
        "warning",
      );
    } else {
      notify(
        `hapax: invalid enablePhrases in ${filePath}, using ${formatValue(current.enableChaining)}`,
        "warning",
      );
    }
  }

  if ("enableChaining" in raw) {
    const v = raw.enableChaining;
    if (typeof v === "boolean") {
      next.enableChaining = v;
    } else {
      // Repair target is next.enableChaining — the alias-resolved value
      // when a valid alias preceded in this layer (that is the value
      // actually kept), else the pre-layer value.
      notify(
        `hapax: invalid enableChaining in ${filePath}, using ${formatValue(next.enableChaining)}`,
        "warning",
      );
    }
  }

  if ("debug" in raw) {
    const v = raw.debug;
    if (typeof v === "boolean") {
      next.debug = v;
    } else {
      notify(
        `hapax: invalid debug in ${filePath}, using ${formatValue(current.debug)}`,
        "warning",
      );
    }
  }

  return next;
}

/**
 * Load the effective hapax config: defaults → user-global
 * (~/.pi/agent/hapax.json) → project-local (.pi/hapax.json, read only
 * when `projectTrusted`). Trust is decided by the caller BEFORE any
 * filesystem access — an untrusted project's config is never read, not
 * even stat'd. Warnings (malformed layer, repaired field, unreadable
 * file) go through the injected `notify` at level "warning"; missing
 * files stay silent. The returned object is a fresh copy — callers may
 * mutate it without touching DEFAULT_CONFIG.
 */
export function loadConfig(opts: LoadConfigOptions): HapaxConfig {
  const notify: Notify = opts.notify;
  const home = opts.homeDir ?? homedir();
  const userPath = join(home, ".pi", "agent", "hapax.json");
  const projectPath = join(opts.cwd, ".pi", "hapax.json");

  let config: HapaxConfig = { ...DEFAULT_CONFIG };

  const user = readLayer(userPath, notify);
  if (user !== undefined) config = applyLayer(config, user, userPath, notify);

  if (opts.projectTrusted) {
    const project = readLayer(projectPath, notify);
    if (project !== undefined) {
      config = applyLayer(config, project, projectPath, notify);
    }
  }

  return config;
}