import { setSettings, useStore } from '../store.ts';
import type { AspectChoice } from '../types.ts';
import { ColorRow } from './Drawer.tsx';
import { Plain } from './Fold.tsx';
import { Sheet } from './Sheet.tsx';

export const ASPECT_LABEL: Record<AspectChoice, string> = { '9:16': '9:16', '4:5': '4:5', '1:1': '1:1', '5:4': '5:4', '16:9': '16:9' };
const ASPECTS: AspectChoice[] = ['9:16', '4:5', '1:1', '5:4', '16:9'];

/** The shape of the exported picture, and how the selected clip sits in it. */
export function CanvasSheet({ onClose }: { onClose: () => void }) {
  const aspect = useStore((s) => s.project.settings.aspect);
  const bg = useStore((s) => s.project.settings.background);
  return (
    <Sheet title="Canvas" onClose={onClose}>
      <Plain title="Ratio">
        <div class="chips" role="group" aria-label="Canvas shape">
          {ASPECTS.map((a) => (
            <button key={a} class={`chip num ${aspect === a ? 'on' : ''}`} aria-pressed={aspect === a} onClick={() => setSettings({ aspect: a })}>
              {ASPECT_LABEL[a]}
            </button>
          ))}
        </div>
      </Plain>
      <Plain title="Background color">
        <ColorRow label="Background color" value={bg} onPick={(c) => setSettings({ background: c })} />
      </Plain>
    </Sheet>
  );
}
