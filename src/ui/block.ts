/**
 * While something is held (a card carried from the Import tab, a voice being recorded) only the finger that does it may touch the app:
 * every event of any other finger is swallowed before it reaches a button, the timeline or the preview. `allow` says which elements still work.
 * Returns the function that lifts the block.
 */
export function blockOtherFingers(allow: (el: Element) => boolean): () => void {
  const block = (e: Event) => {
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && allow(t)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const opts = { capture: true, passive: false } as const;
  const names = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'gesturestart', 'gesturechange', 'gestureend', 'wheel'];
  names.forEach((n) => window.addEventListener(n, block, opts));
  return () => names.forEach((n) => window.removeEventListener(n, block, opts));
}
