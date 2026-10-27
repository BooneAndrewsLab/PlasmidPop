import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  FLANK_PRESET_BP,
  type Flanks,
  GENE_QUERY_DEBOUNCE_MS,
  type GeneHit,
  type GeneSearch,
  MIN_GENE_QUERY,
  NcbiError,
  ORGANISMS,
  geneSearchTerm,
  isAbort,
  searchGenes,
} from '@/io';

import {
  type NcbiFetched,
  checkAccessionInput,
  fetchAccessions,
  fetchGeneFromNcbi,
  fetchRegionFromNcbi,
  openFetched,
  parseRegionInput,
} from '../openFromNcbi';

export type NcbiMode = 'accession' | 'gene';

/** What was last typed and chosen, so a mistyped accession is there to fix next time. */
let lastInput = '';
let lastMode: NcbiMode = 'accession';
let lastGene = '';
let lastOrganism = ORGANISMS[0]?.taxId.toString() ?? '';
let lastOtherOrganism = '';

/** The organism picker's value for free text. */
const OTHER = 'other';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toString()} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A flank box's text as bases: empty is none; anything but a whole number is refused. */
function parseFlank(text: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

/** "NC_000017.11:7668421-7687490 (−)", where a gene lies, in NCBI's 1-based terms. */
function placement(hit: GeneHit): string {
  const { location } = hit;
  if (location === null) return 'no genomic location';
  const strand = location.strand === 'reverse' ? '−' : '+';
  return `${location.accession}:${(location.start + 1).toString()}-${location.end.toString()} (${strand})`;
}

function segmentedClass(active: boolean): string {
  return `segmented__button${active ? ' segmented__button--active' : ''}`;
}

export interface NcbiSearchProps {
  /** The records were fetched and opened (or handed to `onFetched`). */
  onOpened: () => void;
  /** Cancel or Escape pressed with no fetch under way. */
  onCancel: () => void;
  /**
   * Takes what was fetched instead of its being opened in tabs: a host
   * that wants the record for something else (item 107). Without it the
   * documents open in tabs, the last in front.
   */
  onFetched?: (fetched: NcbiFetched) => void;
  /** Escape listens on the whole document (a modal host) rather than the form. */
  globalEscape?: boolean;
  /** Which search to start on; the last used otherwise. */
  initialMode?: NcbiMode;
  className?: string;
  /** Id of the host's heading, when it has one. */
  titleId?: string;
}

/**
 * The NCBI lookup (items 58 and 107): by accession (or a range of one), or
 * a gene by name and organism with flanks (#299), with the privacy hint,
 * progress, errors and the request lifecycle. No dialog chrome; the host
 * says what happens next.
 */
export function NcbiSearch({
  onOpened,
  onCancel,
  onFetched,
  globalEscape = false,
  initialMode,
  className,
  titleId,
}: NcbiSearchProps) {
  const [mode, setMode] = useState<NcbiMode>(initialMode ?? lastMode);
  const [input, setInput] = useState(lastInput);
  const [gene, setGene] = useState(lastGene);
  const [organism, setOrganism] = useState(lastOrganism);
  const [otherOrganism, setOtherOrganism] = useState(lastOtherOrganism);
  const [upstream, setUpstream] = useState('');
  const [downstream, setDownstream] = useState('');
  const [reverseComplement, setReverseComplement] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bytes received while a fetch is under way; null when none is. */
  const [received, setReceived] = useState<number | null>(null);
  /** The genes listed for what is typed, and the query they answer. */
  const [suggestions, setSuggestions] = useState<(GeneSearch & { readonly key: string }) | null>(
    null,
  );
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  /** The gene picked from the list, while the box still says its symbol. */
  const [picked, setPicked] = useState<GeneHit | null>(null);

  const controller = useRef<AbortController | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const geneRef = useRef<HTMLInputElement>(null);
  // Whether the list is open, for the Escape handler the host's document listens with.
  const listOpenRef = useRef(false);
  useEffect(() => {
    listOpenRef.current = listOpen;
  }, [listOpen]);
  // Hosts pass fresh closures every render; holding them in refs keeps a
  // host re-render from restarting (aborting) a fetch.
  const onOpenedRef = useRef(onOpened);
  const onCancelRef = useRef(onCancel);
  const onFetchedRef = useRef(onFetched);
  useEffect(() => {
    onOpenedRef.current = onOpened;
    onCancelRef.current = onCancel;
    onFetchedRef.current = onFetched;
  });

  const organismText = organism === OTHER ? otherOrganism : organism;
  const queryKey = `${gene}\u0000${organismText}`;

  /** Cancel: closes the gene list, else stops a fetch under way, else closes the dialog. */
  const cancel = useCallback((): void => {
    if (listOpenRef.current) {
      setListOpen(false);
      return;
    }
    if (controller.current !== null) {
      controller.current.abort();
      controller.current = null;
      setReceived(null);
      (mode === 'gene' ? geneRef : inputRef).current?.focus();
      return;
    }
    onCancelRef.current();
  }, [mode]);

  useEffect(() => {
    const field = (mode === 'gene' ? geneRef : inputRef).current;
    field?.focus();
    field?.select();
  }, [mode]);

  useEffect(() => {
    if (!globalEscape) return;
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [globalEscape, cancel]);

  // Closed some other way while fetching or looking up: nothing is left running.
  useEffect(() => {
    return () => {
      controller.current?.abort();
      searchController.current?.abort();
    };
  }, []);

  /** Looks the typed gene up, cancelling a lookup under way; resolves to the list, or null when superseded. */
  const lookUp = useCallback(
    async (text: string, organismTerm: string): Promise<GeneSearch | null> => {
      searchController.current?.abort();
      const mine = new AbortController();
      searchController.current = mine;
      setSearching(true);
      setLookupError(null);
      try {
        const found = await searchGenes(text, organismTerm, { signal: mine.signal });
        if (searchController.current !== mine) return null;
        setSuggestions({ ...found, key: `${text}\u0000${organismTerm}` });
        setActive(found.hits.length > 0 ? 0 : -1);
        return found;
      } catch (e) {
        if (isAbort(e) || searchController.current !== mine) return null;
        setLookupError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        if (searchController.current === mine) {
          searchController.current = null;
          setSearching(false);
        }
      }
    },
    [],
  );

  // As the user types a gene: after a pause, and from two characters, the
  // text and organism go to NCBI for the list. Nothing goes in the other
  // mode, for a shorter text, for the symbol just picked from the list, or
  // for a query whose list is already here (it shows only while the query
  // is the one it answers, so a stale list is a cache, never shown).
  useEffect(() => {
    if (mode !== 'gene') return;
    if (picked !== null && picked.symbol === gene) return;
    if (geneSearchTerm(gene, organismText) === null) return;
    if (suggestions?.key === queryKey) return;
    const timer = setTimeout(() => {
      // Open pressed before the pause was up: that fetch resolves the name itself.
      if (controller.current !== null) return;
      void lookUp(gene, organismText).then((found) => {
        if (found !== null) setListOpen(true);
      });
    }, GENE_QUERY_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [mode, gene, organismText, queryKey, picked, suggestions?.key, lookUp]);

  const pick = (hit: GeneHit): void => {
    setPicked(hit);
    setGene(hit.symbol);
    setListOpen(false);
    setError(null);
    geneRef.current?.focus();
  };

  /** The flanks typed, or the reason they cannot be used. */
  const flanks = (): Flanks | string => {
    const up = parseFlank(upstream);
    const down = parseFlank(downstream);
    if (up === null || down === null) return 'Flanks are whole numbers of bases.';
    return { upstream: up, downstream: down };
  };

  /**
   * The gene to fetch: the one picked, else the one match for the text (an
   * exact symbol, or the only hit). Several leave the list open to pick from.
   */
  const resolveGene = async (signal: AbortSignal): Promise<GeneHit> => {
    if (picked !== null && picked.symbol === gene) return picked;
    const text = gene.trim();
    if (geneSearchTerm(text, organismText) === null) {
      throw new NcbiError(
        'not-found',
        `Type at least ${MIN_GENE_QUERY.toString()} characters of a gene name.`,
      );
    }
    let found: GeneSearch | null = suggestions?.key === queryKey ? suggestions : null;
    if (found === null) {
      searchController.current?.abort();
      found = await searchGenes(text, organismText, { signal });
      setSuggestions({ ...found, key: queryKey });
    }
    const exact = found.hits.filter((h) => h.symbol.toUpperCase() === text.toUpperCase());
    const [only] = exact.length === 1 ? exact : found.hits.length === 1 ? found.hits : [];
    if (only !== undefined) {
      setPicked(only);
      return only;
    }
    const where = organismText === '' ? '' : ` in ${organismLabel(organism, otherOrganism)}`;
    if (found.hits.length === 0) {
      throw new NcbiError('not-found', `NCBI lists no gene matching “${text}”${where}.`);
    }
    setListOpen(true);
    setActive(0);
    throw new NcbiError(
      'not-found',
      `${found.count.toLocaleString('en-US')} genes match “${text}”${where}; pick one from the list.`,
    );
  };

  /** Runs one fetch, from a job given the cancel signal, through to the host's callback. */
  const run = (job: (signal: AbortSignal) => Promise<NcbiFetched>): void => {
    setError(null);
    setReceived(0);
    const mine = new AbortController();
    controller.current = mine;
    job(mine.signal)
      .then((fetched) => {
        if (controller.current !== mine) return;
        controller.current = null;
        lastInput = '';
        lastGene = '';
        const handOver = onFetchedRef.current;
        if (handOver === undefined) openFetched(fetched);
        else handOver(fetched);
        onOpenedRef.current();
      })
      .catch((e: unknown) => {
        if (isAbort(e) || controller.current !== mine) return;
        controller.current = null;
        setReceived(null);
        setError(e instanceof Error ? e.message : String(e));
        (mode === 'gene' ? geneRef : inputRef).current?.focus();
      });
  };

  const submit = (): void => {
    if (controller.current !== null) return;
    lastMode = mode;
    lastInput = input;
    lastGene = gene;
    lastOrganism = organism;
    lastOtherOrganism = otherOrganism;
    const flank = flanks();
    if (typeof flank === 'string') {
      setError(flank);
      return;
    }
    const onProgress = (bytes: number): void => {
      setReceived(bytes);
    };
    if (mode === 'gene') {
      setListOpen(false);
      run(async (signal) => {
        const hit = await resolveGene(signal);
        return fetchGeneFromNcbi(hit, flank, reverseComplement, { signal, onProgress });
      });
      return;
    }
    const region = parseRegionInput(input);
    if (region !== null) {
      run((signal) =>
        fetchRegionFromNcbi(region, flank, reverseComplement, { signal, onProgress }),
      );
      return;
    }
    const check = checkAccessionInput(input);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    run((signal) => fetchAccessions(check.accessions, { signal, onProgress }));
  };

  const onGeneKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    const hits = suggestions?.hits ?? [];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (hits.length === 0) return;
      e.preventDefault();
      if (!listOpen) {
        setListOpen(true);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + hits.length) % hits.length);
      return;
    }
    if (e.key === 'Enter' && listOpen) {
      const hit = hits[active];
      if (hit !== undefined) {
        e.preventDefault();
        pick(hit);
      }
      return;
    }
    if (e.key === 'Escape' && listOpen) {
      e.preventDefault();
      e.stopPropagation();
      setListOpen(false);
    }
  };

  const busy = received !== null;
  const listed = listOpen && suggestions !== null && suggestions.key === queryKey;
  const hits = suggestions?.hits ?? [];
  return (
    <form
      className={className}
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (!globalEscape && e.key === 'Escape') cancel();
      }}
    >
      <div className="dialog__body ncbi-open">
        <div className="segmented ncbi-open__modes" role="group" aria-label="Look up by">
          <button
            type="button"
            className={segmentedClass(mode === 'accession')}
            aria-pressed={mode === 'accession'}
            disabled={busy}
            onClick={() => {
              setMode('accession');
              setError(null);
            }}
          >
            Accession
          </button>
          <button
            type="button"
            className={segmentedClass(mode === 'gene')}
            aria-pressed={mode === 'gene'}
            disabled={busy}
            onClick={() => {
              setMode('gene');
              setError(null);
            }}
          >
            Gene
          </button>
        </div>

        {mode === 'accession' ? (
          <>
            <label className="panel__field ncbi-open__field">
              <span>Accession</span>
              <input
                ref={inputRef}
                className="panel__search"
                type="text"
                value={input}
                disabled={busy}
                placeholder="L09137, NC_001422, NP_000509"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="characters"
                aria-invalid={error !== null}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError(null);
                }}
              />
            </label>
            <p id="ncbi-privacy" className="ncbi-open__hint">
              One accession or several, nucleotide or protein, separated by spaces or commas; each
              opens in a tab of its own. A range, NC_000017.11:7668421-7687490, opens that stretch
              with the flanks below. Only the accession numbers (and the range) are sent, to NCBI
              (eutils.ncbi.nlm.nih.gov), and nothing else leaves your browser.
            </p>
          </>
        ) : (
          <>
            <div className="ncbi-open__gene">
              <label className="panel__field ncbi-open__field ncbi-open__combo">
                <span>Gene</span>
                <input
                  ref={geneRef}
                  className="panel__search"
                  type="text"
                  value={gene}
                  disabled={busy}
                  placeholder="TP53, Cdc28, lacZ"
                  spellCheck={false}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={listed}
                  aria-controls="ncbi-gene-list"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    listed && active >= 0 ? `ncbi-gene-${active.toString()}` : undefined
                  }
                  aria-invalid={error !== null}
                  onChange={(e) => {
                    setGene(e.target.value);
                    setPicked(null);
                    setError(null);
                  }}
                  onKeyDown={onGeneKey}
                  onFocus={() => {
                    if (suggestions !== null && suggestions.key === queryKey && picked === null) {
                      setListOpen(true);
                    }
                  }}
                  onBlur={() => {
                    setListOpen(false);
                  }}
                />
                {listed && (
                  <ul
                    id="ncbi-gene-list"
                    className="ncbi-open__list"
                    role="listbox"
                    aria-label="Matching genes"
                  >
                    {hits.map((hit, i) => (
                      <li
                        key={hit.id}
                        id={`ncbi-gene-${i.toString()}`}
                        role="option"
                        aria-selected={i === active}
                        className={`ncbi-open__option${i === active ? ' ncbi-open__option--active' : ''}`}
                        onMouseDown={(e) => {
                          // Before the input's blur closes the list.
                          e.preventDefault();
                        }}
                        onClick={() => {
                          pick(hit);
                        }}
                        onMouseEnter={() => {
                          setActive(i);
                        }}
                      >
                        <span className="ncbi-open__option-name">
                          <strong>{hit.symbol}</strong>
                          {hit.fullName !== '' && ` — ${hit.fullName}`}
                        </span>
                        <span className="ncbi-open__option-meta">
                          {hit.organism}
                          {hit.chromosome !== '' && `, chromosome ${hit.chromosome}`} ·{' '}
                          {placement(hit)}
                        </span>
                      </li>
                    ))}
                    {hits.length === 0 && (
                      <li className="ncbi-open__option ncbi-open__option-meta" aria-disabled="true">
                        No matching gene.
                      </li>
                    )}
                    {suggestions.count > hits.length && (
                      <li className="ncbi-open__option ncbi-open__option-meta" aria-disabled="true">
                        {(suggestions.count - hits.length).toLocaleString('en-US')} more; type more
                        of the name.
                      </li>
                    )}
                  </ul>
                )}
              </label>
              <label className="panel__field ncbi-open__field">
                <span>Organism</span>
                <select
                  className="panel__select"
                  value={organism}
                  disabled={busy}
                  onChange={(e) => {
                    setOrganism(e.target.value);
                    setPicked(null);
                    setError(null);
                  }}
                >
                  {ORGANISMS.map((o) => (
                    <option key={o.taxId} value={o.taxId.toString()}>
                      {o.label}
                    </option>
                  ))}
                  <option value={OTHER}>Other…</option>
                  <option value="">Any organism</option>
                </select>
              </label>
              {organism === OTHER && (
                <label className="panel__field ncbi-open__field">
                  <span>Taxon</span>
                  <input
                    className="panel__search"
                    type="text"
                    value={otherOrganism}
                    disabled={busy}
                    placeholder="Name or taxonomy id, e.g. Xenopus laevis or 8355"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => {
                      setOtherOrganism(e.target.value);
                      setPicked(null);
                      setError(null);
                    }}
                  />
                </label>
              )}
              {searching && <span className="ncbi-open__searching">Looking up…</span>}
              {lookupError !== null && !searching && (
                <span className="ncbi-open__searching">{lookupError}</span>
              )}
            </div>
            <p id="ncbi-privacy" className="ncbi-open__hint">
              As you type, what is in the Gene box and the organism go to NCBI
              (eutils.ncbi.nlm.nih.gov) to list the genes that match; nothing else leaves your
              browser. Open fetches the gene's stretch of its chromosome (or its RefSeqGene record)
              with the flanks below, every feature marked, and the document keeps the accession and
              range.
            </p>
          </>
        )}

        <div className="ncbi-open__flanks">
          <label className="panel__field ncbi-open__flank">
            <span>Upstream</span>
            <input
              className="panel__search"
              type="text"
              inputMode="numeric"
              value={upstream}
              disabled={busy}
              placeholder="0"
              onChange={(e) => {
                setUpstream(e.target.value);
                setError(null);
              }}
            />
            <span>bp</span>
          </label>
          <label className="panel__field ncbi-open__flank">
            <span>Downstream</span>
            <input
              className="panel__search"
              type="text"
              inputMode="numeric"
              value={downstream}
              disabled={busy}
              placeholder="0"
              onChange={(e) => {
                setDownstream(e.target.value);
                setError(null);
              }}
            />
            <span>bp</span>
          </label>
          <button
            type="button"
            className="button"
            disabled={busy}
            data-tip={`${FLANK_PRESET_BP.toLocaleString('en-US')} bp on each side`}
            onClick={() => {
              setUpstream(FLANK_PRESET_BP.toString());
              setDownstream(FLANK_PRESET_BP.toString());
              setError(null);
            }}
          >
            1 kb
          </button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={reverseComplement}
              disabled={busy}
              onChange={(e) => {
                setReverseComplement(e.target.checked);
              }}
            />
            {mode === 'gene'
              ? 'Reverse-complement a reverse-strand gene so it reads 5′ to 3′'
              : 'Reverse-complement (the other strand)'}
          </label>
        </div>
        {busy && (
          <p className="ncbi-open__status" role="status">
            Fetching from NCBI… {received > 0 ? formatBytes(received) : ''}
          </p>
        )}
        {error !== null && (
          <p className="panel__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog__actions">
        <button type="button" className="button" onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" disabled={busy}>
          Open
        </button>
      </div>
    </form>
  );
}

/** The organism as the picker names it, for a message. */
function organismLabel(choice: string, other: string): string {
  if (choice === OTHER) return other.trim();
  const preset = ORGANISMS.find((o) => o.taxId.toString() === choice);
  return preset === undefined ? choice : preset.label.replace(/ \(.*\)$/, '');
}
