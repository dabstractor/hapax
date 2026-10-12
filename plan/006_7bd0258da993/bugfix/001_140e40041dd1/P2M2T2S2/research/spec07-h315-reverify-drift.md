# Spec drift: spec/07 h3.15 — add the fifth re-verify bullet (BUG-004)

Source: P2.M2.T1.S1 (BUG-004 PIN in `src/pi/provider.ts` `applyCompletion`).
Mode A — pipeline agents must not edit `spec/*.md`; this file carries the
drafted replacement text. **P2.M2.T2.S2 (reconciling session) applies it to
`spec/07-completion-ui.md`**, section "pi-tui contract dependencies
(re-verify on upgrades)" (~lines 596–607 at drafting time).

## (a) Intro wording change

```diff
-Four runtime contracts are leaned on by the FALLBACK path (marked as
+Five runtime contracts are leaned on by the FALLBACK path (marked as
```

## (b) New fifth bullet (append to the re-verify list)

```markdown
- no autocomplete re-request after applyCompletion (all three apply
  sites in editor.js — menu-Tab accept (:545), select.confirm (:560),
  and the forced single-item fast path (:1906), verified against
  @earendil-works/pi-tui 0.84.4 — apply then cancel (the fast path:
  requestRender) and return; the fallback path's post-Tab extension
  offer and the zero-char chain offer therefore ride the NEXT
  keystroke's request, the degradation spec 07 accepts — PIN in
  src/pi/provider.ts applyCompletion);
```

## (c) Application note

Applied by P2.M2.T2.S2 only. The PIN comment in
`src/pi/provider.ts` (applyCompletion override, before the delegated
`return current.applyCompletion(...)`) is the consumption-site mirror of
this bullet and cites the same three dist sites + version + re-verify
instruction. If a pi-tui upgrade changes any of the three sites (in
particular, adds a post-apply `requestAutocomplete`), update BOTH this
bullet and the PIN — the fallback offer timing and P2.M2.T1.S2's
post-accept battery depend on it.
