import {
  ensureWritePermission,
  pickOpenFile,
  pickSaveFile,
  supportsFileSystemAccess,
  writeTextToHandle,
} from './fileSystemAccess';

describe('fileSystemAccess', () => {
  it('reports no support and resolves null pickers where the API is missing', async () => {
    expect(supportsFileSystemAccess()).toBe(false);
    expect(await pickOpenFile()).toBeNull();
    expect(await pickSaveFile('x.gb')).toBeNull();
  });

  it('writes through a handle and checks permissions', async () => {
    const chunks: string[] = [];
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('prompt'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
      createWritable: vi.fn().mockResolvedValue({
        write: (t: string) => {
          chunks.push(t);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      }),
    } as unknown as FileSystemFileHandle;
    expect(await ensureWritePermission(handle)).toBe(true);
    await writeTextToHandle(handle, 'LOCUS');
    expect(chunks).toEqual(['LOCUS']);
    expect(await ensureWritePermission({} as FileSystemFileHandle)).toBe(true);
  });
});
