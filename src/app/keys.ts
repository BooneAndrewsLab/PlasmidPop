/** Whether a key event is going to a form field, which takes every key it is given. */
function isFieldTarget(target: HTMLElement): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * Whether a key event is going somewhere text is being typed, where an
 * app-wide shortcut has no business firing: a form field, or the sequence
 * view, where a bare key types a base.
 */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isFieldTarget(target) || target.closest('[role="textbox"]') !== null;
}

/**
 * Whether an `Alt` binding should stand down for this event: only in a form
 * field, where `Alt` and a key can type a character (on macOS it composes).
 * The sequence view types nothing on `Alt`, and it is where the work is done,
 * so the `Alt` bindings (item 32) work there — which is what `Alt` was
 * chosen for. Until 1.5 they were refused there along with the fields.
 */
export function isAltBlocked(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && isFieldTarget(target);
}

/**
 * Whether the event is `Alt` and nothing else with the given physical key
 * (`KeyC`, `Digit1`). The code rather than the character because on macOS
 * `Alt` composes — `Alt+C` arrives as `ç` — and a shortcut that works on one
 * keyboard and not another is worse than none.
 */
export function isAltKey(e: KeyboardEvent, code: string): boolean {
  return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === code;
}
