/**
 * Thin wrapper over the File System Access API (Chromium) with feature
 * detection, so callers can fall back to <input type="file"> and downloads.
 *
 * A handle is only ever a means to one read or one write here; none is kept,
 * stored or reused. A document in PlasmidPop is not bound to a file on disk.
 */

interface FilePickerType {
  readonly description: string;
  readonly accept: Readonly<Record<string, readonly string[]>>;
}

interface OpenPickerOptions {
  readonly multiple?: boolean;
  readonly types?: readonly FilePickerType[];
  readonly excludeAcceptAllOption?: boolean;
  readonly id?: string;
}

interface SavePickerOptions {
  readonly suggestedName?: string;
  readonly types?: readonly FilePickerType[];
  readonly id?: string;
}

interface PickerWindow {
  showOpenFilePicker?: (options?: OpenPickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: SavePickerOptions) => Promise<FileSystemFileHandle>;
}

export const SEQUENCE_FILE_TYPES: readonly FilePickerType[] = [
  {
    description: 'Sequence files',
    accept: {
      'chemical/seq-na-genbank': ['.gb', '.gbk', '.genbank', '.gbff', '.ape'],
      'chemical/seq-na-fasta': ['.fa', '.fasta', '.fna', '.seq'],
      'application/vnd.snapgene': ['.dna'],
    },
  },
];

export const GENBANK_SAVE_TYPES: readonly FilePickerType[] = [
  { description: 'GenBank', accept: { 'chemical/seq-na-genbank': ['.gb', '.gbk'] } },
];

function pickerWindow(): PickerWindow | null {
  return typeof window === 'undefined' ? null : (window as unknown as PickerWindow);
}

export function supportsFileSystemAccess(): boolean {
  const w = pickerWindow();
  return typeof w?.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function';
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/**
 * Lets the user pick a file to read; resolves null when they cancel or the
 * API is missing. Only the file comes back: the handle would let the app
 * write to what the user opened, and nothing in PlasmidPop may do that.
 */
export async function pickOpenFile(): Promise<File | null> {
  const w = pickerWindow();
  if (w?.showOpenFilePicker === undefined) return null;
  try {
    const [handle] = await w.showOpenFilePicker({
      multiple: false,
      types: SEQUENCE_FILE_TYPES,
      id: 'plasmidpop-open',
    });
    if (handle === undefined) return null;
    return await handle.getFile();
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

/** Asks where to save; resolves null when cancelled or unsupported. */
export async function pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle | null> {
  const w = pickerWindow();
  if (w?.showSaveFilePicker === undefined) return null;
  try {
    return await w.showSaveFilePicker({
      suggestedName,
      types: GENBANK_SAVE_TYPES,
      id: 'plasmidpop-save',
    });
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

export async function writeTextToHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}
