import { type CodonUsageTable, CODON_USAGE_TABLES } from '@/core';

import { useEditorState } from '../state/useEditorStore';

/** The hosts the menu offers: the bundled ones, then the user's own. */
export function useCodonHosts(): readonly CodonUsageTable[] {
  const { customCodonTables } = useEditorState();
  return [...CODON_USAGE_TABLES, ...customCodonTables];
}
