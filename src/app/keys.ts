/**
 * Whether a key event is going somewhere text is being typed, where an
 * app-wide shortcut has no business firing.
 */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    target.closest('[role="textbox"]') !== null
  );
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
