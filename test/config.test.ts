/**
 * PRD §08 configuration suite (P1.M3.T1.S1): the three-layer merge
 * (defaults → user-global ~/.pi/agent/hapax.json → project-local
 * .pi/hapax.json, later wins), trust gating of the project layer,
 * malformed-file fallback (exactly one warning naming the path; the
 * remaining layers still apply), per-field repair semantics (invalid
 * values fall back to the PREVIOUS layer's value with a warning;
 * out-of-range numbers clamp silently), exact defaults, and the pure
 * validation helpers. The loader is node-pure — notify, cwd and
 * homeDir are injected — so fixtures are plain JSON files inside
 * mkdtemp scratch dirs; no pi runtime involved.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clampNumber,
  DEFAULT_CONFIG,
  loadConfig,
  validateTriggerChar,
} from "../src/pi/config.js";
import type { HapaxConfig, LoadConfigOptions } from "../src/pi/config.js";

/** Recorded notify call. Every warning must carry level "warning". */
interface Warning {
  msg: string;
  level: string;
}

/** Scratch home + project trees under one temp root. */
interface Harness {
  root: string;
  home: string;
  cwd: string;
  warnings: Warning[];
}

let h: Harness;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "hapax-cfg-"));
  h = {
    root,
    home: join(root, "home"),
    cwd: join(root, "project"),
    warnings: [],
  };
  mkdirSync(join(h.home, ".pi", "agent"), { recursive: true });
  mkdirSync(join(h.cwd, ".pi"), { recursive: true });
});

afterEach(() => {
  rmSync(h.root, { recursive: true, force: true });
});

const userPath = (): string => join(h.home, ".pi", "agent", "hapax.json");
const projectPath = (): string => join(h.cwd, ".pi", "hapax.json");

/** Write a fixture file; strings are written raw (to make malformed
 *  JSON), objects are pretty-printed. Returns the path it wrote. */
const writeConfig =
  (makePath: () => string) =>
  (content: object | string): string => {
    const p = makePath();
    writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    return p;
  };

const writeUserConfig = writeConfig(userPath);
const writeProjectConfig = writeConfig(projectPath);

const loadOpts = (over: Partial<LoadConfigOptions> = {}): LoadConfigOptions => ({
  cwd: h.cwd,
  projectTrusted: true,
  homeDir: h.home,
  notify: (msg, level) => {
    h.warnings.push({ msg, level });
  },
  ...over,
});

describe("defaults — no config files (PRD §08)", () => {
  it("returns exactly the built-in defaults and never notifies", () => {
    expect(loadConfig(loadOpts())).toEqual(DEFAULT_CONFIG);
    expect(loadConfig(loadOpts())).toEqual({
      triggerChar: "#",
      threshold: 2,
      maxSuggestions: 8,
      enablePhrases: true,
      debug: false,
    });
    expect(h.warnings).toEqual([]);
  });

  it("returns a fresh copy — mutating it never touches DEFAULT_CONFIG", () => {
    const cfg = loadConfig(loadOpts());
    cfg.triggerChar = "!";
    cfg.threshold = 3;
    expect(DEFAULT_CONFIG.triggerChar).toBe("#");
    expect(DEFAULT_CONFIG.threshold).toBe(2);
  });

  it("empty JSON objects in both files change nothing and stay silent", () => {
    writeUserConfig({});
    writeProjectConfig({});
    expect(loadConfig(loadOpts())).toEqual(DEFAULT_CONFIG);
    expect(h.warnings).toEqual([]);
  });

  it("unknown keys are ignored silently (forward compatibility)", () => {
    writeUserConfig({ futureOption: true, salienceWeight: 0.9 });
    writeProjectConfig({ admissionBandLow: 120, debounceMs: 30 });
    expect(loadConfig(loadOpts())).toEqual(DEFAULT_CONFIG);
    expect(h.warnings).toEqual([]);
  });
});

describe("layer precedence — defaults → user → project, later wins", () => {
  const allOverrides = {
    triggerChar: "%",
    threshold: 3,
    maxSuggestions: 20,
    enablePhrases: false,
    debug: true,
  };

  it("a valid user-global layer overrides every default", () => {
    writeUserConfig(allOverrides);
    expect(loadConfig(loadOpts())).toEqual(allOverrides);
    expect(h.warnings).toEqual([]);
  });

  it("a valid project-local layer overrides the user-global layer", () => {
    writeUserConfig(allOverrides);
    writeProjectConfig({ triggerChar: "?", threshold: 1, debug: false });
    const cfg = loadConfig(loadOpts());
    expect(cfg.triggerChar).toBe("?");
    expect(cfg.threshold).toBe(1);
    expect(cfg.debug).toBe(false);
    // Untouched keys keep the user-global values.
    expect(cfg.maxSuggestions).toBe(20);
    expect(cfg.enablePhrases).toBe(false);
    expect(h.warnings).toEqual([]);
  });

  it("per-key precedence: only the keys a layer defines move", () => {
    writeUserConfig({ threshold: 1, debug: true });
    writeProjectConfig({ threshold: 2 });
    const cfg = loadConfig(loadOpts());
    expect(cfg.threshold).toBe(2); // project wins on threshold
    expect(cfg.debug).toBe(true); // user still owns debug
  });
});

describe("trust gating — untrusted ⇒ project layer ignored entirely", () => {
  it("an untrusted project's overrides never apply, no warning either", () => {
    writeUserConfig({ threshold: 1 });
    writeProjectConfig({ threshold: 3, triggerChar: "?" });
    const cfg = loadConfig(loadOpts({ projectTrusted: false }));
    expect(cfg.threshold).toBe(1);
    expect(cfg.triggerChar).toBe("#");
    expect(h.warnings).toEqual([]);
  });

  it("untrusted with ONLY a project file → pure defaults, notify never called", () => {
    writeProjectConfig({ triggerChar: "?", debug: true });
    expect(loadConfig(loadOpts({ projectTrusted: false }))).toEqual(DEFAULT_CONFIG);
    expect(h.warnings).toEqual([]);
  });

  it("the untrusted path is never even probed: .pi as a plain file is silent untrusted, warns trusted", () => {
    rmSync(join(h.cwd, ".pi"), { recursive: true });
    writeFileSync(join(h.cwd, ".pi"), "not a directory");

    // Trusted: reading .pi/hapax.json fails with a non-ENOENT fs error
    // (ENOTDIR) → one "cannot read" warning naming the path.
    loadConfig(loadOpts({ projectTrusted: true }));
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.level).toBe("warning");
    expect(h.warnings[0]!.msg).toContain(projectPath());

    // Untrusted: the path is never touched → zero warnings.
    h.warnings.length = 0;
    loadConfig(loadOpts({ projectTrusted: false }));
    expect(h.warnings).toEqual([]);
  });
});

describe("malformed files — discard the layer, one warning, keep going", () => {
  it("malformed user-global JSON: one exact warning; project layer still applies", () => {
    const p = writeUserConfig("garbage{");
    writeProjectConfig({ triggerChar: "?" });
    const cfg = loadConfig(loadOpts());
    expect(cfg.triggerChar).toBe("?"); // project still applied
    expect(cfg.threshold).toBe(2); // defaults elsewhere
    expect(h.warnings).toEqual([{ msg: `hapax: malformed ${p}, using defaults`, level: "warning" }]);
  });

  it("malformed project JSON: one exact warning; user layer still applies", () => {
    writeUserConfig({ threshold: 1 });
    const p = writeProjectConfig('{"triggerChar": "?",');
    const cfg = loadConfig(loadOpts());
    expect(cfg.threshold).toBe(1); // user still applied
    expect(cfg.triggerChar).toBe("#"); // project layer discarded
    expect(h.warnings).toEqual([{ msg: `hapax: malformed ${p}, using defaults`, level: "warning" }]);
  });

  it("valid JSON that is not a plain object counts as malformed", () => {
    for (const root of ["[1, 2]", '"nope"', "null", "42", "true"]) {
      h.warnings.length = 0;
      const p = writeProjectConfig(root);
      const cfg = loadConfig(loadOpts());
      expect(cfg, `root = ${root}`).toEqual(DEFAULT_CONFIG);
      expect(h.warnings, `root = ${root}`).toEqual([
        { msg: `hapax: malformed ${p}, using defaults`, level: "warning" },
      ]);
    }
  });

  it("both files malformed → two warnings (one per path), pure defaults", () => {
    const u = writeUserConfig("{oops");
    const p = writeProjectConfig("{oops");
    expect(loadConfig(loadOpts())).toEqual(DEFAULT_CONFIG);
    expect(h.warnings).toHaveLength(2);
    expect(h.warnings.map((w) => w.msg)).toEqual([
      `hapax: malformed ${u}, using defaults`,
      `hapax: malformed ${p}, using defaults`,
    ]);
    expect(h.warnings.every((w) => w.level === "warning")).toBe(true);
  });
});

describe("triggerChar validation and repair", () => {
  it.each(["##", "a", " ", 42, null, {}, ["#"]])(
    "invalid triggerChar %p repairs to the default # with one warning",
    (bad) => {
      writeUserConfig({ triggerChar: bad as unknown });
      const p = userPath();
      expect(loadConfig(loadOpts()).triggerChar).toBe("#");
      expect(h.warnings).toHaveLength(1);
      expect(h.warnings[0]!.msg).toContain("triggerChar");
      expect(h.warnings[0]!.msg).toContain(p);
    },
  );

  it('the empty string is accepted (disables trigger mode), silently', () => {
    writeUserConfig({ triggerChar: "" });
    expect(loadConfig(loadOpts()).triggerChar).toBe("");
    expect(h.warnings).toEqual([]);
  });

  it('a single non-word non-space char is accepted', () => {
    writeUserConfig({ triggerChar: "%" });
    expect(loadConfig(loadOpts()).triggerChar).toBe("%");
    expect(h.warnings).toEqual([]);
  });

  it("repair falls back to the PREVIOUS layer's value, not the default", () => {
    writeUserConfig({ triggerChar: "!" });
    writeProjectConfig({ triggerChar: "##" });
    const cfg = loadConfig(loadOpts());
    expect(cfg.triggerChar).toBe("!");
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("triggerChar");
    expect(h.warnings[0]!.msg).toContain(projectPath());
  });
});

describe("threshold / maxSuggestions — clamp in range, repair on type", () => {
  it("threshold 0 → 1 and 5 → 3, silently", () => {
    writeUserConfig({ threshold: 0 });
    expect(loadConfig(loadOpts()).threshold).toBe(1);
    h.warnings.length = 0;
    writeUserConfig({ threshold: 5 });
    expect(loadConfig(loadOpts()).threshold).toBe(3);
    expect(h.warnings).toEqual([]);
  });

  it("threshold fractions round then clamp: 2.6 → 3, 1.4 → 1", () => {
    writeUserConfig({ threshold: 2.6 });
    expect(loadConfig(loadOpts()).threshold).toBe(3);
    h.warnings.length = 0;
    writeUserConfig({ threshold: 1.4 });
    expect(loadConfig(loadOpts()).threshold).toBe(1);
    expect(h.warnings).toEqual([]);
  });

  it('threshold "two" repairs to the previous layer\'s (clamped) value with a warning', () => {
    writeUserConfig({ threshold: 5 }); // → 3
    writeProjectConfig({ threshold: "two" });
    const cfg = loadConfig(loadOpts());
    expect(cfg.threshold).toBe(3);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("threshold");
    expect(h.warnings[0]!.msg).toContain(projectPath());
  });

  it("maxSuggestions -3 → 1 and 99 → 20, silently", () => {
    writeUserConfig({ maxSuggestions: -3 });
    expect(loadConfig(loadOpts()).maxSuggestions).toBe(1);
    h.warnings.length = 0;
    writeUserConfig({ maxSuggestions: 99 });
    expect(loadConfig(loadOpts()).maxSuggestions).toBe(20);
    expect(h.warnings).toEqual([]);
  });
});

describe("boolean fields — real booleans only, no truthy coercion", () => {
  it('enablePhrases "yes" repairs to the previous value with a warning; false is accepted', () => {
    writeUserConfig({ enablePhrases: "yes" });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enablePhrases).toBe(true);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("enablePhrases");
    expect(h.warnings[0]!.msg).toContain(userPath());

    h.warnings.length = 0;
    writeUserConfig({ enablePhrases: false });
    expect(loadConfig(loadOpts()).enablePhrases).toBe(false);
    expect(h.warnings).toEqual([]);
  });

  it("debug 1 repairs to the previous value with a warning; true is accepted", () => {
    writeProjectConfig({ debug: 1 });
    const cfg = loadConfig(loadOpts());
    expect(cfg.debug).toBe(false);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("debug");
    expect(h.warnings[0]!.msg).toContain(projectPath());

    h.warnings.length = 0;
    writeProjectConfig({}); // drop the invalid project fixture
    writeUserConfig({ debug: true });
    expect(loadConfig(loadOpts()).debug).toBe(true);
    expect(h.warnings).toEqual([]);
  });

  it("a user-level repair is the previous value for a later project layer", () => {
    writeUserConfig({ enablePhrases: false });
    writeProjectConfig({ enablePhrases: "yes" });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enablePhrases).toBe(false); // repaired to user's false
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("enablePhrases");
    expect(h.warnings[0]!.msg).toContain(projectPath());
  });
});

describe("pure helpers", () => {
  it("validateTriggerChar: exactly one non-word non-space char, or empty", () => {
    for (const ok of ["#", "%", "~", "!", "", "§"]) {
      expect(validateTriggerChar(ok), `accept ${JSON.stringify(ok)}`).toBe(true);
    }
    for (const bad of ["##", "a", "A", " ", "\t", "_", "3", "# ", 42, null, undefined, {}, ["#"]]) {
      expect(validateTriggerChar(bad), `reject ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("clampNumber: rounds then clamps into [min, max]", () => {
    expect(clampNumber(2, 1, 3)).toBe(2);
    expect(clampNumber(0, 1, 3)).toBe(1);
    expect(clampNumber(5, 1, 3)).toBe(3);
    expect(clampNumber(2.6, 1, 3)).toBe(3); // Math.round first
    expect(clampNumber(1.4, 1, 3)).toBe(1);
    expect(clampNumber(2.5, 1, 3)).toBe(3); // .5 rounds up
    expect(clampNumber(-3, 1, 20)).toBe(1);
    expect(clampNumber(99, 1, 20)).toBe(20);
    expect(clampNumber(7, 1, 20)).toBe(7);
  });
});

describe("warning contract", () => {
  it("every notify call uses level exactly 'warning'", () => {
    writeUserConfig("garbage{");
    writeProjectConfig({ triggerChar: "##", threshold: "two" });
    loadConfig(loadOpts());
    expect(h.warnings.length).toBeGreaterThanOrEqual(2);
    expect(h.warnings.every((w) => w.level === "warning")).toBe(true);
    expect(h.warnings.every((w) => w.msg.startsWith("hapax:"))).toBe(true);
  });

  it("one notification per repaired field, never for missing files", () => {
    writeUserConfig({ triggerChar: "##", threshold: "two", debug: 1 });
    loadConfig(loadOpts());
    expect(h.warnings).toHaveLength(3);
    const fields = h.warnings.map((w) => {
      const m = /invalid (\w+) in/.exec(w.msg);
      return m![1]!;
    });
    expect(fields.sort()).toEqual(["debug", "threshold", "triggerChar"]);
  });
});

/** Type-level sanity: the exported suite shape matches HapaxConfig. */
const _shapeCheck: HapaxConfig = { ...DEFAULT_CONFIG };
void _shapeCheck;