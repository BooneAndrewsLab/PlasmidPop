/**
 * The service worker's half of the Web Share Target (#43): a file shared to
 * the installed app from another one — an attachment in a mail app, say —
 * arrives as a POST of form data to `share-target` under the app's scope.
 * There is no server to take it and the app cannot read a POST body, so the
 * service worker does: it puts the files in Cache Storage, on this device,
 * and redirects to the app with a marker saying how many are waiting. The
 * app picks them up from there (`src/app/sharedFiles.ts`) and clears them.
 *
 * `isShareTargetRequest` and `handleShareTarget` are written into the
 * generated `sw.js` by workbox-build as their source text (`toString()`),
 * so each must stand alone: no imports, and no reference to anything else
 * in this module. The names and paths are spelled out inside them, and the
 * tests check them against the constants the app reads with.
 */

/** Where the stashed files are kept until the app has opened them. */
export const SHARE_TARGET_CACHE = 'plasmidpop-share-target';
/** The manifest's `share_target.action`, relative to the scope. */
export const SHARE_TARGET_PATH = 'share-target';
/** The query parameter the redirect carries: a count of files, or `failed`. */
export const SHARE_TARGET_PARAM = 'share-target';
/** The form field the manifest names for the files. */
export const SHARE_TARGET_FIELD = 'files';
/** The header a stashed response keeps the file's name in, URI-encoded. */
export const SHARE_TARGET_NAME_HEADER = 'x-plasmidpop-file-name';

/** What the handler needs of a service worker's global scope. */
interface ShareTargetScope {
  readonly registration: { readonly scope: string };
  readonly caches: {
    open: (name: string) => Promise<{
      keys: () => Promise<readonly Request[]>;
      delete: (request: Request) => Promise<boolean>;
      put: (request: string, response: Response) => Promise<void>;
    }>;
  };
}

/** Workbox's route matcher: a POST to the share target's path. */
export function isShareTargetRequest({
  url,
  request,
}: {
  readonly url: URL;
  readonly request: Request;
}): boolean {
  return request.method === 'POST' && url.pathname.endsWith('/share-target');
}

/**
 * Takes the shared files out of the form data, stashes them under the
 * scope, and sends the app to its start with `?share-target=<count>`
 * (303, so the browser follows with a GET). Anything that goes wrong
 * reaches the app as `?share-target=failed`, so it can say so rather than
 * open to nothing. An earlier share not yet picked up is replaced: the one
 * just made is the one the user is waiting for.
 */
export async function handleShareTarget({
  request,
}: {
  readonly request: Request;
}): Promise<Response> {
  const sw = globalThis as unknown as ShareTargetScope;
  const scope = sw.registration.scope;
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => typeof f !== 'string');
    const cache = await sw.caches.open('plasmidpop-share-target');
    for (const old of await cache.keys()) await cache.delete(old);
    for (const [i, file] of files.entries()) {
      await cache.put(
        `${scope}share-target/${String(i)}`,
        new Response(file, {
          headers: {
            'content-type': file.type === '' ? 'application/octet-stream' : file.type,
            'x-plasmidpop-file-name': encodeURIComponent(file.name),
          },
        }),
      );
    }
    return Response.redirect(`${scope}?share-target=${String(files.length)}`, 303);
  } catch {
    return Response.redirect(`${scope}?share-target=failed`, 303);
  }
}
