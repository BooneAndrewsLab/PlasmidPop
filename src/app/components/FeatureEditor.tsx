import { useState } from 'react';

import {
  type Feature,
  type Qualifier,
  type SeqDocument,
  type Strand,
  LocationError,
  formatLocation,
  parseLocation,
} from '@/core';

import { editorStore } from '../state/editorStore';

const COMMON_TYPES = [
  'CDS',
  'gene',
  'promoter',
  'terminator',
  'rep_origin',
  'primer_bind',
  'misc_feature',
  'regulatory',
  'RBS',
  'enhancer',
  'polyA_signal',
  'protein_bind',
  'misc_binding',
  'misc_recomb',
  'LTR',
  'sig_peptide',
  'mRNA',
  'exon',
  'intron',
  'ncRNA',
  'oriT',
  'source',
];

interface Props {
  readonly doc: SeqDocument;
  readonly feature: Feature;
}

interface QualifierRow {
  readonly key: number;
  name: string;
  value: string;
  flag: boolean;
}

export function FeatureEditor({ doc, feature }: Props) {
  const [name, setName] = useState(feature.name);
  const [type, setType] = useState(feature.type);
  const [strand, setStrand] = useState<Strand>(feature.strand);
  const [location, setLocation] = useState(() => {
    const text = formatLocation(feature, doc.length, doc.topology);
    return text.startsWith('complement(') ? text.slice('complement('.length, -1) : text;
  });
  const [qualifiers, setQualifiers] = useState<QualifierRow[]>(() =>
    feature.qualifiers.map((q, i) => ({
      key: i,
      name: q.name,
      value: q.value ?? '',
      flag: q.value === null,
    })),
  );
  const [nextKey, setNextKey] = useState(feature.qualifiers.length);

  let locationError: string | null = null;
  let segments = feature.segments;
  try {
    const parsed = parseLocation(location, doc.length, doc.topology);
    segments = parsed.segments;
    if (parsed.strand === 'reverse')
      locationError = 'Choose the strand with the selector instead of complement(…).';
    else if (parsed.warnings.length > 0) locationError = parsed.warnings[0] ?? null;
  } catch (e) {
    locationError =
      e instanceof LocationError
        ? e.message.replace(/^Cannot parse location "[^"]*": /, '')
        : String(e);
  }
  const valid = locationError === null && type.trim() !== '';

  const submit = (e: { preventDefault: () => void }): void => {
    e.preventDefault();
    if (!valid) return;
    const cleaned: Qualifier[] = qualifiers
      .filter((q) => q.name.trim() !== '')
      .map((q) => ({ name: q.name.trim(), value: q.flag ? null : q.value }));
    editorStore.apply({
      type: 'updateFeature',
      id: feature.id,
      patch: { name: name.trim(), type: type.trim(), strand, segments, qualifiers: cleaned },
    });
    editorStore.editFeature(null);
  };

  const update = (key: number, patch: Partial<Omit<QualifierRow, 'key'>>): void => {
    setQualifiers((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  return (
    <form className="feature-editor" onSubmit={submit}>
      <label className="feature-editor__field">
        <span>Name</span>
        <input
          className="panel__search"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <label className="feature-editor__field">
        <span>Type</span>
        <input
          className="panel__search"
          list="feature-types"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
          }}
        />
        <datalist id="feature-types">
          {COMMON_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <label className="feature-editor__field">
        <span>Strand</span>
        <select
          className="panel__select"
          value={strand}
          onChange={(e) => {
            setStrand(e.target.value === 'reverse' ? 'reverse' : 'forward');
          }}
        >
          <option value="forward">Forward (→)</option>
          <option value="reverse">Reverse (←)</option>
        </select>
      </label>
      <label className="feature-editor__field">
        <span>Location</span>
        <input
          className={`panel__search panel__mono-input${locationError === null ? '' : ' panel__search--invalid'}`}
          spellCheck={false}
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
          }}
          aria-invalid={locationError !== null}
        />
        <span className="feature-editor__hint">
          {locationError ??
            '1-based, e.g. 100..450 or join(100..200,300..450). Wrap the origin with 4000..120.'}
        </span>
      </label>
      <fieldset className="feature-editor__qualifiers">
        <legend>Qualifiers</legend>
        {qualifiers.map((q) => (
          <div key={q.key} className="feature-editor__qualifier">
            <input
              className="panel__search"
              placeholder="name"
              aria-label="Qualifier name"
              value={q.name}
              onChange={(e) => {
                update(q.key, { name: e.target.value });
              }}
            />
            <input
              className="panel__search"
              placeholder={q.flag ? '(flag)' : 'value'}
              aria-label="Qualifier value"
              disabled={q.flag}
              value={q.flag ? '' : q.value}
              onChange={(e) => {
                update(q.key, { value: e.target.value });
              }}
            />
            <button
              type="button"
              className="button button--quiet button--small"
              aria-label="Remove qualifier"
              onClick={() => {
                setQualifiers((rows) => rows.filter((r) => r.key !== q.key));
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => {
            setQualifiers((rows) => [...rows, { key: nextKey, name: '', value: '', flag: false }]);
            setNextKey((k) => k + 1);
          }}
        >
          Add qualifier
        </button>
      </fieldset>
      <div className="feature-editor__actions">
        <button type="submit" className="button button--primary button--small" disabled={!valid}>
          Save changes
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            editorStore.editFeature(null);
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--quiet button--small feature-editor__remove"
          onClick={() => {
            editorStore.editFeature(null);
            editorStore.apply({ type: 'removeFeature', id: feature.id });
          }}
        >
          Remove feature
        </button>
      </div>
    </form>
  );
}
