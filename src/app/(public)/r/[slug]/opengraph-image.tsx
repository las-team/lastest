import { ImageResponse } from 'next/og';
import { getPublicShareContext } from '@/lib/db/queries/public-shares';
import { isValidShareSlug } from '@/lib/share/slug';

export const runtime = 'nodejs';
export const alt = 'Lastest visual test';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OG({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const valid = isValidShareSlug(slug) ? await getPublicShareContext(slug) : null;

  const domain = valid?.share.targetDomain || 'visual regression test';
  const changed = valid?.build.changesDetected ?? 0;
  const total = valid?.build.totalTests ?? 0;
  const passed = valid?.build.passedCount ?? 0;
  const failed = valid?.build.failedCount ?? 0;

  const accent = '#0891b2'; // teal-600 (close to the Lastest oklch primary)
  const fg = '#0e1a24';
  const muted = '#64748b';
  const bg = '#f8fafc';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: `linear-gradient(135deg, ${bg} 0%, #eef2f5 100%)`,
          padding: 64,
          fontFamily: 'Inter, system-ui, sans-serif',
          color: fg,
          justifyContent: 'space-between',
        }}
      >
        {/* Top row: brand + chip */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 48,
                height: 48,
                background: accent,
                borderRadius: 12,
                display: 'flex',
              }}
            />
            <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>Lastest</span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 20px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 999,
              fontSize: 20,
              color: muted,
              fontWeight: 500,
            }}
          >
            Shared visual test
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 28, color: muted, fontWeight: 500 }}>We visually tested</div>
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1,
              color: fg,
              maxWidth: 1000,
              display: 'flex',
              flexWrap: 'wrap',
            }}
          >
            {domain}
          </div>
        </div>

        {/* Metrics row */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <Metric label="tests" value={total} tone="neutral" />
          <Metric label="passed" value={passed} tone="success" />
          {changed > 0 && <Metric label="changed" value={changed} tone="warning" />}
          {failed > 0 && <Metric label="failed" value={failed} tone="danger" />}
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '16px 28px',
              background: accent,
              color: '#ffffff',
              borderRadius: 12,
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            Claim this test →
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const palette = {
    neutral: { bg: '#f1f5f9', border: '#e2e8f0', fg: '#334155' },
    success: { bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857' },
    warning: { bg: '#fffbeb', border: '#fde68a', fg: '#b45309' },
    danger: { bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c' },
  }[tone];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: '14px 24px',
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 14,
        color: palette.fg,
      }}
    >
      <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{value}</span>
      <span
        style={{ fontSize: 16, textTransform: 'uppercase', letterSpacing: 1, marginTop: 6, fontWeight: 600 }}
      >
        {label}
      </span>
    </div>
  );
}
