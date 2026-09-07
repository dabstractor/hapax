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
 * This module imports ONLY node builtins — zero pi imports — so the
 * loader is trivially unit-testable: notify, cwd, projectTrusted and
 * homeDir are all injected. src/pi/index.ts (P1.M3.T5) wires them to
 * ctx.ui.notify(...) and ctx.isProjectTrusted().
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Extension settings — deliberately tiny (PRD §08). Never extend this
 * with tuning constants: salience weights, admission bands (100/50),
 * shape-gate rules, the eviction cap, debounce intervals, and popup
 * timing are NOT configurable (settled decision).
 */
export interface HapaxConfig {
  /** single non-word non-space char, or "" to disable trigger mode */
  triggerChar: string;
  /** chars before threshold matching: 1 | 2 | 3 */
  threshold: number;
  /** 1–20 */
  maxSuggestions: number;
  /** M2 flag; INERT in M1 builds */
  enablePhrases: boolean;
  /** enables /acwords command + store dump */
  debug: boolean;
}

export const DEFAULT_CONFIG: HapaxConfig = {
  triggerChar: "#",
  threshold: 2,
  maxSuggestions: 8,
  enablePhrases: true,
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

  if ("enablePhrases" in raw) {
    const v = raw.enablePhrases;
    if (typeof v === "boolean") {
      next.enablePhrases = v;
    } else {
      notify(
        `hapax: invalid enablePhrases in ${filePath}, using ${formatValue(current.enablePhrases)}`,
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