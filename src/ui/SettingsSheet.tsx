import { useState } from 'preact/hooks';
import { discardProject, setPrefs, useStore } from '../store.ts';
import { hapticSupported, haptic } from '../haptic.ts';
import { Plain } from './Fold.tsx';
import { Sheet } from './Sheet.tsx';
import { Slider } from './Slider.tsx';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const prefs = useStore((s) => s.prefs);
  const hasProject = useStore((s) => s.project.clips.length > 0);
  const [confirm, setConfirm] = useState(false);

  return (
    <Sheet title="Settings" onClose={onClose}>
      <section>
        <h3>New pictures stay for</h3>
        <div class="chips" role="group" aria-label="Default picture duration">
          {[2, 3, 5, 7, 10].map((n) => (
            <button key={n} class={`chip num ${prefs.imageSeconds === n ? 'on' : ''}`} aria-pressed={prefs.imageSeconds === n} onClick={() => setPrefs({ imageSeconds: n })}>
              {n} s
            </button>
          ))}
        </div>
      </section>

      <Plain title="Preview quality">
        <div class="chips" role="group" aria-label="Preview size">
          {[144, 240, 360].map((n) => (
            <button
              key={n}
              class={`chip num ${prefs.previewLong === n ? 'on' : ''}`}
              aria-pressed={prefs.previewLong === n}
              onClick={() => {
                if (prefs.previewLong === n) return;
                setPrefs({ previewLong: n });
              }}
            >
              {n}p
            </button>
          ))}
        </div>
        
      </Plain>

      <Plain title="Keep the screen on">
        <div class="chips" role="group" aria-label="Keep the screen on">
          {([['on', 'Always'], ['work', 'While rendering'], ['off', 'Never']] as const).map(([v, label]) => (
            <button key={v} class={`chip ${prefs.awake === v ? 'on' : ''}`} aria-pressed={prefs.awake === v} onClick={() => setPrefs({ awake: v })}>
              {label}
            </button>
          ))}
        </div>
        
      </Plain>

      <Plain title="When playback ends">
        <div class="chips" role="group" aria-label="When playback ends">
          {([['pause', 'Pause'], ['stop', 'Stop'], ['loop', 'Loop'], ['return', 'Return']] as const).map(([v, label]) => (
            <button key={v} class={`chip ${prefs.onEnd === v ? 'on' : ''}`} aria-pressed={prefs.onEnd === v} onClick={() => setPrefs({ onEnd: v })}>
              {label}
            </button>
          ))}
        </div>
        
      </Plain>

      <Plain title="Timeline strip height">
        <div class="chips" role="group" aria-label="Timeline strip height mode">
          <button class={`chip ${prefs.rowAuto ? 'on' : ''}`} aria-pressed={prefs.rowAuto} onClick={() => setPrefs({ rowAuto: true })}>
            Auto
          </button>
          <button class={`chip ${!prefs.rowAuto ? 'on' : ''}`} aria-pressed={!prefs.rowAuto} onClick={() => setPrefs({ rowAuto: false })}>
            Manual
          </button>
        </div>
        {!prefs.rowAuto && (
          <div class="rate-slider">
            <div class="rate-now num">{Math.round(prefs.rowScale * 100)}%</div>
            <Slider label="Timeline strip height" value={prefs.rowScale} min={0.5} max={2} step={0.05} fineStep={0.01} snaps={[1]} snapPx={14} valueText={`${Math.round(prefs.rowScale * 100)} percent`} onChange={(v) => setPrefs({ rowScale: Math.round(v * 100) / 100 })} />
          </div>
        )}
      </Plain>

      {hapticSupported && (
        <Plain title="Vibration">
          <div class="chips" role="group" aria-label="Vibration feedback">
            {([[true, 'On'], [false, 'Off']] as const).map(([v, label]) => (
              <button key={label} class={`chip ${prefs.haptics === v ? 'on' : ''}`} aria-pressed={prefs.haptics === v} onClick={() => { setPrefs({ haptics: v }); if (v) haptic(12); }}>
                {label}
              </button>
            ))}
          </div>
        </Plain>
      )}

      <Plain title="Project">
        {!confirm ? (
          <button class="btn danger" disabled={!hasProject} onClick={() => setConfirm(true)}>
            Delete project
          </button>
        ) : (
          <>
            <p class="warn">This deletes every strip and the original videos stored on this device. It cannot be undone. Are you sure?</p>
            <div class="row">
              <button
                class="btn danger"
                onClick={async () => {
                  await discardProject();
                  onClose();
                }}
              >
                Yes, delete project
              </button>
              <button class="btn" onClick={() => setConfirm(false)}>
                Keep it
              </button>
            </div>
          </>
        )}
      </Plain>
    </Sheet>
  );
}
