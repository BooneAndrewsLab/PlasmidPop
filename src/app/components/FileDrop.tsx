import { useRef, useState } from 'react';

import { pickerAccept } from '../pickerAccept';

/**
 * A drop zone with a file button, for the imports that read one file the
 * user has got for themselves (the REBASE table, a fidelity table). It
 * holds only the drag highlight; reading the file is the caller's.
 *
 * `accept` is a hint, not a gate: browsers keep an "All files" entry in the
 * picker's filter list, which is the way out when a download arrived without
 * an extension.
 */
export function FileDrop({
  accept,
  hint,
  busy,
  onFile,
}: {
  readonly accept: string;
  readonly hint: string;
  readonly busy: boolean;
  readonly onFile: (file: File | undefined) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`enzyme-import__drop${dragging ? ' enzyme-import__drop--over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        /*
         * A hint, not a gate: browsers keep an "All files" entry in the
         * picker's filter list, which is the way out when a download arrived
         * without the extension `accept` names (REBASE's link_withrefm.txt,
         * saved with "Save link as", need not have one).
         */
        accept={pickerAccept(accept)}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="button button--small"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Reading…' : 'Choose file…'}
      </button>
      <span className="enzyme-import__hint">{hint}</span>
    </div>
  );
}
