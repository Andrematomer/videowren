import { startPills } from './pill.ts';
import { Component, render, type ComponentChildren } from 'preact';
import './styles.css';
import { toast } from './store.ts';
import { App } from './ui/App.tsx';

// The app is not a web page: no pinch zoom. Safari ignores user-scalable=no, but honours this.
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());

/** If something in the UI throws, show it instead of a blank screen. */
class Boundary extends Component<{ children: ComponentChildren }, { error: Error | null }> {
  state = { error: null as Error | null };
  componentDidCatch(error: Error) {
    this.setState({ error });
  }
  render() {
    if (!this.state.error) return this.props.children;
    // every crash looks the same: the people who see it are on devices the app was not built for, and must not report it
    console.error(this.state.error);
    return (
      <main class="fatal danger-page">
        <div class="danger-sign" aria-hidden="true">
          !
        </div>
        <h1>This device isn't supported</h1>
        <p>VideoWren is built for phones: an iPhone with iOS 16.4 or newer (Safari), or an Android phone with a recent Chrome. Anything else may crash, and this is what that looks like.</p>
        <p>This is not a bug to report. Open VideoWren on a supported phone and it will work.</p>
      </main>
    );
  }
}

// every touched button grows for a moment and settles back: a slow response (the iPhone color picker) still feels registered
window.addEventListener(
  'pointerdown',
  (e) => {
    const b = (e.target as Element | null)?.closest?.('button, [role="button"], label.pick-label, .color-block, .swatch');
    if (!b || b.closest('.strip-clip, .gap-trash, .fold-title, .seg, .chips') || (b as HTMLButtonElement).disabled) return;
    b.classList.remove('tap');
    void (b as HTMLElement).offsetWidth;
    b.classList.add('tap');
  },
  true,
);
// segmented values and chips: the yellow jumps to the new value first, then that yellow button pops
window.addEventListener(
  'click',
  (e) => {
    const b = (e.target as Element | null)?.closest?.('.seg button, .chips .chip') as HTMLElement | null;
    if (!b || (b as HTMLButtonElement).disabled) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        b.classList.remove('tap');
        void b.offsetWidth;
        b.classList.add('tap');
      }),
    );
  },
  true,
);
startPills();
document.addEventListener('animationend', (e) => (e.target as Element).classList?.remove('tap'), true);

render(
  <Boundary>
    <App />
  </Boundary>,
  document.getElementById('app')!,
);
document.getElementById('boot')?.remove();

// Offline support. Only in the production build: the dev server must never be cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('A new version is ready.', { label: 'Reload', run: () => location.reload() }, 15000);
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is a bonus; the editor still works without it */
    });
  });
}
