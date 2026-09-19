import { analytics } from '../analytics';
import { Fragment, useMemo, useState } from 'react';

import {
  type DigestFragment,
  type FragmentEnd,
  type SeqDocument,
  assemblyJunctions,
  describeEnd,
  digest,
  documentFromFragment,
  flipFragment,
  ligate,
} from '@/core';

import { type AssemblyPart, editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

function describeRange(f: DigestFragment, seqLength: number): string {
  const from = f.range.start + 1;
  const to = ((f.range.end - 1) % Math.max(1, seqLength)) + 1;
  return `${from.toLocaleString()}–${to.toLocaleString()}`;
}

function endLabel(end: FragmentEnd): string {
  if (end.enzyme === null) return 'end';
  return end.enzyme;
}

function EndTag({ end, side }: { readonly end: FragmentEnd; readonly side: 'left' | 'right' }) {
  const shape = end.kind === 'blunt' ? 'blunt' : end.kind === "5'" ? '5′' : '3′';
  return (
    <span className={`end end--${side}`} title={describeEnd(end)}>
      <span className="end__enzyme">{endLabel(end)}</span>
      <span className="end__shape">{shape}</span>
      {end.overhang !== '' && <span className="end__overhang">{end.overhang.toUpperCase()}</span>}
    </span>
  );
}

function FragmentRow({
  fragment,
  seqLength,
  onSelect,
  onOpen,
}: {
  readonly fragment: DigestFragment;
  readonly seqLength: number;
  readonly onSelect: () => void;
  readonly onOpen: () => void;
}) {
  const names = [...new Set(fragment.features.map((f) => (f.name === '' ? f.type : f.name)))];
  return (
    <li className="fragment">
      <div className="fragment__head">
        <button
          type="button"
          className="fragment__length"
          title="Select this fragment in the views"
          onClick={onSelect}
        >
          {fragment.sequence.length.toLocaleString()} bp
        </button>
        <span className="fragment__range">{describeRange(fragment, seqLength)}</span>
        <button
          type="button"
          className="button button--quiet button--small fragment__add"
          title="Add this fragment to the assembly below"
          onClick={() => {
            editorStore.addToAssembly(fragment);
          }}
        >
          Add
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          title="Open this fragment as a document of its own, sticky ends and all"
          onClick={onOpen}
        >
          Open
        </button>
      </div>
      <div className="fragment__ends">
        <EndTag end={fragment.left} side="left" />
        <span className="fragment__bar" aria-hidden="true" />
        <EndTag end={fragment.right} side="right" />
      </div>
      {names.length > 0 && (
        <div className="fragment__features" title={names.join(', ')}>
          {names.slice(0, 4).join(', ')}
          {names.length > 4 ? `, +${names.length - 4} more` : ''}
        </div>
      )}
    </li>
  );
}

function JunctionRow({
  from,
  to,
  compatible,
  closing,
}: {
  readonly from: FragmentEnd;
  readonly to: FragmentEnd;
  readonly compatible: boolean;
  readonly closing: boolean;
}) {
  return (
    <li
      className={`junction${compatible ? ' junction--ok' : ' junction--bad'}`}
      aria-label={`${closing ? 'Closing join' : 'Join'}: ${describeEnd(from)} to ${describeEnd(to)}, ${compatible ? 'compatible' : 'incompatible'}`}
    >
      <span className="junction__mark" aria-hidden="true">
        {compatible ? '✓' : '✕'}
      </span>
      <span className="junction__text">
        {closing ? 'closes: ' : ''}
        {describeEnd(from)} ↔ {describeEnd(to)}
        {compatible ? '' : ' — ends do not match'}
      </span>
    </li>
  );
}

function PartRow({
  part,
  index,
  count,
}: {
  readonly part: AssemblyPart;
  readonly index: number;
  readonly count: number;
}) {
  const f = part.fragment;
  return (
    <li className="part">
      <span className="part__index">{index + 1}</span>
      <span className="part__text">
        <span className="part__name">
          {f.source}
          {part.flipped ? ' (flipped)' : ''}
        </span>
        <span className="part__detail">
          {f.sequence.length.toLocaleString()} bp · {describeEnd(f.left)} → {describeEnd(f.right)}
        </span>
      </span>
      <span className="part__actions">
        <button
          type="button"
          className="button button--quiet button--small"
          title="Turn this fragment around (reverse complement)"
          aria-label={`Flip part ${index + 1}`}
          onClick={() => {
            editorStore.flipAssemblyPart(part.id, flipFragment(f));
          }}
        >
          ⇄
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={index === 0}
          aria-label={`Move part ${index + 1} up`}
          onClick={() => {
            editorStore.moveAssemblyPart(part.id, -1);
          }}
        >
          ↑
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={index === count - 1}
          aria-label={`Move part ${index + 1} down`}
          onClick={() => {
            editorStore.moveAssemblyPart(part.id, 1);
          }}
        >
          ↓
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          aria-label={`Remove part ${index + 1}`}
          onClick={() => {
            editorStore.removeFromAssembly(part.id);
          }}
        >
          ✕
        </button>
      </span>
    </li>
  );
}

export function CloningPanel({ doc }: Props) {
  const { analysis, shownEnzymes, showCutSites, assembly } = useEditorState();
  const [circular, setCircular] = useState(true);
  const [name, setName] = useState('');
  const ready = analysis !== null && analysis.doc === doc;

  const cutSites = useMemo(
    () => (ready ? analysis.cutSites.filter((s) => shownEnzymes.has(s.enzyme)) : []),
    [analysis, ready, shownEnzymes],
  );
  const enzymesUsed = useMemo(
    () => [...new Set(cutSites.map((s) => s.enzyme))].sort((a, b) => a.localeCompare(b)),
    [cutSites],
  );
  const fragments = useMemo(
    () =>
      ready ? digest(doc, cutSites).sort((a, b) => b.sequence.length - a.sequence.length) : [],
    [doc, cutSites, ready],
  );

  const parts = assembly.map((p) => p.fragment);
  const junctions = assemblyJunctions(parts, circular);
  const total = parts.reduce((n, f) => n + f.sequence.length, 0);
  const canAssemble = parts.length > 0 && junctions.every((j) => j.compatible);
  const defaultName =
    assembly.length === 0
      ? 'Assembly'
      : `${[...new Set(parts.map((f) => f.source))].join('+')} assembly`;

  const assemble = (): void => {
    try {
      analytics.track('cloning', 'ligate');
      const product = ligate(parts, {
        name: name.trim() === '' ? defaultName : name.trim(),
        circular,
      });
      editorStore.openDocument(product);
      editorStore.clearAssembly();
      editorStore.setSidebarTab('features');
      setName('');
    } catch (e) {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="panel">
      <h3 className="panel__heading">
        Digest with ticked enzymes
        {enzymesUsed.length > 0 && (
          <span className="panel__heading-note">{enzymesUsed.join(', ')}</span>
        )}
      </h3>
      {!ready ? (
        <p className="panel__note">Scanning for restriction sites…</p>
      ) : enzymesUsed.length === 0 ? (
        <p className="panel__note">
          No enzyme is ticked.{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              editorStore.setSidebarTab('enzymes');
            }}
          >
            Tick enzymes
          </button>{' '}
          in the Enzymes tab to cut {doc.name} with them.
          {doc.isCircular ? '' : ' Uncut, the whole molecule is one blunt-ended fragment.'}
        </p>
      ) : (
        <p className="panel__note">
          {fragments.length === 1 ? '1 fragment' : `${fragments.length} fragments`}, largest first.
          Add the ones to join, then arrange them below.
        </p>
      )}
      {!showCutSites && enzymesUsed.length > 0 && (
        <p className="panel__note">
          Cut sites are hidden in the views; this digest follows the ticks, not that toggle.
        </p>
      )}
      {fragments.length > 0 && (
        <ul className="fragment-list">
          {fragments.map((f) => (
            <FragmentRow
              key={`${f.range.start}-${f.range.end}`}
              fragment={f}
              seqLength={doc.length}
              onSelect={() => {
                editorStore.setSelection(f.range);
                editorStore.revealPosition(f.range.start);
              }}
              onOpen={() => {
                analytics.track('cloning', 'open-fragment');
                editorStore.openDocument(documentFromFragment(f));
                editorStore.setSidebarTab('features');
              }}
            />
          ))}
        </ul>
      )}

      <div className="panel__section">
        <h3 className="panel__heading">
          Assembly
          {assembly.length > 0 && (
            <span className="panel__heading-note">
              {assembly.length} {assembly.length === 1 ? 'part' : 'parts'}, {total.toLocaleString()}{' '}
              bp
            </span>
          )}
        </h3>
        {assembly.length === 0 ? (
          <p className="panel__note">
            Nothing collected yet. Fragments stay here while you open other files, so a vector from
            one file can take an insert from another.
          </p>
        ) : (
          <ol className="part-list">
            {assembly.map((part, i) => {
              const join = junctions[i];
              return (
                <Fragment key={part.id}>
                  <PartRow part={part} index={i} count={assembly.length} />
                  {join !== undefined && (
                    <JunctionRow {...join} closing={i === assembly.length - 1} />
                  )}
                </Fragment>
              );
            })}
          </ol>
        )}
        {assembly.length > 0 && (
          <div className="panel__controls">
            <input
              className="panel__search"
              type="text"
              placeholder={defaultName}
              aria-label="Name of the assembled document"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            <label className="toggle">
              <input
                type="checkbox"
                checked={circular}
                onChange={(e) => {
                  setCircular(e.target.checked);
                }}
              />
              Circular product
            </label>
            <div className="panel__buttons">
              <button
                type="button"
                className="button button--quiet button--small"
                onClick={() => {
                  editorStore.clearAssembly();
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="button button--primary button--small"
                disabled={!canAssemble}
                title={
                  canAssemble
                    ? 'Ligate the parts into a new document'
                    : 'Every join must have matching ends'
                }
                onClick={assemble}
              >
                Assemble
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
