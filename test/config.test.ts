/**
 * PRD §08 configuration suite (P1.M3.T1.S1): the three-layer merge
 * (defaults → user-global ~/.pi/agent/hapax.json → project-local
 * .pi/hapax.json, later wins), trust gating of the project layer,
 * malformed-file fallback (exactly one warning naming the path; the
 * remaining layers still apply), per-field repair semantics (invalid
 * values fall back to the PREVIOUS layer's value with a warning;
 * out-of-range numbers clamp silently), exact defaults, the pure
 * validation helpers, and the enableChaining primary key with its
 * enablePhrases deprecated alias KEY (PRD §08 h2.46): enableChaining is
 * the only interface field; the alias resolves per layer (alias first,
 * primary overrides) into it — the transitional mirror FIELD was
 * removed by P1.M3.T1.S2. The loader is node-pure —
 * notify, cwd and
 * homeDir are injected — so fixtures are plain JSON files inside
 * mkdtemp scratch dirs; no pi runtime involved.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_FUZZ_THRESHOLD, TRIGGER_FUZZ_THRESHOLD } from "../src/core/query.js";
import {
  clampNumber,
  DEFAULT_CONFIG,
  loadConfig,
  resolveFuzzThreshold,
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
      rejectCommonness: DEFAULT_CONFIG.rejectCommonness,
      fuzzThreshold: DEFAULT_CONFIG.fuzzThreshold,
      menuDelayMs: DEFAULT_CONFIG.menuDelayMs,
      enableChaining: true,
      debug: false,
    });
    expect(h.warnings).toEqual([]);
  });

  it("returns a fresh copy — mutating it never touches DEFAULT_CONFIG", () => {
    const cfg = loadConfig(loadOpts());
    cfg.triggerChar = "!";
    cfg.threshold = 3;
    cfg.enableChaining = false;
    expect(DEFAULT_CONFIG.triggerChar).toBe("#");
    expect(DEFAULT_CONFIG.threshold).toBe(2);
    expect(DEFAULT_CONFIG.enableChaining).toBe(true);
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
    rejectCommonness: 49,
    fuzzThreshold: 90,
    menuDelayMs: 200,
    // Written under the deprecated alias KEY — still accepted, mapped
    // onto enableChaining with one deprecation notify (h2.46). The
    // resolved object carries only enableChaining (no mirror field,
    // P1.M3.T1.S2).
    enablePhrases: false,
    debug: true,
  };
  const allOverridesResolved = {
    triggerChar: "%",
    threshold: 3,
    maxSuggestions: 20,
    rejectCommonness: 49,
    fuzzThreshold: 90,
    fuzzThresholdSet: true, // explicit override (plan 004 P1.M1.T2.S1)
    menuDelayMs: 200,
    enableChaining: false,
    debug: true,
  };

  it("a valid user-global layer overrides every default", () => {
    writeUserConfig(allOverrides);
    expect(loadConfig(loadOpts())).toEqual(allOverridesResolved);
    // The override set uses the deprecated alias key → one mapped warning.
    expect(h.warnings).toEqual([
      {
        msg: "hapax: enablePhrases is deprecated; use enableChaining (mapped)",
        level: "warning",
      },
    ]);
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
    expect(cfg.enableChaining).toBe(false);
    // Exactly the user layer's alias deprecation; the project layer's
    // primary keys are silent.
    expect(h.warnings).toEqual([
      {
        msg: "hapax: enablePhrases is deprecated; use enableChaining (mapped)",
        level: "warning",
      },
    ]);
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

describe("triggerChar reserved-char advisory (2026-09-30 validation Issue 2)", () => {
  // '@'/'/'/'"' are schema-valid (validateTriggerChar unchanged) but
  // structurally dead: classifyStockContext delegates them to pi's stock
  // mention/path/quoted-path contexts BEFORE the trigger branch (BUG-001,
  // config-independent by design). loadConfig warns once on the effective
  // value so the silent failure is visible.
  it.each([
    ["@", "@-mention"],
    ["/", "path/slash-command"],
    ['"', "quoted-path"],
  ])(
    "triggerChar %p applies unchanged but warns once naming the stock context",
    (ch, ctxName) => {
      writeUserConfig({ triggerChar: ch });
      const cfg = loadConfig(loadOpts());
      expect(cfg.triggerChar).toBe(ch);
      expect(h.warnings).toHaveLength(1);
      expect(h.warnings[0]!.level).toBe("warning");
      expect(h.warnings[0]!.msg).toContain("triggerChar");
      expect(h.warnings[0]!.msg).toContain(ctxName);
      expect(h.warnings[0]!.msg).toContain("reserved");
    },
  );

  it("overlapping colliding layers still warn exactly once (effective value checked after merge)", () => {
    writeUserConfig({ triggerChar: "@" });
    writeProjectConfig({ triggerChar: "@" });
    expect(loadConfig(loadOpts()).triggerChar).toBe("@");
    expect(h.warnings).toHaveLength(1);
  });

  it("a later layer overriding the collision away silences the warning", () => {
    writeUserConfig({ triggerChar: "/" });
    writeProjectConfig({ triggerChar: "%" });
    expect(loadConfig(loadOpts()).triggerChar).toBe("%");
    expect(h.warnings).toEqual([]);
  });

  it("empty string and the default # never warn", () => {
    writeUserConfig({ triggerChar: "" });
    writeProjectConfig({ triggerChar: "#" });
    expect(loadConfig(loadOpts()).triggerChar).toBe("#");
    expect(h.warnings).toEqual([]);
  });

  it("a repair back ONTO a colliding value still warns (final value governs)", () => {
    writeUserConfig({ triggerChar: "@" });
    writeProjectConfig({ triggerChar: "##" }); // invalid → repairs to user's "@"
    const cfg = loadConfig(loadOpts());
    expect(cfg.triggerChar).toBe("@");
    // one repair warning + one reserved advisory
    expect(h.warnings).toHaveLength(2);
    expect(h.warnings.some((w) => w.msg.includes("reserved"))).toBe(true);
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

describe("fuzzThreshold — clamp in range, repair on type (PRD §08 h2.52, plan 003 P1.M2.T1.S3)", () => {
  it("the default is query.ts's DEFAULT_FUZZ_THRESHOLD — one number, never two", () => {
    // The rejectCommonness invariant: config.ts auto-imports the baked
    // constant; a literal default here (or in config.ts) would fork it.
    expect(DEFAULT_CONFIG.fuzzThreshold).toBe(DEFAULT_FUZZ_THRESHOLD);
    expect(DEFAULT_CONFIG.fuzzThreshold).toBe(60); // the §08 h2.52 schema default
  });

  it("override round-trips: { fuzzThreshold: 100 } → 100, silently", () => {
    writeUserConfig({ fuzzThreshold: 100 });
    expect(loadConfig(loadOpts()).fuzzThreshold).toBe(100);
    expect(h.warnings).toEqual([]);
  });

  it("out-of-range numbers clamp silently: -5 → 0, 150 → 100", () => {
    writeUserConfig({ fuzzThreshold: -5 });
    expect(loadConfig(loadOpts()).fuzzThreshold).toBe(0);
    h.warnings.length = 0;
    writeUserConfig({ fuzzThreshold: 150 });
    expect(loadConfig(loadOpts()).fuzzThreshold).toBe(100);
    expect(h.warnings).toEqual([]); // clamping is normalization, never a repair
  });

  it("rounds THEN clamps: 100.7 → 100 (not 101), 60.4 → 60", () => {
    writeUserConfig({ fuzzThreshold: 100.7 });
    expect(loadConfig(loadOpts()).fuzzThreshold).toBe(100);
    h.warnings.length = 0;
    writeUserConfig({ fuzzThreshold: 60.4 });
    expect(loadConfig(loadOpts()).fuzzThreshold).toBe(60);
    expect(h.warnings).toEqual([]);
  });

  it.each(["80", null, true])(
    "invalid fuzzThreshold %p repairs to the previous value with exactly one warning",
    (bad) => {
      writeUserConfig({ fuzzThreshold: bad as unknown });
      const p = userPath();
      expect(loadConfig(loadOpts()).fuzzThreshold).toBe(60); // repaired to the default
      expect(h.warnings).toHaveLength(1);
      expect(h.warnings[0]!.msg).toContain("fuzzThreshold");
      expect(h.warnings[0]!.msg).toContain(p);
      expect(h.warnings[0]!.msg).toContain("using 60");
    },
  );

  it("repair target is the PREVIOUS layer's value, not the default: user 90, project \"bad\" → 90", () => {
    writeUserConfig({ fuzzThreshold: 90 });
    writeProjectConfig({ fuzzThreshold: "bad" });
    const cfg = loadConfig(loadOpts());
    expect(cfg.fuzzThreshold).toBe(90);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("fuzzThreshold");
    expect(h.warnings[0]!.msg).toContain(projectPath());
    expect(h.warnings[0]!.msg).toContain("using 90");
  });

  it("unset config resolves per-mode: 60 ambient / 45 trigger (§04 trigger loosening, §08 h2.52)", () => {
    const cfg = loadConfig(loadOpts());
    // The internal signal is ABSENT on a fresh load — never initialized
    // to false (toEqual identity on DEFAULT_CONFIG is the canary).
    expect(cfg.fuzzThresholdSet).toBeUndefined();
    expect(resolveFuzzThreshold(cfg, "ambient")).toBe(DEFAULT_FUZZ_THRESHOLD);
    expect(resolveFuzzThreshold(cfg, "trigger")).toBe(TRIGGER_FUZZ_THRESHOLD);
    expect(resolveFuzzThreshold(cfg, "ambient")).toBe(60);
    expect(resolveFuzzThreshold(cfg, "trigger")).toBe(45);
  });

  it("explicit fuzzThreshold overrides BOTH mode defaults (round-trip, silent)", () => {
    writeUserConfig({ fuzzThreshold: 80 });
    const cfg = loadConfig(loadOpts());
    expect(cfg.fuzzThresholdSet).toBe(true);
    expect(resolveFuzzThreshold(cfg, "ambient")).toBe(80);
    expect(resolveFuzzThreshold(cfg, "trigger")).toBe(80);
    expect(h.warnings).toEqual([]);
  });

  it("clamped explicit values stay explicit — explicit 60 overrides trigger's 45", () => {
    writeUserConfig({ fuzzThreshold: -5 });
    let cfg = loadConfig(loadOpts());
    expect(cfg.fuzzThreshold).toBe(0);
    expect(cfg.fuzzThresholdSet).toBe(true);
    expect(resolveFuzzThreshold(cfg, "ambient")).toBe(0);
    expect(resolveFuzzThreshold(cfg, "trigger")).toBe(0); // explicit 0 = legal

    h.warnings.length = 0;
    writeUserConfig({ fuzzThreshold: 150 });
    cfg = loadConfig(loadOpts());
    expect(resolveFuzzThreshold(cfg, "ambient")).toBe(100);
    expect(resolveFuzzThreshold(cfg, "trigger")).toBe(100);

    h.warnings.length = 0;
    writeUserConfig({ fuzzThreshold: 100.7 });
    expect(resolveFuzzThreshold(loadConfig(loadOpts()), "trigger")).toBe(100);

    h.warnings.length = 0;
    writeUserConfig({ fuzzThreshold: 60.4 });
    cfg = loadConfig(loadOpts());
    expect(cfg.fuzzThreshold).toBe(60);
    // Explicit 60 is NOT the ambient default masquerading: the flag makes
    // it override the trigger mode's 45.
    expect(cfg.fuzzThresholdSet).toBe(true);
    expect(resolveFuzzThreshold(cfg, "trigger")).toBe(60);
    expect(h.warnings).toEqual([]);
  });

  it.each(["80", null, true])(
    "wrong-type fuzzThreshold %p repairs per-mode: value 60, flag unset, one warning",
    (bad) => {
      writeUserConfig({ fuzzThreshold: bad as unknown });
      const p = userPath();
      const cfg = loadConfig(loadOpts());
      expect(cfg.fuzzThreshold).toBe(60);
      // Repair must NOT set the flag — repaired-from-default resolves
      // per-mode (45 under trigger), never locked to 60.
      expect(cfg.fuzzThresholdSet).toBeUndefined();
      expect(resolveFuzzThreshold(cfg, "trigger")).toBe(45);
      expect(h.warnings).toHaveLength(1);
      expect(h.warnings[0]!.msg).toContain("fuzzThreshold");
      expect(h.warnings[0]!.msg).toContain(p);
      expect(h.warnings[0]!.msg).toContain("using 60");
    },
  );

  it("layering preserves explicitness: presence wins, later presence wins, repair keeps the flag", () => {
    // user explicit + project absent → the user value stays explicit
    writeUserConfig({ fuzzThreshold: 80 });
    let cfg = loadConfig(loadOpts());
    expect(cfg.fuzzThreshold).toBe(80);
    expect(cfg.fuzzThresholdSet).toBe(true);
    expect(resolveFuzzThreshold(cfg, "trigger")).toBe(80);

    // project explicit → later presence wins over earlier presence
    writeProjectConfig({ fuzzThreshold: 50 });
    cfg = loadConfig(loadOpts());
    expect(cfg.fuzzThreshold).toBe(50);
    expect(cfg.fuzzThresholdSet).toBe(true);
    expect(resolveFuzzThreshold(cfg, "trigger")).toBe(50);

    // project wrong-type → repairs to the CURRENT (user) value, flag
    // untouched, exactly one warning naming the project file
    writeProjectConfig({ fuzzThreshold: "x" });
    cfg = loadConfig(loadOpts());
    expect(cfg.fuzzThreshold).toBe(80);
    expect(cfg.fuzzThresholdSet).toBe(true);
    expect(resolveFuzzThreshold(cfg, "trigger")).toBe(80);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("fuzzThreshold");
    expect(h.warnings[0]!.msg).toContain(projectPath());
    expect(h.warnings[0]!.msg).toContain("using 80");
  });
});

describe("boolean fields — real booleans only, no truthy coercion", () => {
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
});

describe("enableChaining / enablePhrases — primary key + deprecated alias (PRD §08 h2.46)", () => {
  it("primary key parses: { enableChaining: false } → enableChaining false, no warnings", () => {
    writeUserConfig({ enableChaining: false });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enableChaining).toBe(false);
    expect(h.warnings).toEqual([]);
  });

  it("alias maps: { enablePhrases: false } → enableChaining false + exactly one deprecation warning", () => {
    writeUserConfig({ enablePhrases: false });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enableChaining).toBe(false);
    expect(h.warnings).toEqual([
      {
        msg: "hapax: enablePhrases is deprecated; use enableChaining (mapped)",
        level: "warning",
      },
    ]);
  });

  it("both present, one layer: enableChaining wins; the deprecation warning still fires", () => {
    writeUserConfig({ enablePhrases: true, enableChaining: false });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enableChaining).toBe(false);
    expect(h.warnings).toEqual([
      {
        msg: "hapax: enablePhrases is deprecated; use enableChaining (mapped)",
        level: "warning",
      },
    ]);
  });

  it("both present, reversed: { enablePhrases: false, enableChaining: true } → true", () => {
    writeUserConfig({ enablePhrases: false, enableChaining: true });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enableChaining).toBe(true);
    expect(h.warnings).toHaveLength(1); // alias was present+valid → deprecation fires
  });

  it("cross-layer: project primary overrides a user-layer alias", () => {
    writeUserConfig({ enablePhrases: true });
    writeProjectConfig({ enableChaining: false });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enableChaining).toBe(false);
    expect(h.warnings).toHaveLength(1); // the user layer's deprecation only
  });

  it("cross-layer: project alias overrides a user-layer primary (later layer wins)", () => {
    writeUserConfig({ enableChaining: true });
    writeProjectConfig({ enablePhrases: false });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enableChaining).toBe(false);
    expect(h.warnings).toEqual([
      {
        msg: "hapax: enablePhrases is deprecated; use enableChaining (mapped)",
        level: "warning",
      },
    ]);
  });

  it("alias invalid alone: repair-notify naming enablePhrases, defaults unchanged", () => {
    writeUserConfig({ enablePhrases: "yes" });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enableChaining).toBe(true);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("enablePhrases");
    expect(h.warnings[0]!.msg).toContain(userPath());
  });

  it("valid alias + invalid primary in one layer: alias applies, primary repair-notifies against the kept (alias) value", () => {
    writeUserConfig({ enablePhrases: false, enableChaining: "nope" });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enableChaining).toBe(false); // alias-resolved value kept
    expect(h.warnings).toHaveLength(2);
    expect(h.warnings[0]!.msg).toBe(
      "hapax: enablePhrases is deprecated; use enableChaining (mapped)",
    );
    expect(h.warnings[1]!.msg).toContain("invalid enableChaining");
    expect(h.warnings[1]!.msg).toContain("using false"); // next.enableChaining
    expect(h.warnings[1]!.msg).toContain(userPath());
  });

  it("a user-level chaining value is the repair target for a later project alias", () => {
    writeUserConfig({ enableChaining: false });
    writeProjectConfig({ enablePhrases: "yes" });
    const cfg = loadConfig(loadOpts());
    expect(cfg.enableChaining).toBe(false); // repaired to user's false
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("enablePhrases");
    expect(h.warnings[0]!.msg).toContain(projectPath());
  });

  it("deprecation notify fires per alias-using layer, never for the primary key", () => {
    writeUserConfig({ enablePhrases: false });
    writeProjectConfig({ enableChaining: false }); // primary: silent
    loadConfig(loadOpts());
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]!.msg).toContain("deprecated");
  });

  it("the transitional mirror FIELD is gone: the resolved config carries only enableChaining (P1.M3.T1.S2)", () => {
    writeUserConfig({ enableChaining: false });
    const cfg = loadConfig(loadOpts());
    expect("enablePhrases" in cfg).toBe(false);
    expect("enablePhrases" in DEFAULT_CONFIG).toBe(false);
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