/** Where files that are being dragged over a timeline lane would land (written by the timeline while they hover, read by the drop). */
export const aim: { value: { track: number; at: number } | null } = { value: null };

/** a finger covers what is right under it: on a touch screen the aim sits above the fingertip (a mouse has no such need) */
export const lift = (): number => 0; // (the timeline is made taller while a card is carried, so the outline can sit right under the finger)
/** ... and to the left of it (a right thumb comes from the lower right) */
export const liftX = (): number => 0;
/** the timeline lane and the preview area under the aim of a finger at (x, y) */
export const whereAt = (x: number, y: number): { lane: Element | null; stage: Element | null } => {
  let els = document.elementsFromPoint(x - liftX(), y - lift());
  if (!els.some((e) => e.classList.contains('tl-lane'))) {
    // a finger at the very left or right of the screen is outside the lanes but still over the timeline: it counts as the lane there
    const sc = document.querySelector('.tl-scroll')?.getBoundingClientRect();
    if (sc && y >= sc.top && y <= sc.bottom && (x < sc.left + 2 || x > sc.right - 2)) els = document.elementsFromPoint(Math.max(sc.left + 3, Math.min(sc.right - 3, x)), y);
  }
  let lane = els.find((e) => e.classList.contains('tl-lane')) ?? null;
  if (!lane) {
    // empty space of the timeline (under the last lane, between lanes) belongs to the closest lane
    const sc = document.querySelector('.tl-scroll')?.getBoundingClientRect();
    if (sc && y >= sc.top && y <= sc.bottom) {
      let best = Infinity;
      for (const l of document.querySelectorAll('.tl-lane')) {
        const r = l.getBoundingClientRect();
        const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (d < best) (best = d), (lane = l);
      }
    }
  }
  return { lane, stage: els.find((e) => e.classList.contains('stage')) ?? null };
};
export interface DropPreview {
  x: number;
  y: number;
  /** one entry per item: true for a sound */
  kinds: boolean[];
  /** length in seconds of each item (3 when not known) */
  durs?: number[];
  /** where the finger really is (x and y are the aim, up and to the left of it) */
  fx?: number;
  mode: 'lane' | 'stage';
  /** a strip of the timeline being carried: no lanes are opened for it (the timeline must not change under the finger that holds it) */
  quiet?: boolean;
}
/** shows (or with null hides) the yellow outlines of where the items would land */
/** the lanes opened for a drag close again */
export const endDrop = (): void => {
  showDropPreview(null);
  window.dispatchEvent(new CustomEvent('pc-lanes', { detail: 'reset' }));
};
export const showDropPreview = (detail: DropPreview | null): void => {
  window.dispatchEvent(new CustomEvent('pc-drop-preview', { detail }));
};

/** the drag of files in the page (App.tsx owns it): the Import tab feeds its own drag into the same thing, so both look and land alike */
export interface DragCtl {
  move(x: number, y: number, kinds: boolean[], durs?: number[]): void;
  /** the finger let go: where it would land (the outlines stay until the caller hides them) */
  end(): { lane: boolean; stage: boolean; target: { track: number; at: number } | null; pos: { x: number; y: number } };
  cancel(): void;
}
export const dragCtl: { cur: DragCtl | null } = { cur: null };
