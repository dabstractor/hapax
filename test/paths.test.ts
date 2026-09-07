/**
 * Dictionary path resolution suite (P1.M3.T5.S2): src/pi/paths.ts resolves
 * the packed dictionary jiti-safely via the dual
 * __dirname / import.meta.url pattern.
 *
 * COVERAGE NOTE: vitest executes this suite as native ESM, so these tests
 * exercise the `import.meta.url` branch (typeof __dirname === "undefined"
 * here). The jiti branch (pi transpiles TS→CJS and defines __dirname) is
 * exercised by the real `pi -e <repo>` dev load — see README "Development"
 * — because no unit harness can make jiti define __dirname.
 *
 * The HAPAX_DICT override is part of the seam contract inherited from
 * P1.M3.T5.S1 (it is also how test/index.test.ts isolates the factory
 * from the real shipped artifact).
 */

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDictPath } from "../src/pi/paths.js";

describe("resolveDictPath", () => {
  it("targets the shipped packed dictionary", () => {
    expect(resolveDictPath().replace(/\\/g, "/")).toMatch(
      /dict\/common-en\.bin$/,
    );
  });

  it("resolves from this file's real location: two dirs up is the repo root", () => {
    const resolved = path.dirname(path.dirname(resolveDictPath()));
    // realpath: both sides canonicalized so macOS /tmp symlinks etc.
    // cannot produce false failures.
    expect(realpathSync(resolved)).toBe(realpathSync(process.cwd()));
  });

  it("points at an existing file (the committed artifact is load-bearing)", () => {
    expect(existsSync(resolveDictPath())).toBe(true);
  });

  it("the HAPAX_DICT override wins over the shipped path", () => {
    const previous = process.env.HAPAX_DICT;
    process.env.HAPAX_DICT = "/custom/hapx.bin";
    try {
      expect(resolveDictPath()).toBe("/custom/hapx.bin");
    } finally {
      if (previous === undefined) delete process.env.HAPAX_DICT;
      else process.env.HAPAX_DICT = previous;
    }
  });
});