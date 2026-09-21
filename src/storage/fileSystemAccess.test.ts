import {
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

  it('writes through a handle', async () => {
    const chunks: string[] = [];
    const handle = {
      createWritable: vi.fn().mockResolvedValue({
        write: (t: string) => {
          chunks.push(t);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      }),
    } as unknown as FileSystemFileHandle;
    await writeTextToHandle(handle, 'LOCUS');
    expect(chunks).toEqual(['LOCUS']);
  });
});
