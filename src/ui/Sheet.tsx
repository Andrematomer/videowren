import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

/**
 * A project-level panel (Help, Canvas, Settings, Export, Timeline). It is the same panel as the clip drawer
 * (`.drawer`): it rises over the lower timeline, keeps the tab bar visible, and closes with the corner x,
 * a touch outside it, or Escape.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class="drawer sheet-panel" role="dialog" aria-label={title}>
      <div class="drawer-head">
        <strong>{title}</strong>
        <button class="x-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div class="sheet-body">{children}</div>
    </div>
  );
}
