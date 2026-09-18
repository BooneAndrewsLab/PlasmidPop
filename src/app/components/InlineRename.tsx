import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

interface Props {
  readonly value: string;
  readonly label: string;
  readonly className?: string;
  /** Called with the trimmed new name when it differs from the old one. */
  readonly onCommit: (name: string) => void;
  /** Called after committing or cancelling, so the parent can leave edit mode. */
  readonly onDone: () => void;
}

/** A text field that replaces a name in place: Enter or blur commits, Escape cancels. */
export function InlineRename({ value, label, className, onCommit, onDone }: Props) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const finish = (commit: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    const name = draft.trim();
    if (commit && name !== '' && name !== value) onCommit(name);
    onDone();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  };

  return (
    <input
      ref={inputRef}
      className={className}
      aria-label={label}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        finish(true);
      }}
    />
  );
}
