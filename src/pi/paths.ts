/**
 * jiti-safe filesystem path resolution (P1.M3.T5.S2).
 *
 * pi loads the hapax extension through jiti 2.7.0, which transpiles
 * TypeScript to CommonJS — under CJS `import.meta` does not exist, so an
 * `import.meta.url`-only resolution silently breaks (or resolves wrong) in
 * the real extension host. Native ESM hosts (vitest, a future native-ESM
 * pi) are the mirror problem: `__dirname` is not defined there. The
 * shipped dictionary is therefore resolved with the dual pattern below,
 * which behaves identically under BOTH loaders:
 *
 *   here = typeof __dirname !== "undefined"
 *     ? __dirname                                  // jiti-CJS (pi -e)
 *     : path.dirname(fileURLToPath(import.meta.url)); // native ESM (vitest)
 *
 * `here` is this file's directory = <repo>/src/pi, so two ".." hops reach
 * the package root's dict/ directory. Never "simplify" to
 * `import.meta.url` only — jiti will break it (PRD §02, verified against
 * pi 0.84.x's extension loader).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/** `__dirname` is undeclared in ESM TypeScript under "type": "module". */
declare const __dirname: string | undefined;

/**
 * Resolve the packed dictionary path (the single seam S1 marked
 * PROVISIONAL; jiti-safe resolution landed in P1.M3.T5.S2).
 *
 * Order: the HAPAX_DICT environment override (also the test seam), then
 * the shipped packed dictionary resolved against THIS file's real
 * location: src/pi/paths.ts → ../../dict/common-en.bin. No fs access
 * here — the path is only RESOLVED; the file is read lazily on the first
 * lookup (createLazyDictionary), so a missing artifact degrades via the
 * factory's disable path, never at load time.
 */
export function resolveDictPath(): string {
  const override = process.env.HAPAX_DICT;
  if (override !== undefined && override !== "") return override;
  const here = typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..", "dict", "common-en.bin");
}