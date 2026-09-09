/**
 * M1 DoD persistence assertion (P1.M4.T2.S2) — PRD §09: "no persistence
 * files written anywhere (assert store dir untouched)".
 *
 * This is a FILESYSTEM assertion, not a source-grep: the full real pipeline
 * (shipped dictionary load → fixture restore replay → live message_end
 * ingest → query/match-state/provider) runs to completion, and afterwards a
 * `find <root> -newer <marker> -type f` snapshot of three roots must show
 * ZERO hapax-written files:
 *
 *   1. the tmp working dir (includes a fresh fake pi config home + project
 *      dir whose hapax.json files were written BEFORE the marker — the
 *      config layer must READ them and write nothing back), and
 *   2. the repository tree (node_modules/.git/plan pruned — deps, VCS, and
 *      the orchestrator-owned plan/ dir are not hapax's runtime surface),
 *   3. the real ~/.pi/agent dir, filtered to hapax-named paths
 *      (/hapax|common-en|acwords/i — deterministic by design: hapax
 *      defines no writers, so any artifact it ever wrote would carry its
 *      name; pi's own concurrent session logs must not flake this suite,
 *      and per RESULTS.md hygiene they are pi's files, not hapax's).
 *
 * jiti's transpile cache and node_modules/.cache are infra writes, excluded
 * per the PRP (node_modules traversal is pruned; the name filters remain as
 * belt-and-braces for out-of-tree cache locations).
 *
 * Follows test/acceptance.test.ts's real-module discipline: no
 * re-implemented ingestion, no mocks of the code under test — the only
 * mock is the wrapped AutocompleteProvider (the delegation target).
 * The working dir is never process.chdir'd (vitest workers share the
 * process; other suites use relative fixture paths) — absolute paths only.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { loadDictionary } from "../src/core/dictionary.js";
import { rankMatches } from "../src/core/query.js";
import { CandidateStore } from "../src/core/store.js";
import type { Dictionary } from "../src/core/types.js";
import { DEFAULT_CONFIG, loadConfig } from "../src/pi/config.js";
import {
  extractText,
  IngestPipeline,
  restoreFromHistory,
  type AgentMessage,
  type RestoreSessionManager,
} from "../src/pi/ingest.js";
import { resolveDictPath } from "../src/pi/paths.js";
import {
  createHapaxProvider,
  extractMatchState,
} from "../src/pi/provider.js";
import {
  asSessionManager,
  messageEntriesOf,
  parseSessionFixture,
} from "./helpers/session-fixture.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURE = join(REPO_ROOT, "test/fixtures/sessions/zendesk-lwlock.jsonl");

/** Any hapax-originated artifact would carry one of these names (config
 *  file, shipped dict, /acwords debug dump). Case-insensitive on purpose. */
const HAPAX_NAME = /hapax|common-en|acwords/i;

/** Infra cache writes that are NEVER hapax's (PRP: exclude jiti, .cache). */
const INFRA_PATH = /[/\\]jiti[/\\]|[/\\]node_modules[/\\]\.cache[/\\]/;

let workDir = "";
let marker = "";
let fakeHome = "";
let fakeProject = "";

/** Snapshot: every regular file under root strictly newer than the marker. */
function newerThan(root: string): string[] {
  const out = execFileSync(
    "find",
    [
      root,
      "(", // prune dependency/VCS/orchestrator trees from TRAVERSAL —
      "-name", "node_modules", // deps (vitest/vite/jiti caches live here)
      "-o", "-name", ".git", // VCS internals
      "-o", "-name", "plan", // orchestrator-owned; not a hapax surface
      ")", "-prune", "-o",
      "-type", "f",
      "-newer", marker,
      "-print",
    ],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => f !== marker && !INFRA_PATH.test(f));
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "hapax-no-persist-"));

  // Fresh fake pi config layout: user-global (<home>/.pi/agent/hapax.json)
  // and project-local (<project>/.pi/hapax.json) fixture files, written
  // BEFORE the marker so the post-run scan can only flag hapax's own writes,
  // never this setup. Backdating both files (and, below, the marker itself)
  // makes that ordering explicit even on coarse-mtime filesystems.
  fakeHome = join(workDir, "pi-config-home");
  fakeProject = join(workDir, "pi-config-project");
  const userCfg = join(fakeHome, ".pi", "agent");
  const projCfg = join(fakeProject, ".pi");
  mkdirSync(userCfg, { recursive: true });
  mkdirSync(projCfg, { recursive: true });
  const cfgTime = new Date(Date.now() - 10_000);
  writeFileSync(join(userCfg, "hapax.json"), JSON.stringify({ threshold: 2 }));
  writeFileSync(join(projCfg, "hapax.json"), JSON.stringify({ debug: true }));
  utimesSync(join(userCfg, "hapax.json"), cfgTime, cfgTime);
  utimesSync(join(projCfg, "hapax.json"), cfgTime, cfgTime);

  // The tripwire marker: stamped at CREATION time (now), never backdated.
  // The old 5 s backdate widened the scan window to [now − 5 s, scan] — a
  // window that includes PRE-EXERCISE time in which any external writer (a
  // validator writing its report files, an editor, git gc) gets
  // misattributed to hapax: a false positive indistinguishable from a real
  // leak, and one the surrounding pipeline had to work around by backdating
  // its own artifacts before running this suite. The window is exactly the
  // exercise: every hapax write can only happen after this beforeAll runs,
  // i.e. at or after the marker's mtime, and `find -newer` compares full
  // sub-second timestamps on modern filesystems (ext4/tmpfs/APFS), so no
  // coarse-mtime widening margin is needed. The config fixtures above keep
  // their explicit 10 s-in-the-past stamps — setup writes of THIS test
  // must order strictly before the marker at any FS granularity.
  marker = join(workDir, "marker");
  writeFileSync(marker, "");

  // pi's own config-dir redirect, mirrored in-process by loadConfig's
  // homeDir injection below (hapax resolves its config under
  // <home>/.pi/agent/hapax.json — this env var is the pi-level equivalent).
  process.env.PI_CONFIG_DIR = fakeHome;
});

afterAll(() => {
  delete process.env.PI_CONFIG_DIR;
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("M1 DoD: no persistence", () => {
  /**
   * The full real cycle, in one beforeAll so every scan below asserts the
   * SAME post-run state. Assertions inside prove the exercise was real (a
   * silently no-op pipeline would make the filesystem scans vacuous).
   */
  let store: CandidateStore;
  let pipeline: IngestPipeline;
  let dictionary: Dictionary;
  let effectiveThreshold: number;

  beforeAll(async () => {
    // 1. Config layer: READS both hapax.json fixture layers, writes nothing.
    const warnings: string[] = [];
    const config = loadConfig({
      cwd: fakeProject,
      projectTrusted: true,
      notify: (msg) => warnings.push(msg),
      homeDir: fakeHome,
    });
    effectiveThreshold = config.threshold;
    expect(effectiveThreshold).toBe(2); // user layer really parsed
    expect(warnings).toEqual([]); // clean reads, no repairs

    // 2. Shipped dictionary: load = READ of dict/common-en.bin.
    dictionary = loadDictionary(resolveDictPath());

    // 3. Fixture restore replay through the REAL pipeline (acceptance
    //    pattern: restoreFromHistory drives processText; completion is
    //    observed by counting exactly the messages restore will replay).
    const entries = parseSessionFixture(FIXTURE);
    store = new CandidateStore();
    pipeline = new IngestPipeline({ store, dictionary });
    const total = messageEntriesOf(entries).filter(
      (e) =>
        e.message !== undefined &&
        extractText(e.message as unknown as AgentMessage) !== null,
    ).length;
    const real = pipeline.processText.bind(pipeline);
    let done = 0;
    let resolveReplay!: () => void;
    const finished = new Promise<void>((r) => {
      resolveReplay = r;
    });
    restoreFromHistory(
      {
        processText: async (text, fromUser) => {
          await real(text, fromUser);
          if (++done === total) resolveReplay();
        },
      },
      asSessionManager(entries) as unknown as RestoreSessionManager,
    );
    await finished;

    // 4. Live-path ingest: message_end → debounced drain → flush.
    pipeline.onMessageEnd({
      role: "user",
      content: "follow-up: the lwlock contention and the Zendesk SLA breach",
      timestamp: 0,
    } as AgentMessage);
    await pipeline.flush();

    // 5. Queries + provider, both match modes, both delegate/hapax paths.
    expect(store.size).toBeGreaterThan(0); // the exercise ingested for real
    expect(extractMatchState(["ze"], 0, 2, { ...DEFAULT_CONFIG })).toEqual({
      mode: "threshold",
      fragment: "ze",
      prefix: "ze",
    });
    expect(rankMatches(store, "ze")[0]!.display).toBe("Zendesk");
    expect(extractMatchState(["#l"], 0, 2, { ...DEFAULT_CONFIG })).toEqual({
      mode: "trigger",
      fragment: "l",
      prefix: "#l",
    });
    expect(rankMatches(store, "l")[0]!.display).toBe("lwlock"); // "logs" guard-rejected (stem log=67)

    const delegate = {
      getSuggestions: vi.fn(async () => null),
      applyCompletion: vi.fn(
        (lines: string[], cursorLine: number, cursorCol: number) => ({
          lines,
          cursorLine,
          cursorCol,
        }),
      ),
    };
    const provider = createHapaxProvider(
      store,
      { ...DEFAULT_CONFIG },
      delegate as never,
    );
    const hapaxHit = await provider.getSuggestions(
      ["ze"],
      0,
      2,
      { signal: new AbortController().signal },
    );
    expect(hapaxHit).not.toBeNull(); // hapax answered from memory
    const delegated = await provider.getSuggestions(
      ["of"],
      0,
      2,
      { signal: new AbortController().signal },
    );
    expect(delegated).toBeNull(); // delegate answered; args passed through
    expect(delegate.getSuggestions).toHaveBeenCalled();
  });

  it("writes nothing into the working dir (store/dict/config stay read-only)", () => {
    const leaked = newerThan(workDir);
    expect(leaked).toEqual([]);
  });

  it("writes nothing into the repository tree", () => {
    const leaked = newerThan(REPO_ROOT);
    expect(leaked).toEqual([]);
  });

  it("leaves no hapax-named artifact in the real ~/.pi/agent dir", () => {
    const agentDir = join(homedir(), ".pi", "agent");
    if (!existsSync(agentDir)) return; // nothing to assert on this machine
    // PRP whitelist: pi's own transcript store (~/.pi/agent/sessions/) is
    // PI's, not hapax's — and its cwd-slug subdir names embed THIS repo's
    // directory name ("hapax"), so it must be excluded before the name
    // filter, or pi's live session logging fails the scan on name alone.
    const hapaxWrites = newerThan(agentDir)
      .filter((f) => !/[/\\]sessions[/\\]/.test(f))
      .filter((f) => HAPAX_NAME.test(f));
    expect(hapaxWrites).toEqual([]);
  });
});