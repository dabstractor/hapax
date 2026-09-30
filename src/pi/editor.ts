/**
 * Enter-submits-while-autocompleting guard (2026-09; v2 after the
 * recursion crash).
 *
 * pi-tui's editor.handleInput consumes the submit key (Enter) while ANY
 * autocomplete menu is open: the autocomplete branch accepts the
 * highlighted item and RETURNS before the `tui.input.submit` branch can
 * run. For slash menus that is deliberate — the branch falls through to
 * submit after accepting ("select command, run it"). For word menus it
 * is a footgun: menus auto-open on typing (provider.ts identifier
 * triggers), so finishing a word that prefixes a candidate and pressing
 * Enter to send INSERTS the candidate instead of submitting. That
 * behavior is disqualifying for this extension: Enter must submit.
 *
 * This module restores the shell convention (fish, zsh): the completion
 * menu is advisory, Tab is the accept key, Enter ALWAYS submits.
 *
 * MECHANISM (v2 — proxy composition, NEVER instance mutation). v1
 * monkey-patched `handleInput` on the constructed editor instance and
 * CRASHED pi with infinite recursion (RangeError) alongside split-
 * editor: sibling wrappers forward keystrokes with DYNAMIC reads
 * (`this.inner.handleInput?.(data)`), so a mutated own-property cycles
 * patched → captured-forwarder → dynamic read → patched → … v2 follows
 * split-editor's proven composition instead: build the inner editor
 * from the captured factory UNTOUCHED, then return a Proxy that
 * forwards every member (get/set/has, functions bound to inner) except
 * `handleInput`, which runs our guard first — when the submit key
 * arrives while a non-slash menu is open, cancel the menu BEFORE
 * delegating, so the inner editor's own handleInput flows to its submit
 * branch exactly as if no menu had existed. The inner instance is never
 * written to; nothing can re-enter the proxy (nobody else holds it);
 * recursion is impossible by construction. Slash menus keep pi's stock
 * accept-and-submit.
 *
 * Failure model: the guard body is fully defensive (optional chaining,
 * try/catch). A missing method, a renamed field, or a throw leaves
 * behavior exactly stock — worst case the guard is inert, never broken.
 */

/** Structural view of an editor for the guard — duck-typed on purpose:
 *  the real class belongs to whoever built it (pi-vim's ModalEditor,
 *  split-editor's proxy, the stock CustomEditor, …). Only the members
 *  the guard touches are named; forwarding uses the index signature. */
export interface EditorLike {
  handleInput: (data: string) => unknown;
  [key: string]: unknown;
}

/** Minimal structural type of the KeybindingsManager injected into
 *  editor factories. Only `matches` is used. */
export interface KeybindingsLike {
  matches?: (data: string, action: string) => boolean;
}

/** Marker so repeated session_start wiring never double-wraps a
 *  factory that is already ours (reload cycles re-run the handler). */
const WRAPPED = Symbol("hapax.enterSubmitWrapped");

/** Is `data` the configured submit key? Uses the injected keybinding
 *  manager when available; raw "\r" (pi's default) otherwise. Never
 *  throws. EXPORTED for the widget key layer (P1.M3.T3.S2): its
 *  dismiss-then-forward Enter branch reuses the exact same submit test
 *  so custom keybindings work identically on both layers — the guard
 *  is never re-implemented, only composed with. */
export const isSubmitKey = (data: string, keybindings?: KeybindingsLike): boolean => {
  try {
    if (typeof keybindings?.matches === "function") {
      return keybindings.matches(data, "tui.input.submit");
    }
  } catch {
    /* fall through to the raw fallback */
  }
  return data === "\r";
};

/**
 * Build the Enter-submits proxy around one constructed inner editor.
 * The inner instance is NEVER mutated; the proxy owns exactly one
 * member — `handleInput` — and forwards everything else (get AND set
 * AND has, functions bound to inner) so the app and sibling extensions
 * observe the inner editor's full behavior. `then` is explicitly
 * undefined so the proxy can never be mistaken for a thenable.
 *
 * The guard: submit key + open menu + non-slash prefix → cancel the
 * menu (NOT accept it) before delegating; the inner handleInput then
 * routes that same keystroke to its own submit branch. Everything else
 * — Enter with no menu, slash menus, Tab, arrows, Esc, plain text —
 * reaches the inner editor untouched.
 *
 * `onKeystroke` (2026-09 menuDelayMs fix): invoked for EVERY input event
 * before delegation — the editor is the only seam that sees every
 * keystroke (a closed autocomplete menu yields one getSuggestions call
 * per WORD, which is useless for inter-keystroke timing). index.ts feeds
 * it the shared input clock the display layer's hesitation gate reads.
 * Optional; absent = no clock.
 */
export function createEnterSubmitEditor<T extends object>(
  inner: T,
  keybindings?: KeybindingsLike,
  onKeystroke?: () => void,
): T {
  const innerAny = inner as unknown as EditorLike;
  const handleInput = (data: string): unknown => {
    try {
      onKeystroke?.();
    } catch {
      /* clock failures must never break input */
    }
    try {
      if (
        isSubmitKey(data, keybindings) &&
        (innerAny.isShowingAutocomplete as (() => boolean) | undefined)?.() === true &&
        !String(innerAny.autocompletePrefix ?? "").startsWith("/")
      ) {
        // Close the menu, NOT accept: the inner editor then submits.
        (innerAny.cancelAutocomplete as (() => void) | undefined)?.();
      }
    } catch {
      /* never break input on a guard hiccup */
    }
    return innerAny.handleInput?.(data);
  };

  const innerRecord = inner as unknown as Record<PropertyKey, unknown>;
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === "then") return undefined; // never a thenable
      if (prop === "handleInput") return handleInput;
      const value = innerRecord[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(inner) : value;
    },
    set(_target, prop, value) {
      innerRecord[prop] = value;
      return true;
    },
    has(_target, prop) {
      return prop in innerRecord;
    },
  });
}

/**
 * Wrap an editor factory so every editor it builds gets the
 * Enter-submits guard (createEnterSubmitEditor above). The inner
 * factory receives its arguments verbatim; its instance is used
 * verbatim as the proxy's inner — never patched, never rebuilt.
 * Argument types are `any` on purpose: the wrapper is transparent to
 * whatever factory signature it composes with.
 */
export function wrapEditorFactory<T extends object = object>(
  inner: (tui: any, theme: any, keybindings?: any) => T,
  onKeystroke?: () => void,
): (tui: any, theme: any, keybindings?: any) => T {
  const wrapped = (tui: any, theme: any, keybindings?: any): T =>
    createEnterSubmitEditor(inner(tui, theme, keybindings), keybindings, onKeystroke);
  (wrapped as { [WRAPPED]?: boolean })[WRAPPED] = true;
  return wrapped;
}

/** True when the factory is already a hapax Enter-submits wrapper
 *  (prevents stacking on repeated session_start runs). */
export function isEnterSubmitWrapper(
  factory: unknown,
): factory is ReturnType<typeof wrapEditorFactory> {
  return (
    typeof factory === "function" &&
    (factory as { [WRAPPED]?: boolean })[WRAPPED] === true
  );
}
