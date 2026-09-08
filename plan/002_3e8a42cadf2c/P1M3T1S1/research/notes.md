# Research notes — plan 002 P1.M3.T1.S1 (config: enableChaining primary key + enablePhrases alias)

## Verified codebase state
- `src/pi/config.ts` (module header documents layer merge/repair semantics):
  - `HapaxConfig` interface at L36–45: triggerChar, threshold, maxSuggestions,
    **enablePhrases: boolean**, debug.
  - `DEFAULT_CONFIG` L47–53: `enablePhrases: true`.
  - `applyLayer(current, raw, filePath, notify)` L~153–224: per-key `if ("k" in raw)`
    blocks; booleans accept only `typeof v === "boolean"`, else repair-notify
    `hapax: invalid <field> in <path>, using <prev>` at level "warning".
    `enablePhrases` block sits at L197–208. Message uses `formatValue(current.x)`.
  - `loadConfig` returns a fresh copy (`{...current}` per layer) — fresh-copy
    semantics already hold; test at config.test.ts:99 pins it.
  - Module is node-builtin-pure (fs/os/path only).
- `test/config.test.ts`: fixture helpers `writeUserConfig`/`writeProjectConfig`
  (mkdtemp home/cwd, warnings array via injected notify), `loadOpts(over)`.
  Boolean cases around L311 ('enablePhrases "yes" repairs…'). Default-object
  literal assertions at L91/L124 include `enablePhrases`.
- Consumers of `config.enablePhrases` today (all re-pointed by S2, NOT this task):
  `src/pi/index.ts:180` (onAdmittedTokens spread gate; comment at L175–179
  explicitly says "P1.M3.T1.S2 re-points this gate to enableChaining"),
  `src/pi/provider.ts:261,398`.
  ⚠️ If this task simply RENAMES the field, index.ts/provider.ts break compilation.
  Options: (a) keep field name change + let S2 fix reads — breaks `npm run check`
    in between; (b) ADD `enableChaining` as primary AND keep `enablePhrases`
    field populated (same resolved value) so old reads keep compiling until S2
    removes them. Chosen: **(b)** — HapaxConfig carries BOTH fields after this
    task; both always hold the SAME resolved value; S2 removes `enablePhrases`
    entirely. This keeps every intermediate commit green.
- `README.md` Configuration table (L304–316) has an `enablePhrases` row to
  replace with `enableChaining` + alias note. Also L15, L118, L369 mention
  enablePhrases in prose — per item description only the TABLE ROW rides here
  (R5); the M4.T2 documentation sweep handles prose. Minimal: update the table
  row; leave prose for the later sweep (note in PRP).
- PRD §08 h2.46 (current): schema has `enableChaining: true` with
  `enablePhrases` as deprecated alias; word completion unaffected either way.
- PRD §01 h2.1 invariants: unchanged by config work.
- Previous parallel item P1.M2.T2.S2 touches provider.ts only — no overlap.

## Alias semantics (pinned by the work item)
- Resolve per-layer INSIDE applyLayer: read `enablePhrases` first (validated
  boolean → apply), then `enableChaining` (validated boolean → overrides).
  In-layer both present → enableChaining wins. Cross-layer: later layer's
  enableChaining overrides earlier alias; later layer's alias also overrides
  earlier enableChaining (ordinary later-wins rule applied to the resolved
  value) — this falls out of sequential per-layer resolution.
- Invalid alias value → repair-notify naming enablePhrases (existing shape).
  Invalid enableChaining → repair-notify naming enableChaining.
- One-time deprecation notify when ONLY the alias key is present (in that
  layer), via the existing notify shape:
  `hapax: enablePhrases is deprecated; use enableChaining (mapped)` level warning.
- DEFAULT_CONFIG: enableChaining: true; enablePhrases mirror: true.