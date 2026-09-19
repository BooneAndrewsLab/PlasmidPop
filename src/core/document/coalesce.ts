import { type Coalesce } from '../history';

/**
 * Runs of small edits that become one undo step.
 *
 * Typing base after base, or holding Backspace, is one thing the user did,
 * and one thing they expect one Ctrl+Z to take back. The history merges
 * consecutive changes that name the same run (see `Coalesce`), and these
 * builders define the runs the editor knows about: the key carries where the
 * caret has got to, so a keystroke at the caret continues the run while one
 * anywhere else begins a fresh step.
 *
 * Positions are the normalized caret positions before and after the change,
 * so a caret that wraps the origin of a circular sequence still lines up
 * with the next keystroke's.
 */

/** A pause at least this long ends a run, so a considered edit is its own step. */
export const TYPING_RUN_MS = 2000;

/**
 * Most bases one run may hold. A cap keeps undo from swallowing a whole
 * paragraph of typing at once; it is a sequence-view row's worth of bases.
 */
export const TYPING_RUN_LIMIT = 60;

function run(kind: string, before: number, after: number, verb: string): Coalesce {
  return {
    follows: `${kind}@${before}`,
    key: `${kind}@${after}`,
    limit: TYPING_RUN_LIMIT,
    withinMs: TYPING_RUN_MS,
    relabel: (merged) => `${verb} ${merged} bases`,
  };
}

/** Typing: the next base goes in where this one left off. */
export function typingRun(caretBefore: number, caretAfter: number): Coalesce {
  return run('type', caretBefore, caretAfter, 'Insert');
}

/** Backspace: the next press eats the base before the one this ate. */
export function backspaceRun(caretBefore: number, caretAfter: number): Coalesce {
  return run('back', caretBefore, caretAfter, 'Delete');
}

/**
 * Delete: the base after the caret goes, the rest shuffles up and the caret
 * stays put, so the whole run shares one position.
 */
export function deleteForwardRun(caret: number): Coalesce {
  return run('del', caret, caret, 'Delete');
}
