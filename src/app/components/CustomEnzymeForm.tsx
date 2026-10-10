import { useMemo, useState } from 'react';

import { parseCustomEnzyme } from '@/io';

import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';
import { describeEnzyme, notationOf } from './customEnzymeText';

/**
 * Adding one enzyme by hand (#217): a name and a recognition site in REBASE
 * notation. The notation is read by the same function as the REBASE import,
 * so the preview is exactly what the enzyme will do everywhere.
 */
export function CustomEnzymeForm({ onClose }: { readonly onClose: () => void }) {
  const { enzymeSetInfo } = useEditorState();
  const [name, setName] = useState('');
  const [notation, setNotation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const parsed = useMemo(() => parseCustomEnzyme(name, notation), [name, notation]);
  const typed = notation.trim() !== '';
  // Only a site is worth complaining about while the name is still empty.
  const siteError = typed && !parsed.ok && name.trim() !== '' ? parsed.error : null;
  const preview = parsed.ok ? parsed.enzyme : null;

  const save = (): void => {
    if (!parsed.ok) return;
    const added = parsed.enzyme;
    persistence
      .addCustomEnzyme(added)
      .then(() => {
        setError(null);
        setSaved(added.name);
        setName('');
        setNotation('');
      })
      .catch((e: unknown) => {
        setSaved(null);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className="panel__section custom-enzyme">
      <h3 className="panel__heading">Add an enzyme</h3>
      <p className="panel__note">
        Write the site as REBASE does: <code>G^AATTC</code>, <code>G^AATT_C</code> with the bottom
        cut written out, or <code>GGTCTC(1/5)</code> for a Type IIS enzyme. IUPAC codes are fine.
      </p>
      <div className="panel__form">
        <label>
          <span>Name</span>
          <input
            type="text"
            aria-label="Enzyme name"
            placeholder="MyEnzI"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(null);
            }}
          />
        </label>
        <label>
          <span>Site</span>
          <input
            type="text"
            aria-label="Recognition site in REBASE notation"
            placeholder="G^AATTC"
            spellCheck={false}
            value={notation}
            onChange={(e) => {
              setNotation(e.target.value);
              setSaved(null);
            }}
          />
        </label>
      </div>
      {siteError !== null && <p className="panel__note panel__note--error">{siteError}</p>}
      {preview !== null && (
        <div className="panel__note" data-testid="custom-enzyme-preview">
          <p className="panel__mono">{notationOf(preview)}</p>
          <ul>
            {describeEnzyme(preview).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {error !== null && <p className="panel__note panel__note--error">{error}</p>}
      {saved !== null && (
        <p className="panel__note">
          Saved {saved}. It is in the sites list, digests and Golden Gate now.
        </p>
      )}
      {enzymeSetInfo.custom.length > 0 && (
        <div className="custom-enzyme__list">
          <p className="panel__note">Your enzymes:</p>
          <ul>
            {enzymeSetInfo.custom.map((e) => (
              <li key={e.name}>
                <span className="panel__mono">
                  {e.name} {notationOf(e)}
                </span>{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    persistence.removeCustomEnzyme(e.name).catch(() => {
                      setError(`Could not remove ${e.name}.`);
                    });
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="panel__buttons">
        <button
          type="button"
          className="button button--small"
          disabled={!parsed.ok || name.trim() === ''}
          onClick={save}
        >
          Save enzyme
        </button>{' '}
        <button type="button" className="button button--quiet button--small" onClick={onClose}>
          Close
        </button>
      </p>
    </div>
  );
}
