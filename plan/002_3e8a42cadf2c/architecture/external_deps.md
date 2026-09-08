# pi-tui Tab / Autocomplete Contract — verified against installed packages (2026 recon)

Authoritative sources (all installed under the hapax repo / pi runtime):
- `node_modules/@earendil-works/pi-tui/dist/components/editor.js`
- `node_modules/@earendil-works/pi-tui/dist/autocomplete.js`
- `node_modules/@earendil-works/pi-tui/dist/autocomplete.d.ts`
- `node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-OMWWHBTG.js` (contains a bundled copy of the same pi-tui editor)

## 1. Tab flow in editor.js (exact quotes, with line numbers)

### 1a. handleTabCompletion (editor.js:1812–1825)

```
1812:    handleTabCompletion() {
1813:        if (!this.autocompleteProvider)
1814:            return;
1815:        const currentLine = this.state.lines[this.state.cursorLine] || "";
1816:        const beforeCursor = currentLine.slice(0, this.state.cursorCol);
1817:        if (this.isInSlashCommandContext(beforeCursor) && !beforeCursor.trimStart().includes(" ")) {
1818:            this.handleSlashCommandCompletion();
1819:        }
1820:        else {
1821:            this.forceFileAutocomplete(true);
1822:        }
1823:    }
1824:
1825:    handleSlashCommandCompletion() {
1826:        this.requestAutocomplete({ force: false, explicitTab: true });
1827:    }
```

### 1b. forceFileAutocomplete (editor.js:1827–1829)

```
1827:    forceFileAutocomplete(explicitTab = false) {
1828:        this.requestAutocomplete({ force: true, explicitTab });
1829:    }
```

Note: `handleTabCompletion()` calls `forceFileAutocomplete(true)` → options = `{force:true, explicitTab:true}`. Slash-command context instead routes to `handleSlashCommandCompletion()` with `{force:false, explicitTab:true}` — so the single-item fast path (which requires `force && explicitTab`) does NOT fire in slash context.

### 1c. requestAutocomplete + debounce (editor.js:1829–1863; debounce helper 1876–1888)

```
1829:    requestAutocomplete(options) {
1830:        if (!this.autocompleteProvider)
1831:            return;
1832:        if (options.force) {
1833:            const shouldTrigger = !this.autocompleteProvider.shouldTriggerFileCompletion ||
1834:                this.autocompleteProvider.shouldTriggerFileCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol);
1835:            if (!shouldTrigger) {
1836:                return;
1837:            }
1838:        }
...
1840:        this.cancelAutocompleteRequest();
1841:        const startToken = ++this.autocompleteStartToken;
1842:        const debounceMs = this.getAutocompleteDebounceMs(options);
1843:        if (debounceMs > 0) {
1844:            this.autocompleteDebounceTimer = setTimeout(() => {
...
1850:        void this.startAutocompleteRequest(startToken, options);
1851:    }
```

```
1876:    getAutocompleteDebounceMs(options) {
1877:        if (options.explicitTab || options.force) {
1878:            return 0;
1879:        }
1880:        const currentLine = this.state.lines[this.state.cursorLine] || "";
1881:        const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
1887:        return this.autocompleteDebouncePattern.test(textBeforeCursor) ? ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS : 0;
1888:    }
```

**Display debounce inside pi-tui:** the ONLY debounce is this 20 ms one (`ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS = 20`, editor.js:169), applied to *non-forced, non-explicitTab* requests whose text-before-cursor matches `autocompleteDebouncePattern` (built from trigger characters). Explicit Tab / forced requests bypass it entirely (debounceMs = 0). Any "display debounce" beyond this lives in the hapax provider, not pi-tui.

Important for wrapped providers: with `force:true`, `requestAutocomplete` consults `shouldTriggerFileCompletion` (if defined) and silently aborts if it returns false. A wrapped provider that does not forward/override this hook inherits the inner provider's gating.

### 1d. getSuggestions call site (editor.js:1889–1899)

```
1889:    async runAutocompleteRequest(requestId, controller, snapshotText, snapshotLine, snapshotCol, options) {
1890:        if (!this.autocompleteProvider)
1891:            return;
1892:        const suggestions = await this.autocompleteProvider.getSuggestions(this.state.lines, this.state.cursorLine, this.state.cursorCol, { signal: controller.signal, force: options.force });
1893:        if (!this.isAutocompleteRequestCurrent(requestId, controller, snapshotText, snapshotLine, snapshotCol)) {
1894:            return;
1895:        }
...
1897:        this.autocompleteAbort = undefined;
1898:        if (!suggestions || !Array.isArray(suggestions.items) || suggestions.items.length === 0) {
1899:            this.cancelAutocomplete();
1900:            this.tui.requestRender();
1901:            return;
1902:        }
```

Exact signature: `getSuggestions(this.state.lines, this.state.cursorLine, this.state.cursorCol, { signal: controller.signal, force: options.force })`.

### 1e. Single-item fast path vs menu (editor.js:1903–1920)

```
1903:        if (options.force && options.explicitTab && suggestions.items.length === 1) {
1904:            const item = suggestions.items[0];
1905:            this.pushUndoSnapshot();
1906:            this.lastAction = null;
1907:            const result = this.autocompleteProvider.applyCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol, item, suggestions.prefix);
1908:            this.state.lines = result.lines;
1909:            this.state.cursorLine = result.cursorLine;
1910:            this.setCursorCol(result.cursorCol);
1911:            if (this.onChange)
1912:                this.onChange(this.getText());
1913:            this.tui.requestRender();
1914:            return;
1915:        }
1916:        this.applyAutocompleteSuggestions(suggestions, options.force ? "force" : "regular");
1917:        this.tui.requestRender();
1918:    }
```

```
1926:    applyAutocompleteSuggestions(suggestions, state) {
1927:        this.autocompletePrefix = suggestions.prefix;
1928:        this.autocompleteList = this.createAutocompleteList(suggestions.items)   // (paraphrase of 1928)
...
1933:        this.autocompleteState = state;
1934:    }
```

So: `items.length === 1` + `force && explicitTab` → item applied immediately, no menu. `items.length > 1` with `force` → `applyAutocompleteSuggestions(suggestions, "force")` → menu in `"force"` state. (In `"force"` state, subsequent `updateAutocomplete()` re-requests with `force:true` — editor.js:1957–1958.)

## 2. How an item is APPLIED — applyCompletion (pi-tui CombinedAutocompleteProvider, autocomplete.js:265+)

The editor itself does NOT compute the replacement range — it delegates entirely to `autocompleteProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix)` (editor.js:1907 for the fast path; identical pattern in `handleInput` for Tab/Enter on a visible menu, see editor.js `handleInput` tab/confirm branches). The stock implementation:

```
265:    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
266:        const currentLine = lines[cursorLine] || "";
267:        const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
268:        const afterCursor = currentLine.slice(cursorCol);
269:        const isQuotedPrefix = prefix.startsWith('"') || prefix.startsWith('@"');
270:        const hasLeadingQuoteAfterCursor = afterCursor.startsWith('"');
271:        const hasTrailingQuoteInItem = item.value.endsWith('"');
272:        const adjustedAfterCursor = isQuotedPrefix && hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor ? afterCursor.slice(1) : afterCursor;
...
279:        const isSlashCommand = prefix.startsWith("/") && beforePrefix.trim() === "" && !prefix.slice(1).includes("/");
280:        if (isSlashCommand) {
281:            const newLine = `${beforePrefix}/${item.value} ${adjustedAfterCursor}`;
...
289:        }
290:        // Check if we're completing a file attachment (prefix starts with "@")
291:        if (prefix.startsWith("@")) {
292:            // Don't add space after directories so user can continue autocompleting
293:            const isDirectory = item.label.endsWith("/");
294:            const suffix = isDirectory ? "" : " ";
295:            const newLine = `${beforePrefix + item.value}${suffix}${adjustedAfterCursor}`;
...
303:        }
...
307:        if (textBeforeCursor.includes("/") && textBeforeCursor.includes(" ")) {
...
315:        }
316:        // For file paths, complete the path
317:        const newLine = beforePrefix + item.value + adjustedAfterCursor;
...
325:    }
```

**Replacement semantics:** `beforePrefix = currentLine.slice(0, cursorCol - prefix.length)` — the last `prefix.length` characters before the cursor are replaced by `item.value`. Cursor lands at `beforePrefix.length + cursorOffset` where `cursorOffset = item.value.length` (or `length-1` for quoted directories).

### 2a. Zero-prefix at an empty word start (cursor just after a space)

- `prefix = ""` → `cursorCol - prefix.length === cursorCol` → `beforePrefix` is the entire text before the cursor (ending in the space the user typed).
- Falls through to the plain path (line 317): `newLine = beforePrefix + item.value + afterCursor` — the value is inserted verbatim at the cursor.
- **Bare single-word value with NO leading space:** since `beforePrefix` already ends with the delimiter (space), the insertion IS word-separated: `"foo "` + `"bar"` → `"foo bar"`. No double space, no gluing.
- **A value WITH a leading space** (`" bar"`) at the same position would produce a double space (`"foo  bar"`). So for zero-prefix completion the item value must be a bare word — which is the correct/safe shape.
- Caveat: the plain path adds NO trailing space after the value (unlike `@` attachments, which append `" "` for non-directories). Chains that rely on "value + space" must not.
- Caveat 2: if `textBeforeCursor.includes("/") && textBeforeCursor.includes(" ")` (line ~307 branch), same splice occurs — behavior identical for bare words.

### 2b. How prefix is computed (word boundary)

`autocomplete.js:6` `const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);`
`findLastDelimiter` (autocomplete.js:37–43) scans backwards for the last delimiter; `extractPathPrefix(text, force)` (autocomplete.js:347–369):

```
347:    extractPathPrefix(text, forceExtract = false) {
348:        const quotedPrefix = extractQuotedPrefix(text);
349:        if (quotedPrefix) {
350:            return quotedPrefix;
351:        }
352:        const lastDelimiterIndex = findLastDelimiter(text);
353:        const pathPrefix = lastDelimiterIndex === -1 ? text : text.slice(lastDelimiterIndex + 1);
354:        // For forced extraction (Tab key), always return something
355:        if (forceExtract) {
356:            return pathPrefix;
357:        }
...
367:        if (pathPrefix === "" && text.endsWith(" ")) {
368:              return pathPrefix;
369:        }
370:        return null;
371:    }
```

Forced (Tab) extraction returns the token after the last delimiter — possibly the empty string at a word start. A *custom* hapax provider computes its own `prefix` and returns it in `AutocompleteSuggestions.prefix`; pi-tui then passes it back verbatim into `applyCompletion` (which, for a wrapped stock provider, hapax normally delegates to `current.applyCompletion`).

## 3. AutocompleteProvider type declaration (pi-tui, authoritative .d.ts)

`node_modules/@earendil-works/pi-tui/dist/autocomplete.d.ts` (lines 16–30):

```ts
export interface AutocompleteItem {
    value: string;
    label: string;
    description?: string;
}
type Awaitable<T> = T | Promise<T>;
export interface SlashCommand {
    name: string;
    description?: string;
    argumentHint?: string;
    getArgumentCompletions?(argumentPrefix: string): Awaitable<AutocompleteItem[] | null>;
}
export interface AutocompleteSuggestions {
    items: AutocompleteItem[];
    prefix: string;
}
export interface AutocompleteProvider {
    /** Characters that should naturally trigger this provider at token boundaries. */
    triggerCharacters?: string[];
    getSuggestions(lines: string[], cursorLine: number, cursorCol: number, options: {
        signal: AbortSignal;
        force?: boolean;
    }): Promise<AutocompleteSuggestions | null>;
    applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string): {
        lines: string[];
        cursorLine: number;
        cursorCol: number;
    };
    shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
}
```

`@earendil-works/pi-coding-agent` dist exposes no separate `.d.ts` for the provider; its bundled TUI (`dist/bundle/chunks/chunk-OMWWHBTG.js`) embeds a minified copy of the same editor logic (minified `handleTabCompletion`, `forceFileAutocomplete`, `runAutocompleteRequest` with the identical `options.force&&options.explicitTab&&suggestions.items.length===1` fast path and the same `{signal:controller.signal, force:options.force}` call) — behavior matches the readable pi-tui dist. The interface must be imported from `@earendil-works/pi-tui`.

## 4. plan/001_88fc3a66fd74/architecture/ — file list & summaries

Files: `core_contracts.md`, `external_deps.md`, `pi_extension_api.md`, `system_context.md`.

### pi_extension_api.md (116 lines)
- Provider contract (§1, quoted above in plan doc): `AutocompleteProvider` with async `getSuggestions(lines, line, col, {signal, force}) : Promise<AutocompleteSuggestions|null>`; sync `applyCompletion(lines,line,col,item,prefix)`. Corrections vs PRD: async return, `{items, prefix}` shape, `prefix` includes trigger char in trigger mode (`"#ze"`), bare fragment in threshold mode.
- Delegation rule: when hapax doesn't match, `return current.getSuggestions(lines, line, col, options)` unchanged — keeps path/slash completion intact; also delegate `applyCompletion` to `current` (per github-issue-autocomplete.ts example).
- Events on `pi` object: `message_end`, `session_start` (reasons startup/reload/new/resume/fork), `session_shutdown`, `before_agent_start` (M2 chain reset).
- Message shapes: tool calls are `type === "toolCall"`; skip thinking/toolResult; ingest text blocks only.
- UI: `ctx.ui.notify(msg, "warning"|"info"|"error")` (no "warn"); `registerCommand`; guard `ctx.mode !== "tui"`.
- No disposal handle for `addAutocompleteProvider`; re-register each `session_start`.

### core_contracts.md
- Build chain: types → dictionary → segment → shapeGate → score → store → query (`src/core/`) → config/ingest/provider/index (`src/pi/`).
- Provider emission contract (#5): provider returns own `{items,prefix}`, the previous displayed set within a **100 ms display-debounce window** (hapax-side, NOT pi-tui), or delegates to `current`.
- Prefix rule: trigger mode prefix = `"#"+fragment`; threshold mode = bare fragment.
- M2: phrase layer, successor index, and a **chain state machine** `armed(W)` reset on `before_agent_start`.
- Ordinal counter in store; sighting shape; dictionary is the only commonness touchpoint.

### external_deps.md
- Zero runtime deps. devDeps: `@earendil-works/pi-coding-agent ~0.84.4`, `@earendil-works/pi-tui` matching, typescript, vitest.
- `src/core/**` imports nothing from pi packages; `src/pi/**` type-only imports. jiti 2.7.0 transpile at load.

### system_context.md
- Greenfield repo; pi v0.84.4 installed; `pi --check` doesn't exist (use `tsc --noEmit` + vitest); pi source repo at `/home/dustin/projects/pi` with example `github-issue-autocomplete.ts` (reference wrapper implementation).
- Nothing specifically about forced requests or leading-space values beyond the above; the display debounce referenced anywhere is the 100 ms hapax-side one, contrasted here with pi-tui's 20 ms non-forced debounce.

## 5. Findings vs PRD trace

(a) **CONFIRMED**: single-item fast path exists exactly at editor.js:1903 — `options.force && options.explicitTab && suggestions.items.length === 1` → `applyCompletion` applied immediately; `items.length > 1` → `applyAutocompleteSuggestions(suggestions, "force")` opens menu in `"force"` state (line 1916). Reachable via Tab → `handleTabCompletion` → `forceFileAutocomplete(true)` → `requestAutocomplete({force:true, explicitTab:true})`. Caveat: Tab in a slash-command context (line start, `/…`, no space) routes to the non-forced `handleSlashCommandCompletion` instead — the fast path can't fire there.

(b) **CONFIRMED safe**: at a word start with `prefix=""`, `applyCompletion` splices `item.value` verbatim at the cursor; since the text before the cursor already ends with the delimiter, a bare value with NO leading space inserts correctly word-separated (`"foo " + "bar"`). A leading-space value would double-space. Also: no trailing space is added on the plain path.

(c) **Contradictions/nuances**: pi-tui's only debounce is 20 ms, non-forced, trigger-char-pattern-based (editor.js:169, 1876–1888) — any "100 ms display debounce" in the plan is hapax-side, not pi-tui. Also note `shouldTriggerFileCompletion` gating on forced requests (editor.js:1832–1838): a wrapper that doesn't forward this hook inherits the inner provider's gating for Tab-forced requests.