/**
 * The capsule on top of the preview: says what just happened ("Undo", "Split", "Edit mode"...) or what a held action is doing
 * ("Trim 1.20 s", "Crop 12%"). A one-off message stays about a second; a held one stays until the finger lets go, and
 * every message stays at least a moment, so it never flashes for a single frame.
 */
const MIN_MS = 750;
let timer = 0;
let minUntil = 0;
let holding = false;

const el = (): HTMLElement | null => document.querySelector('.gesture-badge');

// the capsule rides above the finger (the average of all of them when there are several), so the eyes stay where the hand is
const fingers = new Map<number, { x: number; y: number; t: number }>();
let last: { x: number; y: number } | null = null;
let queued = false;
function place(): void {
  queued = false;
  const b = el();
  if (!b || !last) return;
  // several fingers: the capsule sits above their average position
  let top = last;
  if (fingers.size) {
    let sx = 0;
    let sy = 0;
    for (const f of fingers.values()) (sx += f.x), (sy += f.y);
    top = { x: sx / fingers.size, y: sy / fingers.size };
  }
  const w = b.offsetWidth || 60;
  const x = Math.min(window.innerWidth - w / 2 - 6, Math.max(w / 2 + 6, top.x));
  b.classList.add('follow');
  b.style.left = `${x}px`;
  b.style.top = `${Math.max(8, top.y - 58)}px`;
}
const queuePlace = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(place);
};
if (typeof window !== 'undefined') {
  const track = (e: PointerEvent) => {
    // a new first finger starts a new gesture: any finger whose lift was never reported is forgotten
    if (e.type === 'pointerdown' && e.isPrimary) fingers.clear();
    const p = { x: e.clientX, y: e.clientY, t: performance.now() };
    fingers.set(e.pointerId, p);
    last = p;
    queuePlace();
  };
  const gone = (e: PointerEvent) => {
    fingers.delete(e.pointerId);
  };
  window.addEventListener('pointerdown', track, true);
  window.addEventListener('pointermove', (e) => (fingers.has(e.pointerId) ? track(e) : e.pointerType !== 'touch' && (last = { x: e.clientX, y: e.clientY })), true);
  window.addEventListener('pointerup', gone, true);
  window.addEventListener('pointercancel', gone, true);
}
const isFine = (b: HTMLElement) => b.textContent === 'FINE';

function clear(): void {
  const b = el();
  if (!b || holding || isFine(b)) return;
  b.textContent = '';
  b.classList.remove('on');
}

/** a one-off message */
export function say(text: string, ms = 1100): void {
  const b = el();
  if (!b || isFine(b)) return;
  holding = false;
  b.textContent = text;
  b.classList.add('on');
  queuePlace();
  clearTimeout(timer);
  minUntil = performance.now() + Math.min(ms, MIN_MS);
  timer = window.setTimeout(clear, ms);
}

/** a message that follows an action that is still going on: call again to change the text, `release()` when it ends */
export function hold(text: string): void {
  const b = el();
  if (!b || isFine(b)) return;
  if (!holding) minUntil = performance.now() + MIN_MS;
  holding = true;
  clearTimeout(timer);
  b.textContent = text;
  b.classList.add('on');
  queuePlace();
}

export function release(): void {
  if (!holding) return;
  holding = false;
  clearTimeout(timer);
  timer = window.setTimeout(clear, Math.max(250, minUntil - performance.now()));
}

/** the FINE label: stays until `endFine()` and nothing else may replace it */
export function startFine(): void {
  const b = el();
  if (!b) return;
  clearTimeout(timer);
  holding = false;
  b.textContent = 'FINE';
  b.classList.add('on');
  queuePlace();
}
export function endFine(): void {
  const b = el();
  if (b && isFine(b)) (b.textContent = ''), b.classList.remove('on');
}
/** hides whatever the capsule shows right now, unless it is FINE */
export function hide(): void {
  clear();
}
