/**
 * The app's own mark, in the header beside the wordmark.
 *
 * Drawn inline rather than loaded from `resources/icon.png`: it has to sit at
 * 20px next to 20px text, and a downscaled 512px bitmap is soft exactly where
 * the eye is most critical. The geometry is the same as the icon script's - the
 * shouldered taper, the vent hole, the slit - so the window and the taskbar show
 * one mark.
 */
export function NibMark({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="url(#nib-brass)"
      strokeWidth={6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="nib-brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e8b55c" />
          <stop offset="1" stopColor="#c97e3e" />
        </linearGradient>
      </defs>
      {/* Shoulders, then the taper down to the point. */}
      <path d="M25.5 13 H74.5 C74.5 45 63 74 50 90 C37 74 25.5 45 25.5 13 Z" />
      <circle cx="50" cy="44" r="7.5" />
      <path d="M50 52 V86" />
    </svg>
  )
}
