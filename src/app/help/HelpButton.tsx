import { useEffect, useRef, useState } from 'react';

import { HelpDialog } from './HelpDialog';
import './help.css';

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    target.closest('[role="textbox"]') !== null
  );
}

/** The "?" at the right end of the toolbar; opens the user guide. `?` anywhere outside a text field does too. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="help-button"
        aria-label="Help"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Open the guide (?)"
        onClick={() => {
          setOpen(true);
        }}
      >
        ?
      </button>
      {open && <HelpDialog onClose={close} />}
    </>
  );
}
