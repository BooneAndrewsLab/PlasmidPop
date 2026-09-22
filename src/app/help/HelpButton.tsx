import { useEffect, useRef, useState } from 'react';

import { isTextTarget } from '../keys';
import { HelpDialog } from './HelpDialog';
import { onOpenGuide } from './openGuide';
import './help.css';

/** The "?" at the right end of the toolbar; opens the user guide. `?` anywhere outside a text field does too. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  /** The page `openGuide` asked for; undefined is the guide from the top. */
  const [page, setPage] = useState<string | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () =>
      onOpenGuide((pageId) => {
        setPage(pageId);
        setOpen(true);
      }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      setPage(undefined);
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
          setPage(undefined);
          setOpen(true);
        }}
      >
        ?
      </button>
      {/* Keyed by the page so a second `openGuide` while the dialog is up
          opens that page rather than leaving the first one showing. */}
      {open && <HelpDialog key={page} initialPage={page} onClose={close} />}
    </>
  );
}
