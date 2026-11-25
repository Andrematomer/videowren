import { useEffect, useRef } from 'preact/hooks';

/**
 * A horizontal loudness bar: green to red, a thin peak marker that falls back slowly, and a light at the right end that turns red
 * for a moment whenever the sound reaches the top (clipping: the loudest the device can play, anything above is cut off).
 */
export function LevelBar({ read, label, class: cls = '' }: { read: () => { peak: number; rms: number }; label: string; class?: string }) {
  const fill = useRef<HTMLSpanElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const clip = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let hold = 0; // the peak marker, 0 to 1
    let clipUntil = 0;
    const toPos = (v: number) => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(v, 1e-5)) + 60) / 60)); // -60 dB to 0 dB
    const tick = () => {
      const { peak, rms } = read();
      const now = performance.now();
      const p = toPos(rms);
      const pk = toPos(peak);
      hold = Math.max(pk, hold - 0.012);
      if (peak >= 0.99) clipUntil = now + 1200;
      if (fill.current) fill.current.style.transform = `scaleX(${p})`;
      if (mark.current) mark.current.style.left = `${hold * 100}%`;
      if (clip.current) clip.current.classList.toggle('on', now < clipUntil);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [read]);
  return (
    <div class={`level-bar ${cls}`} role="img" aria-label={label}>
      <div class="level-track">
        <span class="level-fill" ref={fill} />
        <span class="level-mark" ref={mark} />
      </div>
      <span class="level-clip" ref={clip} title="Lights up when the sound is too loud" />
    </div>
  );
}
