import { useRef, useState } from 'react';

import { type MyPart, type PartDraft } from '@/core';
import {
  FormatError,
  pairPlannotateFiles,
  readPartsFile,
  readPlannotate,
  writePartsGenBank,
} from '@/io';

import { analytics } from '../analytics';
import { downloadText } from '../saveFile';
import { myPartsStore, plural, sayAddedParts, saveMyParts, useMyParts } from '../state/myParts';

/** Most parts listed at once; the rest are reached by the filter. */
const LISTED = 50;

/**
 * My parts, in the Features tab (#210, item 86): the parts a lab keeps itself,
 * which Detect features looks for beside the bundled list. Closed it reads
 * nothing; opened it reads the browser's store.
 */
export function MyPartsSection() {
  const [open, setOpen] = useState(false);
  return (
    <section className="my-parts" aria-label="My parts">
      <button
        type="button"
        className="button button--quiet button--small my-parts__toggle"
        aria-expanded={open}
        title="Parts of your own (promoters, tags, landing pads) for Detect features to look for"
        onClick={() => {
          setOpen(!open);
        }}
      >
        My parts {open ? '▾' : '▸'}
      </button>
      {open && <MyPartsBody />}
    </section>
  );
}

function MyPartsBody() {
  const { parts, status, error } = useMyParts();
  const [said, setSaid] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const files = useRef<HTMLInputElement>(null);
  const plannotate = useRef<HTMLInputElement>(null);

  const origins = new Map<string, number>();
  for (const p of parts) origins.set(p.origin, (origins.get(p.origin) ?? 0) + 1);

  const needle = filter.trim().toLowerCase();
  const shown = parts.filter(
    (p) =>
      needle === '' ||
      p.name.toLowerCase().includes(needle) ||
      p.type.toLowerCase().includes(needle) ||
      p.origin.toLowerCase().includes(needle),
  );

  const addFiles = async (list: FileList | null): Promise<void> => {
    if (list === null || list.length === 0) return;
    setFileError(null);
    const drafts: PartDraft[] = [];
    try {
      for (const file of Array.from(list)) {
        try {
          drafts.push(...readPartsFile(await file.text(), file.name));
        } catch (e) {
          throw new Error(`${file.name}: ${e instanceof Error ? e.message : String(e)}`, {
            cause: e,
          });
        }
      }
      setSaid(sayAddedParts(await saveMyParts(drafts, 'file')));
    } catch (e) {
      setSaid(null);
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };

  const addPlannotate = async (list: FileList | null): Promise<void> => {
    if (list === null || list.length === 0) return;
    setFileError(null);
    try {
      const read = await Promise.all(
        Array.from(list).map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      const { pairs, unpaired } = pairPlannotateFiles(read);
      if (pairs.length === 0) {
        throw new FormatError(
          'Choose the FASTA file of the database (snapgene or fpbase) as well, with its descriptions table if you have it.',
        );
      }
      const sentences: string[] = [];
      for (const pair of pairs) {
        const imported = readPlannotate(pair.fasta.text, pair.table?.text ?? null, pair.list);
        const report = await saveMyParts(imported.drafts, 'plannotate');
        sentences.push(
          sayAddedParts(
            report,
            `pLannotate ${pair.list}: ${plural(imported.records, 'sequence')} read` +
              (pair.table === null
                ? ', no descriptions table, so parts are named by their ids. '
                : `, ${imported.described.toLocaleString()} described. `),
          ),
        );
      }
      if (unpaired.length > 0) {
        sentences.push(`Not used, no FASTA to go with: ${unpaired.map((f) => f.name).join(', ')}.`);
      }
      setSaid(sentences.join(' '));
    } catch (e) {
      setSaid(null);
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };

  const download = (): void => {
    const own = parts.filter((p) => p.origin === 'My parts');
    const { text, skipped } = writePartsGenBank(own);
    if (text === '') {
      setSaid('No parts of your own with bases to download.');
      return;
    }
    analytics.track('parts', 'export');
    downloadText('my-parts.gb', text);
    setSaid(
      skipped === 0
        ? `Downloaded ${plural(own.length, 'part')}. Imported lists are not included.`
        : `Downloaded ${plural(own.length - skipped, 'part')}; ${plural(skipped, 'part')} known only by their protein cannot be written as DNA. Imported lists are not included.`,
    );
  };

  return (
    <div className="panel__section my-parts__body">
      {status === 'failed' && (
        <p className="panel__error">
          This browser&rsquo;s storage could not be read, so My parts lasts only until the page is
          closed.
        </p>
      )}
      {error !== null && <p className="panel__error">{error}</p>}
      <p className="panel__note panel__note--quiet">
        {status === 'ready' || status === 'failed'
          ? `${plural(parts.length, 'part')} in this browser. Detect features looks for them as well as the bundled list, and says which list each hit came from.`
          : 'Reading…'}
      </p>
      <div className="panel__controls">
        <input
          ref={files}
          type="file"
          multiple
          accept=".gb,.gbk,.genbank,.fa,.fasta,.fna,.txt"
          hidden
          aria-label="Add parts from a GenBank or FASTA file"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="button button--small"
          title="Each feature of a GenBank record, or each FASTA record, becomes a part"
          onClick={() => files.current?.click()}
        >
          Add from file…
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={!parts.some((p) => p.origin === 'My parts')}
          onClick={download}
        >
          Download as GenBank
        </button>
      </div>
      <details className="my-parts__plannotate">
        <summary>Import a pLannotate database</summary>
        <p className="panel__note panel__note--quiet">
          If you already have a copy of one of{' '}
          <a
            className="link"
            href="https://github.com/mmcguffi/pLannotate"
            target="_blank"
            rel="noreferrer noopener"
          >
            pLannotate
          </a>
          &rsquo;s databases and may use it, choose its FASTA file (<code>snapgene.fasta</code>,{' '}
          <code>fpbase.fasta</code>) together with its descriptions table (CSV or TSV) in one go.
          Nothing is uploaded, and none of it is bundled with PlasmidPop. Hits from it are labelled
          with the database they came from, never as the bundled list.
        </p>
        <input
          ref={plannotate}
          type="file"
          multiple
          hidden
          aria-label="Import a pLannotate database"
          onChange={(e) => {
            void addPlannotate(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="button button--small"
          onClick={() => plannotate.current?.click()}
        >
          Choose files…
        </button>
      </details>
      {said !== null && <p className="panel__note">{said}</p>}
      {fileError !== null && <p className="panel__error">{fileError}</p>}
      {origins.size > 1 || (origins.size === 1 && !origins.has('My parts')) ? (
        <ul className="my-parts__lists" aria-label="Lists of parts">
          {[...origins].map(([origin, n]) => (
            <li key={origin}>
              {origin}: {plural(n, 'part')}{' '}
              {origin !== 'My parts' && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    void myPartsStore.remove(
                      parts.filter((p) => p.origin === origin).map((p) => p.id),
                    );
                  }}
                >
                  Remove this list
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {parts.length > 8 && (
        <input
          className="panel__search"
          type="search"
          placeholder="Filter by name, type or list"
          aria-label="Filter parts"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
      )}
      {parts.length === 0 && status === 'ready' ? (
        <p className="panel__note">
          No parts yet. Choose a feature and Save to My parts, or add a GenBank or FASTA file.
        </p>
      ) : (
        <ul className="my-parts__list" aria-label="My parts list">
          {shown.slice(0, LISTED).map((p) => (
            <PartRow key={p.id} part={p} />
          ))}
          {shown.length > LISTED && (
            <li className="panel__note panel__note--quiet">
              {plural(shown.length - LISTED, 'more part')}; filter to find one.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function PartRow({ part }: { readonly part: MyPart }) {
  const size =
    part.sequence !== ''
      ? `${part.sequence.length.toLocaleString()} bp`
      : `${(part.protein?.length ?? 0).toLocaleString()} aa`;
  return (
    <li className="my-parts__item">
      <span className="my-parts__name" title={part.notes === '' ? part.name : part.notes}>
        {part.name}
      </span>{' '}
      <span className="panel__note--quiet">
        {part.type}, {size}
        {part.origin === 'My parts' ? '' : `, ${part.origin}`}
      </span>{' '}
      <button
        type="button"
        className="link"
        aria-label={`Remove ${part.name}`}
        onClick={() => {
          void myPartsStore.remove([part.id]);
        }}
      >
        Remove
      </button>
    </li>
  );
}
