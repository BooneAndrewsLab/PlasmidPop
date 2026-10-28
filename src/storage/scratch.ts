import { type DocumentKind } from './db';

/** How long a scratch document lasts after it was last touched (item 110). */
export const SCRATCH_LIFETIME_DAYS = 30;

/** How far ahead of its removal the Files page starts saying a scratch document is going. */
export const SCRATCH_NOTICE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What deciding about a stored document needs: nothing of its contents. */
export interface ScratchCandidate {
  readonly id: string;
  readonly kind?: DocumentKind;
  readonly updatedAt: number;
}

/** When a scratch document last touched at `updatedAt` is removed. */
export function scratchExpiry(updatedAt: number): number {
  return updatedAt + SCRATCH_LIFETIME_DAYS * DAY_MS;
}

/**
 * The scratch documents that are due for removal at `now`: past their
 * lifetime, not open in a tab, and not kept. A row with no `kind` is from
 * before scratch documents and is kept. The clock is the caller's, so the
 * rule is testable without waiting thirty days.
 */
export function expiredScratch(
  rows: readonly ScratchCandidate[],
  now: number,
  openIds: ReadonlySet<string>,
): string[] {
  return rows
    .filter((r) => r.kind === 'scratch' && !openIds.has(r.id) && scratchExpiry(r.updatedAt) <= now)
    .map((r) => r.id);
}

/**
 * The scratch documents that will be removed within `SCRATCH_NOTICE_DAYS`
 * of `now`, with the time the first of them goes, for the notice on the
 * Files page; null when there are none.
 */
export function expiringScratch(
  rows: readonly ScratchCandidate[],
  now: number,
  openIds: ReadonlySet<string>,
): { readonly ids: readonly string[]; readonly firstAt: number } | null {
  const horizon = now + SCRATCH_NOTICE_DAYS * DAY_MS;
  const soon = rows.filter(
    (r) => r.kind === 'scratch' && !openIds.has(r.id) && scratchExpiry(r.updatedAt) <= horizon,
  );
  if (soon.length === 0) return null;
  return {
    ids: soon.map((r) => r.id),
    firstAt: Math.min(...soon.map((r) => scratchExpiry(r.updatedAt))),
  };
}
