/**
 * The app's tooltip (item 95) has two sources, both drawn by one
 * `TooltipLayer`:
 *
 * - a `data-tip="…"` attribute on any element, which the layer finds for
 *   itself from the pointer and from keyboard focus; and
 * - a pointer-following tip that a canvas view sets from its own pointer
 *   handler, through this module, because what is under the pointer on a
 *   canvas is not an element the layer could watch.
 *
 * The second is a tiny store rather than React state: a canvas calls
 * `followTooltip` on every pointer move, and the layer answers by moving one
 * DOM node, so no component re-renders for it.
 */

export interface FollowTip {
  readonly text: string;
  /** Viewport (client) coordinates of the pointer the tip follows. */
  readonly x: number;
  readonly y: number;
}

type Listener = () => void;

let follow: FollowTip | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

/** Show `text` beside the pointer at client `(x, y)`, at once; moves it when already shown. */
export function followTooltip(text: string, x: number, y: number): void {
  if (follow !== null && follow.text === text && follow.x === x && follow.y === y) return;
  follow = { text, x, y };
  notify();
}

/** Take the pointer-following tip away; a no-op when there is none. */
export function hideFollowTooltip(): void {
  if (follow === null) return;
  follow = null;
  notify();
}

export function currentFollowTooltip(): FollowTip | null {
  return follow;
}

export function subscribeTooltip(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
