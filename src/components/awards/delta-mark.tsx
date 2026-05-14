type DeltaMarkTone = 'auto' | 'light' | 'dark' | 'mono-ink' | 'mono-white';

export function DeltaMark({
  size = 16,
  tone = 'dark',
}: {
  size?: number;
  tone?: DeltaMarkTone;
}) {
  const ink = '#1F2A33';
  const white = '#FFFFFF';
  const red = '#E03E36';

  if (tone === 'mono-ink' || tone === 'mono-white') {
    const c = tone === 'mono-ink' ? ink : white;
    return (
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
        <rect x="34" y="34" width="110" height="110" fill="none" stroke={c} strokeWidth="10" />
        <rect x="56" y="56" width="110" height="110" fill={c} />
        <path d="M 70 34 L 80 18 L 90 34 Z" fill={c} />
        <path d="M 110 34 L 120 18 L 130 34 Z" fill={c} />
      </svg>
    );
  }

  const stroke = tone === 'light' ? white : ink;
  const innerSquare = tone === 'light' ? white : ink;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
      <rect x="34" y="34" width="110" height="110" fill="none" stroke={stroke} strokeWidth="6" />
      <rect x="56" y="56" width="110" height="110" fill={red} />
      <rect x="56" y="56" width="88" height="88" fill={innerSquare} />
      <path d="M 70 34 L 80 18 L 90 34 Z" fill={stroke} />
      <path d="M 110 34 L 120 18 L 130 34 Z" fill={stroke} />
    </svg>
  );
}
