import { useRef } from 'react';

/** One of a setting's choices, with its tooltip. */
export interface Choice<T> {
  readonly value: T;
  readonly label: string;
  readonly title?: string | undefined;
  /** Greyed out, the reason in its tooltip: "Selection" with nothing selected. */
  readonly disabled?: boolean;
  readonly disabledTitle?: string | undefined;
}

/**
 * A setting with a few choices, as a row of buttons: every choice in view
 * and one click to try it (item 92). A `radiogroup` of `radio` buttons, so
 * Tab walks the buttons as it does the menu's other items (#34) and the
 * arrow keys move along the row, applying as they go and wrapping at the
 * ends, stepping over a disabled choice. Disabled as a whole when the
 * setting has nothing to apply to, with the reason as the group's tooltip.
 */
export function SegmentedChoices<T extends string | number | boolean | null>({
  label,
  choices,
  value,
  disabled = false,
  disabledTitle,
  small = false,
  onChange,
}: {
  readonly label: string;
  readonly choices: readonly Choice<T>[];
  /** The chosen one; `undefined` when the setting holds a value not offered here. */
  readonly value: T | undefined;
  readonly disabled?: boolean;
  readonly disabledTitle?: string | undefined;
  /** The menu's size rather than the toolbar's. */
  readonly small?: boolean;
  readonly onChange: (value: T) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  return (
    <div
      className={`segmented${small ? ' segmented--small' : ''}`}
      role="radiogroup"
      aria-label={label}
      data-tip={disabled ? disabledTitle : undefined}
      ref={group}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        // Step from the focused button, which is the chosen one unless the
        // setting holds a typed value that no button stands for.
        const buttons = Array.from(group.current?.querySelectorAll('button') ?? []);
        const at = buttons.indexOf(e.target as HTMLButtonElement);
        const step = e.key === 'ArrowRight' ? 1 : choices.length - 1;
        const from = at < 0 ? 0 : at;
        // The next choice along that is not disabled, wrapping round.
        const to = choices
          .map((_, i) => (from + step * (i + 1)) % choices.length)
          .find((i) => choices[i]?.disabled !== true);
        const next = to === undefined ? undefined : choices[to];
        if (to === undefined || next === undefined) return;
        onChange(next.value);
        buttons[to]?.focus();
      }}
    >
      {choices.map((choice) => {
        const off = disabled || choice.disabled === true;
        return (
          <button
            key={String(choice.value)}
            type="button"
            role="radio"
            aria-checked={value === choice.value}
            className={`segmented__button${value === choice.value ? ' segmented__button--active' : ''}`}
            disabled={off}
            data-tip={disabled ? undefined : off ? choice.disabledTitle : choice.title}
            onClick={() => {
              onChange(choice.value);
            }}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
