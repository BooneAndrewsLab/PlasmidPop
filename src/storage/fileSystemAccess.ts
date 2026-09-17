/**
 * Thin wrapper over the File System Access API (Chromium) with feature
 * detection, so callers can fall back to <input type="file"> and downloads.
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

interface PermissionCapableHandle {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
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

/** Lets the user pick a file; resolves null when they cancel or the API is missing. */
export async function pickOpenFile(): Promise<{ file: File; handle: FileSystemFileHandle } | null> {
  const w = pickerWindow();
  if (w?.showOpenFilePicker === undefined) return null;
  try {
    const [handle] = await w.showOpenFilePicker({
      multiple: false,
      types: SEQUENCE_FILE_TYPES,
      id: 'plasmidpop-open',
    });
    if (handle === undefined) return null;
    return { file: await handle.getFile(), handle };
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

/** Ensures we may write to a handle that came back from IndexedDB after a reload. */
export async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as unknown as PermissionCapableHandle;
  if (h.queryPermission === undefined || h.requestPermission === undefined) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function writeTextToHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}
