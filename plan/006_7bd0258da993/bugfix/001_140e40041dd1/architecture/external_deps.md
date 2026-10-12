# External dependencies — pi-tui contract (the only runtime dep touched by this changeset)

## @earendil-works/pi-tui (~0.84.4 per provider.ts:327-328's own PIN)
Verified against `node_modules/@earendil-works/pi-tui/dist/components/editor.js` (current install):

1. **No re-request after applyCompletion** (BUG-004's contract):
   - Menu-accept Tab site ≈:538-552 — `applyCompletion(...)` then `cancelAutocomplete()` then
     `return`; NO `requestAutocomplete`.
   - Forced single-item fast path ≈:1895-1906 (`options.force && options.explicitTab &&
     items.length === 1`) — `applyCompletion(...)` then `requestRender()` then `return`; NO
     `cancelAutocomplete` (no menu open) and NO `requestAutocomplete`.
   - Consequence (spec 07 fallback paragraph's own conditional): the fallback path degrades to no
     extension re-offer at the apply itself; offers surface on the NEXT keystroke-driven request.
     A pi-tui upgrade adding a post-apply re-request would change fallback-path behavior → the new
     PIN in provider.ts + the h3.15 re-verify-list drift bullet exist to catch this.
2. **Single-item forced fast path applies without opening a menu** — already pinned at
   provider.ts:≈313-331; style template for the new PIN.
3. Confirmed install version before writing the PIN: check `node_modules/@earendil-works/pi-tui/package.json`
   (or lockfile) so the comment cites the right version.

No other external dependencies are touched: dictionary format, config surface, and the pi extension
API are unchanged by all four fixes. No network, no persistence (RAM-only invariant holds).
