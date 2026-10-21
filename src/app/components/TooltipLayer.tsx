import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { currentFollowTooltip, hideFollowTooltip, subscribeTooltip } from './tooltip';

/** The tooltip node's id: `aria-describedby` on the element it describes points at it. */
export const TOOLTIP_ID = 'app-tooltip';
/** How long the pointer rests on a control before its tip shows. */
export const SHOW_DELAY_MS = 300;
/** For this long after a tip went away, the next control's tip shows at once. */
export const WARM_MS = 250;
/** Least gap kept between the tip and the window's edges, px. */
const EDGE = 8;
/** Gap between a control and its tip, px. */
const GAP = 6;
/** Where a pointer-following tip sits relative to the pointer, px. */
const POINTER_DX = 14;
const POINTER_DY = 18;

/**
 * The one tooltip of the app (item 95): a fixed node that the layer moves
 * under the control the pointer rests on, or beside the pointer for a canvas
 * view's `followTooltip`. Mounted once, in `App`; it watches the document
 * for `data-tip` elements itself, so a control adopts it by carrying
 * `data-tip="…"` where it used to carry `title`.
 *
 * - Pointer: shows `SHOW_DELAY_MS` after the pointer arrives on a tipped
 *   element, or at once when another tip was showing a moment ago, as a
 *   toolbar is read control by control. Touch never shows one: a tap is a
 *   click, and the tip must not be information that a phone cannot reach.
 * - Keyboard: a tipped control shows its tip when focus reaches it from the
 *   keyboard, for as long as it has it; Escape hides it.
 * - Hidden by a pointer down, a scroll, a resize or losing the window: all of
 *   them move or change what the tip was about.
 * - While shown for an element, that element is `aria-describedby` the tip,
 *   so the description a `title` gave assistive technology is kept.
 * - Kept inside the window: centred under the control, above it when there
 *   is no room below, and clamped to the sides.
 */
export function TooltipLayer() {
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = node.current;
    if (el === null) return;

    /** The tipped element the pointer is on, shown or still waiting. */
    let anchor: Element | null = null;
    /** The element the shown tip describes, when it is shown for one. */
    let shownFor: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** When an element's tip last went away, for the warm window. */
    let hiddenAt = -Infinity;
    /** Whether the last input was from the keyboard, as `:focus-visible` decides. */
    let keyboard = false;
    /** The size of the node for the text it shows, measured once per text. */
    let measuredFor = '';
    let width = 0;
    let height = 0;

    const clearTimer = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    /** Show the node with `text`, measuring it only when the text is new. */
    const setText = (text: string): void => {
      if (el.hidden) el.hidden = false;
      if (measuredFor === text) return;
      el.textContent = text;
      const r = el.getBoundingClientRect();
      width = r.width;
      height = r.height;
      measuredFor = text;
    };

    const viewport = (): { vw: number; vh: number } => ({
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight,
    });

    const placeAt = (left: number, top: number): void => {
      el.style.translate = `${Math.round(left)}px ${Math.round(top)}px`;
    };

    const placeUnder = (target: Element): void => {
      const r = target.getBoundingClientRect();
      const { vw, vh } = viewport();
      let left = r.left + r.width / 2 - width / 2;
      let top = r.bottom + GAP;
      if (vw > 0) {
        left = Math.max(EDGE, Math.min(left, vw - EDGE - width));
        if (top + height > vh - EDGE) top = Math.max(EDGE, r.top - GAP - height);
      }
      placeAt(left, top);
    };

    const placeBeside = (x: number, y: number): void => {
      const { vw, vh } = viewport();
      let left = x + POINTER_DX;
      let top = y + POINTER_DY;
      if (vw > 0) {
        if (left + width > vw - EDGE) left = Math.max(EDGE, x - POINTER_DX - width);
        if (top + height > vh - EDGE) top = Math.max(EDGE, y - POINTER_DY - height);
      }
      placeAt(left, top);
    };

    const describe = (target: Element): void => {
      const was = target.getAttribute('aria-describedby');
      if (was === null) target.setAttribute('aria-describedby', TOOLTIP_ID);
      else if (!was.split(/\s+/).includes(TOOLTIP_ID))
        target.setAttribute('aria-describedby', `${was} ${TOOLTIP_ID}`);
    };

    const undescribe = (target: Element): void => {
      const was = target.getAttribute('aria-describedby');
      if (was === null) return;
      const rest = was
        .split(/\s+/)
        .filter((id) => id !== '' && id !== TOOLTIP_ID)
        .join(' ');
      if (rest === '') target.removeAttribute('aria-describedby');
      else target.setAttribute('aria-describedby', rest);
    };

    /** Draw what the state says: the following tip first, else the element's, else nothing. */
    const render = (): void => {
      const follow = currentFollowTooltip();
      if (follow !== null) {
        setText(follow.text);
        placeBeside(follow.x, follow.y);
        return;
      }
      if (shownFor !== null) {
        const text = shownFor.getAttribute('data-tip') ?? '';
        setText(text);
        placeUnder(shownFor);
        return;
      }
      if (!el.hidden) el.hidden = true;
    };

    const hideElementTip = (): void => {
      clearTimer();
      if (shownFor === null) return;
      undescribe(shownFor);
      shownFor = null;
      hiddenAt = performance.now();
      render();
    };

    const showElementTip = (target: Element): void => {
      clearTimer();
      if (shownFor === target) return;
      if (shownFor !== null) undescribe(shownFor);
      shownFor = target;
      describe(target);
      render();
    };

    const tipOf = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) return null;
      const tipped = target.closest('[data-tip]');
      if (tipped === null) return null;
      const text = tipped.getAttribute('data-tip');
      return text === null || text === '' ? null : tipped;
    };

    const onPointerOver = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;
      const next = tipOf(e.target);
      if (next === anchor) return;
      clearTimer();
      anchor = next;
      if (next === null) {
        hideElementTip();
        return;
      }
      if (shownFor !== null || performance.now() - hiddenAt < WARM_MS) showElementTip(next);
      else
        timer = setTimeout(() => {
          timer = undefined;
          if (anchor === next && next.isConnected) showElementTip(next);
        }, SHOW_DELAY_MS);
    };

    const onPointerOut = (e: PointerEvent): void => {
      if (anchor === null) return;
      const to = e.relatedTarget;
      if (to instanceof Node && anchor.contains(to)) return;
      anchor = null;
      hideElementTip();
    };

    const onPointerDown = (): void => {
      keyboard = false;
      anchor = null;
      hideElementTip();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      keyboard = true;
      if (e.key === 'Escape') {
        anchor = null;
        hideElementTip();
      }
    };

    const onFocusIn = (e: FocusEvent): void => {
      if (!keyboard) return;
      const next = tipOf(e.target);
      if (next === null) return;
      anchor = next;
      showElementTip(next);
    };

    const onFocusOut = (e: FocusEvent): void => {
      if (shownFor !== null && shownFor === e.target) {
        anchor = null;
        hideElementTip();
      }
    };

    const onMoved = (): void => {
      anchor = null;
      hideElementTip();
      // A following tip is the view's to bring back on the next move.
      hideFollowTooltip();
    };

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener('pointerover', onPointerOver, opts);
    document.addEventListener('pointerout', onPointerOut, opts);
    document.addEventListener('pointerdown', onPointerDown, opts);
    document.addEventListener('keydown', onKeyDown, opts);
    document.addEventListener('focusin', onFocusIn, opts);
    document.addEventListener('focusout', onFocusOut, opts);
    document.addEventListener('scroll', onMoved, opts);
    window.addEventListener('resize', onMoved, opts);
    window.addEventListener('blur', onMoved, opts);
    const unsubscribe = subscribeTooltip(render);

    return () => {
      clearTimer();
      if (shownFor !== null) undescribe(shownFor);
      document.removeEventListener('pointerover', onPointerOver, opts);
      document.removeEventListener('pointerout', onPointerOut, opts);
      document.removeEventListener('pointerdown', onPointerDown, opts);
      document.removeEventListener('keydown', onKeyDown, opts);
      document.removeEventListener('focusin', onFocusIn, opts);
      document.removeEventListener('focusout', onFocusOut, opts);
      document.removeEventListener('scroll', onMoved, opts);
      window.removeEventListener('resize', onMoved, opts);
      window.removeEventListener('blur', onMoved, opts);
      unsubscribe();
    };
  }, []);

  return createPortal(
    <div id={TOOLTIP_ID} className="tooltip" role="tooltip" hidden ref={node} />,
    document.body,
  );
}
