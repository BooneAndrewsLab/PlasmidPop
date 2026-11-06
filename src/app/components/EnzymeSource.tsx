import { useEditorState } from '../state/useEditorStore';
import { CustomEnzymeForm } from './CustomEnzymeForm';
import { EnzymeImport } from './EnzymeImport';

/**
 * The Table page (item 133, E5): the table in use, then the two ways to add
 * to it, **Import an enzyme table** from REBASE and **Add an enzyme** of
 * your own, both open rather than behind links. The enzymes of your own are
 * listed in the second, each with **Remove**.
 */
export function EnzymeSource() {
  const { enzymeSetInfo } = useEditorState();
  return (
    <>
      <p className="panel__note" role="status">
        {enzymeSetInfo.bundled
          ? 'Scanning with the bundled table of common cloning enzymes.'
          : `Scanning with ${enzymeSetInfo.label}${
              enzymeSetInfo.fileName === null ? '' : `, from ${enzymeSetInfo.fileName}`
            }.`}
        {enzymeSetInfo.custom.length > 0
          ? ` Plus ${enzymeSetInfo.custom.length.toLocaleString()} of your own.`
          : ''}
      </p>
      <div className="enz-source">
        <EnzymeImport />
        <CustomEnzymeForm />
      </div>
    </>
  );
}
