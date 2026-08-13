export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 312 312" className={className} aria-hidden="true">
      <g fill="#2fbf71">
        <rect x="0" y="0" width="88" height="88" rx="22" opacity="0.18" />
        <rect x="112" y="0" width="88" height="88" rx="22" opacity="0.45" />
        <rect x="224" y="0" width="88" height="88" rx="22" />
        <rect x="0" y="112" width="88" height="88" rx="22" opacity="0.45" />
        <rect x="112" y="112" width="88" height="88" rx="22" />
        <rect x="224" y="112" width="88" height="88" rx="22" opacity="0.45" />
        <rect x="0" y="224" width="88" height="88" rx="22" />
        <rect x="112" y="224" width="88" height="88" rx="22" opacity="0.45" />
        <rect x="224" y="224" width="88" height="88" rx="22" opacity="0.18" />
      </g>
    </svg>
  )
}
