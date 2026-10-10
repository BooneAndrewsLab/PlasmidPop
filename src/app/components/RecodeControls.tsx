import { useRef, useState } from 'react';

import { activeEnzymes } from '@/core';

import { persistence } from '../state/persistence';
import { type RecodeForm } from '../recodeForm';
import { useEditorState } from '../state/useEditorStore';
import { useCodonHosts } from './useCodonHosts';

interface Props {
  readonly form: RecodeForm;
  readonly onChange: (next: RecodeForm) => void;
}

/**
 * The settings of a recode or a back-translation (#209): the host whose
 * codons are used, how they are chosen, the restriction sites to keep out
 * (typed as enzyme names), and the limits on GC and runs. Importing a table
 * of the user's own is here too.
 */
export function RecodeControls({ form, onChange }: Props) {
  const hosts = useCodonHosts();
  const { customCodonTables } = useEditorState();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<RecodeForm>): void => {
    onChange({ ...form, ...patch });
  };
  const number = (key: 'gcWindow' | 'gcMin' | 'gcMax' | 'maxRun', label: string, unit: string) => (
    <label className="panel__field">
      <span>{label}</span>
      <input
        className="panel__number"
        type="number"
        min={0}
        value={form[key]}
        aria-label={label}
        onChange={(e) => {
          set({ [key]: e.target.value });
        }}
      />
      <span>{unit}</span>
    </label>
  );
  return (
    <div className="recode__controls">
      <label className="panel__field panel__field--row">
        <span>Host</span>
        <select
          className="panel__select"
          value={form.host}
          aria-label="Host codon usage"
          onChange={(e) => {
            set({ host: e.target.value });
          }}
        >
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
              {h.cds > 0 ? ` (${h.cds.toLocaleString()} CDSs)` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="panel__field panel__field--row">
        <span>Codons</span>
        <select
          className="panel__select"
          value={form.strategy}
          aria-label="How codons are chosen"
          title="Most used: the host's commonest codon for each residue. Host mix: each codon in the share the host uses it, spread along the gene, which reads more like a native gene."
          onChange={(e) => {
            set({ strategy: e.target.value === 'proportional' ? 'proportional' : 'best' });
          }}
        >
          <option value="best">most used by the host</option>
          <option value="proportional">in the host&rsquo;s own mix</option>
        </select>
      </label>
      <label className="panel__field panel__field--stack">
        <span>Keep these sites out (enzyme names)</span>
        <input
          className="panel__input"
          type="text"
          list="recode-enzymes"
          placeholder="EcoRI, BamHI, BsaI"
          value={form.avoid}
          aria-label="Enzymes whose sites to avoid"
          onChange={(e) => {
            set({ avoid: e.target.value });
          }}
        />
        <datalist id="recode-enzymes">
          {activeEnzymes().map((e) => (
            <option key={e.name} value={e.name} />
          ))}
        </datalist>
      </label>
      <div className="panel__controls">
        {number('gcMin', 'GC at least', '%')}
        {number('gcMax', 'at most', '%')}
        {number('gcWindow', 'in any', 'bases')}
        {number('maxRun', 'Longest run', 'bases')}
      </div>
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept=".txt,.csv,.tsv,text/plain,text/csv"
        aria-label="Codon usage file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file === undefined) return;
          setError(null);
          persistence
            .importCodonTableFile(file)
            .then((t) => {
              set({ host: t.id });
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
        }}
      />
      <div className="panel__buttons">
        <button
          type="button"
          className="button button--small button--quiet"
          title="A Codon Usage Database page saved as text, or one codon per line with its count. It is read in your browser and kept there."
          onClick={() => input.current?.click()}
        >
          Import a table…
        </button>
        {customCodonTables.map((t) => (
          <button
            key={t.id}
            type="button"
            className="link"
            aria-label={`Remove ${t.name}`}
            onClick={() => {
              void persistence.removeCodonTable(t.id);
            }}
          >
            remove {t.name}
          </button>
        ))}
      </div>
      {error !== null && <p className="panel__note panel__note--error">{error}</p>}
    </div>
  );
}
