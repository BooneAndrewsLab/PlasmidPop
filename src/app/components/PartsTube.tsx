import { type Ingredient } from './tube';

/**
 * Everything a one-pot reaction could use, with a tick against each.
 *
 * Both sources are one list rather than a choice between them, because a
 * real assembly mixes them: a backbone cut out of a plasmid joined to an
 * insert amplified from somewhere else. Everything starts in the tube, so
 * the ticks are a way of leaving something out rather than of choosing.
 */
export function PartsTube({
  ingredients,
  excluded,
  onToggle,
  label,
}: {
  readonly ingredients: readonly Ingredient[];
  readonly excluded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly label: string;
}) {
  return (
    <ul className="gg__parts" aria-label={label}>
      {ingredients.map((i) => (
        <li key={i.id} className="gg__part">
          <label className="toggle">
            <input
              type="checkbox"
              checked={!excluded.has(i.id)}
              onChange={() => {
                onToggle(i.id);
              }}
            />
            <span className="gg__name">{i.document.name}</span>
          </label>
          {/* Outside the label, so the tick box is named by the part alone
              and a test (or a screen reader) asks for it by name. */}
          <span className="gg__detail">{i.detail}</span>
        </li>
      ))}
    </ul>
  );
}
