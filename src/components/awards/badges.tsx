import { DeltaMark } from './delta-mark';

// ============================================================
// SplitShield, shields.io idiom, Lastest skin
// ============================================================

type Tone = 'teal' | 'red' | 'amber' | 'blue' | 'ink';
type Size = 'sm' | 'md' | 'lg';

export function SplitShield({
  label = 'LASTEST',
  value = 'passing',
  tone = 'teal',
  size = 'md',
  dark = false,
  mark = true,
  dot = false,
}: {
  label?: string;
  value?: string;
  tone?: Tone;
  size?: Size;
  dark?: boolean;
  mark?: boolean;
  dot?: boolean;
}) {
  const heights = { sm: 20, md: 26, lg: 34 };
  const padX = { sm: 8, md: 10, lg: 14 };
  const gap = { sm: 6, md: 7, lg: 9 };
  const labelFs = { sm: 9.5, md: 10.5, lg: 12.5 };
  const valueFs = { sm: 11, md: 12.5, lg: 15 };
  const markSize = { sm: 11, md: 14, lg: 18 };

  const toneFills: Record<Tone, string> = {
    teal: '#36A88E',
    red: '#E03E36',
    amber: '#E09836',
    blue: '#3674A8',
    ink: '#1F2A33',
  };
  const labelBg = dark ? '#0E1519' : '#1F2A33';

  return (
    <div
      className="lt-shield"
      style={{
        display: 'inline-flex',
        height: heights[size],
        fontFamily: 'var(--font-mono)',
        boxShadow: dark ? 'inset 0 0 0 1px rgba(255,255,255,0.12)' : '0 1px 2px rgba(31,42,51,0.10)',
        borderRadius: 3,
        overflow: 'hidden',
        alignItems: 'stretch',
        verticalAlign: 'middle',
      }}
    >
      <div
        style={{
          background: labelBg,
          color: '#fff',
          padding: `0 ${padX[size]}px`,
          display: 'inline-flex',
          alignItems: 'center',
          gap: gap[size],
          fontSize: labelFs[size],
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {mark && <DeltaMark size={markSize[size]} tone="light" />}
        <span>{label}</span>
      </div>
      <div
        style={{
          background: toneFills[tone],
          color: tone === 'amber' ? '#1F2A33' : '#fff',
          padding: `0 ${padX[size]}px`,
          display: 'inline-flex',
          alignItems: 'center',
          gap: gap[size],
          fontSize: valueFs[size],
          fontWeight: 500,
          fontFamily: 'var(--font-sans)',
          letterSpacing: '-0.005em',
        }}
      >
        {dot && (
          <span
            style={{
              width: size === 'sm' ? 6 : 7,
              height: size === 'sm' ? 6 : 7,
              borderRadius: 999,
              background: '#fff',
              boxShadow: '0 0 0 2px rgba(255,255,255,0.35)',
              flexShrink: 0,
            }}
          />
        )}
        <span style={{ whiteSpace: 'nowrap' }}>{value}</span>
      </div>
    </div>
  );
}

// ============================================================
// Pill, single-fill rounded badge
// ============================================================

type PillTone = 'soft' | 'ink' | 'teal' | 'red' | 'amber' | 'outline';

export function Pill({
  children,
  tone = 'soft',
  size = 'md',
  dark = false,
  mark = true,
  dot = null,
}: {
  children: React.ReactNode;
  tone?: PillTone;
  size?: Size;
  dark?: boolean;
  mark?: boolean;
  dot?: 'pass' | 'fail' | 'live' | null;
}) {
  const heights = { sm: 22, md: 28, lg: 36 };
  const padX = { sm: 9, md: 11, lg: 14 };
  const fs = { sm: 11, md: 12.5, lg: 14.5 };
  const markSize = { sm: 12, md: 15, lg: 19 };

  const surfaces: Record<PillTone, { bg: string; fg: string; border: string }> = {
    soft: dark
      ? { bg: '#2A3640', fg: '#fff', border: 'rgba(255,255,255,0.10)' }
      : { bg: '#fff', fg: '#1F2A33', border: 'rgba(31,42,51,0.10)' },
    ink: { bg: '#1F2A33', fg: '#fff', border: 'rgba(255,255,255,0.06)' },
    teal: { bg: '#36A88E', fg: '#fff', border: 'rgba(31,42,51,0.10)' },
    red: { bg: '#E03E36', fg: '#fff', border: 'rgba(31,42,51,0.10)' },
    amber: { bg: '#E09836', fg: '#1F2A33', border: 'rgba(31,42,51,0.10)' },
    outline: dark
      ? { bg: 'transparent', fg: '#fff', border: 'rgba(255,255,255,0.25)' }
      : { bg: 'transparent', fg: '#1F2A33', border: 'rgba(31,42,51,0.20)' },
  };
  const s = surfaces[tone];

  const dotColors: Record<NonNullable<typeof dot>, string> = {
    pass: '#36A88E',
    fail: '#E03E36',
    live: '#E03E36',
  };

  const useDarkContent = tone === 'amber';
  const onDark =
    tone === 'ink' ||
    tone === 'teal' ||
    tone === 'red' ||
    (tone === 'soft' && dark) ||
    (tone === 'outline' && dark);
  const markTone: 'light' | 'dark' = useDarkContent ? 'dark' : onDark ? 'light' : 'dark';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'sm' ? 6 : size === 'md' ? 8 : 10,
        height: heights[size],
        padding: `0 ${padX[size]}px`,
        background: s.bg,
        color: s.fg,
        boxShadow: `inset 0 0 0 1px ${s.border}`,
        borderRadius: 999,
        fontFamily: 'var(--font-sans)',
        fontSize: fs[size],
        fontWeight: 500,
        letterSpacing: '-0.005em',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      {mark && <DeltaMark size={markSize[size]} tone={markTone} />}
      {dot && (
        <span
          style={{
            width: size === 'sm' ? 6 : 7,
            height: size === 'sm' ? 6 : 7,
            borderRadius: 999,
            background: dotColors[dot],
            boxShadow: dot === 'live' ? '0 0 0 3px rgba(224,62,54,0.20)' : 'none',
            flexShrink: 0,
          }}
        />
      )}
      <span>{children}</span>
    </div>
  );
}

// ============================================================
// Wordmark, locked typography
// ============================================================

export function Wordmark({ size = 14, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <span
      style={{
        fontFamily: 'Archivo, var(--font-sans)',
        fontWeight: 900,
        fontSize: size,
        letterSpacing: '-0.04em',
        color: dark ? '#fff' : '#1F2A33',
        textTransform: 'uppercase',
        lineHeight: 0.9,
      }}
    >
      LAS<span style={{ color: '#E03E36' }}>T</span>EST
    </span>
  );
}

// ============================================================
// CardBadge, horizontal embed
// ============================================================

export function CardBadge({
  status = 'passing',
  tests = 247,
  total = 247,
  cadence = 'every commit',
  lastRun = '12m ago',
  dark = false,
  variant = 'horizontal',
}: {
  status?: 'passing' | 'regression' | 'review';
  tests?: number;
  total?: number;
  cadence?: string;
  lastRun?: string;
  dark?: boolean;
  variant?: 'horizontal' | 'square';
}) {
  const passing = status === 'passing';
  const regression = status === 'regression';

  const surface = dark
    ? {
        bg: '#1F2A33',
        elev: '#2A3640',
        fg: '#fff',
        fg2: 'rgba(255,255,255,0.62)',
        line: 'rgba(255,255,255,0.10)',
      }
    : {
        bg: '#fff',
        elev: '#F6F6F4',
        fg: '#1F2A33',
        fg2: 'rgba(31,42,51,0.62)',
        line: 'rgba(31,42,51,0.08)',
      };

  const statusTone = passing ? '#36A88E' : regression ? '#E03E36' : '#E09836';
  const statusLabel = passing ? 'all tests passing' : regression ? 'regression detected' : 'review required';

  if (variant === 'square') {
    return (
      <div
        style={{
          width: 200,
          height: 200,
          background: surface.bg,
          color: surface.fg,
          boxShadow: `inset 0 0 0 1px ${surface.line}`,
          borderRadius: 6,
          padding: 18,
          fontFamily: 'var(--font-sans)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <DeltaMark size={28} tone={dark ? 'light' : 'dark'} />
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: surface.fg2,
              padding: '3px 7px',
              borderRadius: 3,
              boxShadow: `inset 0 0 0 1px ${surface.line}`,
            }}
          >
            v1
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>{tests}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: surface.fg2 }}>/ {total}</div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: statusTone,
                boxShadow: passing ? '0 0 0 3px rgba(54,168,142,0.20)' : 'none',
              }}
            />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{statusLabel}</span>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9.5,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: surface.fg2,
              display: 'flex',
              gap: 10,
            }}
          >
            <span>{cadence}</span>
            <span>·</span>
            <span>{lastRun}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        background: surface.bg,
        color: surface.fg,
        boxShadow: `inset 0 0 0 1px ${surface.line}, 0 2px 4px rgba(31,42,51,0.06)`,
        borderRadius: 6,
        fontFamily: 'var(--font-sans)',
        alignItems: 'stretch',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          background: surface.elev,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          borderRight: `1px solid ${surface.line}`,
        }}
      >
        <DeltaMark size={28} tone={dark ? 'light' : 'dark'} />
      </div>
      <div style={{ padding: '10px 16px 10px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9.5,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: surface.fg2,
            marginBottom: 3,
            display: 'flex',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <span>tested with</span>
          <Wordmark size={9.5} dark={dark} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: statusTone,
              boxShadow: passing
                ? '0 0 0 3px rgba(54,168,142,0.20)'
                : regression
                  ? '0 0 0 3px rgba(224,62,54,0.20)'
                  : '0 0 0 3px rgba(224,152,54,0.20)',
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: 14.5, fontWeight: 500, letterSpacing: '-0.01em' }}>{statusLabel}</div>
        </div>
      </div>
      <div
        style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          borderLeft: `1px solid ${surface.line}`,
          fontFamily: 'var(--font-mono)',
        }}
      >
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: surface.fg2, marginBottom: 1 }}>
            tests
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-sans)', letterSpacing: '-0.01em' }}>
            {tests}
            <span style={{ color: surface.fg2 }}>/{total}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: surface.fg2, marginBottom: 1 }}>
            runs
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-sans)', letterSpacing: '-0.01em' }}>{cadence}</div>
        </div>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: surface.fg2, marginBottom: 1 }}>
            last
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-sans)', letterSpacing: '-0.01em' }}>{lastRun}</div>
        </div>
      </div>
    </div>
  );
}
