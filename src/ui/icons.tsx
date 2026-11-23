import type { ComponentChildren } from 'preact';

const I = ({ children, size = 22 }: { children: ComponentChildren; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const Play = () => (
  <I size={26}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </I>
);
export const Pause = () => (
  <I size={26}>
    <path d="M8 5v14M16 5v14" stroke-width="3.2" />
  </I>
);
export const Plus = () => (
  <I>
    <path d="M12 5v14M5 12h14" />
  </I>
);
export const Trim = () => (
  <I>
    <path d="M9 4H5v16h4M15 4h4v16h-4M12 9v6" />
  </I>
);
export const Speed = () => (
  <I>
    <path d="M4 17a8 8 0 1 1 16 0M12 17l4-5" />
  </I>
);
export const Rotate = () => (
  <I>
    <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5" />
  </I>
);
export const RotateL = () => (
  <I>
    <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5" />
  </I>
);
export const Crop = () => (
  <I>
    <path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" />
  </I>
);
export const Sound = () => (
  <I>
    <path d="M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
  </I>
);
export const Mute = () => (
  <I>
    <path d="M4 10v4h3l5 4V6L7 10zM16 9l5 6M21 9l-5 6" />
  </I>
);
export const Clips = () => (
  <I>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M8 6v12M16 6v12" />
  </I>
);
export const Split = () => (
  <I>
    <path d="M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4" />
  </I>
);
export const Trash = () => (
  <I>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </I>
);
export const Copy = () => (
  <I>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </I>
);
export const Left = () => (
  <I>
    <path d="M14 6l-6 6 6 6" />
  </I>
);
export const Right = () => (
  <I>
    <path d="M10 6l6 6-6 6" />
  </I>
);
export const Info = () => (
  <I>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6" stroke-width="2.2" />
    <circle cx="12" cy="7.6" r="0.6" fill="currentColor" stroke-width="1.4" />
  </I>
);
export const Share = () => (
  <I>
    <path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </I>
);
export const Download = () => (
  <I>
    <path d="M12 3v12M8 11l4 4 4-4M5 20h14" />
  </I>
);
export const Close = () => (
  <I>
    <path d="M6 6l12 12M18 6L6 18" />
  </I>
);
export const Check = () => (
  <I size={20}>
    <path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.4" />
  </I>
);
export const Help = () => (
  <I>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke-width="1.4" />
  </I>
);
export const Undo = () => (
  <I>
    <path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -4)" />
  </I>
);
export const Redo = () => (
  <I>
    <path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12" transform="translate(0 -4)" />
  </I>
);
export const Gear = () => (
  <I>
    <circle cx="12" cy="12" r="3" />
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
  </I>
);
export const Order = () => (
  <I>
    <path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4" />
  </I>
);
export const Look = () => (
  <I>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17" />
    <path d="M12 12h8.5" />
  </I>
);
export const Effects = () => (
  <I>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </I>
);
export const Layers = () => (
  <I>
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </I>
);
const Glyph = ({ children, outline = false }: { children: string; outline?: boolean }) => (
  <I>
    <text x="12" y="17" text-anchor="middle" font-size="15" font-weight="800" font-family="system-ui, sans-serif" fill={outline ? 'none' : 'currentColor'} stroke="currentColor" stroke-width={outline ? 1.2 : 0}>
      {children}
    </text>
  </I>
);
export const TextIcon = () => <Glyph>T</Glyph>;
export const FontIcon = () => <Glyph>Aa</Glyph>;
export const OutlineIcon = () => <Glyph outline>A</Glyph>;
export const Swatch = () => (
  <I>
    <circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" />
  </I>
);
export const Shrink = () => (
  <I>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </I>
);

export const Camera = () => (
  <I>
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </I>
);

// icons below are from lucide.dev (ISC license)
export const Simplify = () => (
  <I>
    <path d="M12 22v-6M12 8V2m3 17-3-3-3 3m6-14-3 3-3-3M22 12H2" />
  </I>
);
export const GapH = () => (
  <I>
    <path d="M12 2v2M12 8v2M12 14v2M12 20v2M21 3h-3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M3 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3" />
  </I>
);
export const PasteIcon = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M11 14h10M16 4h2a2 2 0 0 1 2 2v1.344m-3 10.656 4-4-4-4M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
  </I>
);
export const ImageIcon = ({ size }: { size?: number }) => (
  <I size={size}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </I>
);
export const TypeIcon = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M12 4v16M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2M9 20h6" />
  </I>
);
export const PaletteIcon = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
  </I>
);
export const AfterIcon = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M17 12H3m8 6 6-6-6-6m10-1v14" />
  </I>
);
export const LayersIcon = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74z" />
    <path d="m20 14.285 1.5.845a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74l1.5-.845" />
  </I>
);
export const ClockIcon = ({ size }: { size?: number }) => (
  <I size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </I>
);
export const ReplaceIcon = ({ size }: { size?: number }) => (
  <I size={size}>
    <path d="M14 4a1 1 0 0 1 1-1M15 10a1 1 0 0 1-1-1m7-5a1 1 0 0 0-1-1m1 6a1 1 0 0 1-1 1M3 7l3 3 3-3m-3 3V5a2 2 0 0 1 2-2h2" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </I>
);
export const MicIcon = ({ size }: { size?: number }) => (
  <I size={size}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
  </I>
);
