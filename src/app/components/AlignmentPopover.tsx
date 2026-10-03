import { type ReactNode, useId, useLayoutEffect, useRef } from 'react';

interface Props {
  /** The heading, which is also the group's accessible name. */
  readonly title: string;
  /** The close button's accessible name, as "Close search". */
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** A modifier class, as `astack-pop--find`, for the popover's width. */
  readonly className: string;
  readonly children: ReactNode;
}

/**
 * The frame the large view's toolbar popovers share (Go to, Find, Export,
 * Samples): a heading with the close button at its end, then the form. It
 * hangs from its button's left edge, and is pushed back left by as much as
 * it would pass the window's right edge, so a button near the end of a
 * narrow toolbar does not put its form off screen.
 */
export function AlignmentPopover({ title, closeLabel, onClose, className, children }: Props) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const fit = (): void => {
      el.style.translate = '';
      const margin = 16;
      const right = el.getBoundingClientRect().right;
      const over = right - (document.documentElement.clientWidth - margin);
      if (over > 0) el.style.translate = `${-Math.ceil(over)}px 0`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
    };
  }, []);

  return (
    <div ref={box} className={`astack-pop ${className}`} role="group" aria-labelledby={id}>
      <div className="astack-pop__head">
        <span id={id} className="astack-pop__title">
          {title}
        </span>
        <button
          type="button"
          className="button button--quiet astack-pop__close"
          aria-label={closeLabel}
          title="Close (Esc)"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}
