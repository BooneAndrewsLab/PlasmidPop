/**
 * What could make a one-pot reaction give something besides the product
 * shown (#11, #12): the design assembles, and these are the risks a designer
 * would check before ordering. Nothing when there are none.
 */
export function AssemblyWarnings({ texts }: { readonly texts: readonly string[] }) {
  if (texts.length === 0) return null;
  return (
    <>
      <p className="panel__note panel__note--warn">
        The parts assemble, but the tube may also give something else:
      </p>
      <ul className="panel__warnings" aria-label="Assembly warnings">
        {texts.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </>
  );
}
