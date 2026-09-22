import { GENETIC_CODES, isTranslationTable } from '@/core';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  /** What the code is being chosen for, for the tooltip. */
  readonly title: string;
}

/**
 * The genetic code the Translate tab and the ORF scan read with. One choice
 * for the app, shown wherever it applies: a six-frame translation and an ORF
 * scan have no feature to ask, unlike a CDS, which is always read with its
 * own `/transl_table`.
 */
export function GeneticCodeSelect({ title }: Props) {
  const { geneticCode } = useEditorState();
  return (
    <label className="panel__field panel__field--row">
      <span>Code</span>
      <select
        className="panel__select"
        value={geneticCode}
        title={title}
        onChange={(e) => {
          const id = Number.parseInt(e.target.value, 10);
          if (isTranslationTable(id)) editorStore.setGeneticCode(id);
        }}
      >
        {GENETIC_CODES.map((code) => (
          <option key={code.id} value={code.id}>
            {code.id}. {code.name}
          </option>
        ))}
      </select>
    </label>
  );
}
