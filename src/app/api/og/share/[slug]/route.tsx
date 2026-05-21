import { ImageResponse } from 'next/og';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import {
  getPublicShareContext,
  getShareDataBySlug,
} from '@/lib/db/queries/public-shares';
import { resolveStoragePath } from '@/lib/storage/paths';
import { isValidShareSlug } from '@/lib/share/slug';

// Node runtime — we read screenshots off disk to embed them inline.
export const runtime = 'nodejs';
// Cache aggressively at the edge; share content doesn't change after publish.
export const revalidate = 300;

const OG_W = 1200;
const OG_H = 630;
// Cap on hero screenshot size before embedding as a data URL. Full-page
// screenshots can run multiple MB; once embedded + base64'd, Satori takes
// long enough that Twitter/Slack scrapers time out (~5–10s) and silently
// drop the card. Past this size we fall back to the placeholder pane.
const MAX_HERO_BYTES = 1_800_000;

// Brand palette (sync with src/app/globals.css)
const COLOR_PAPER = '#F6F4EF';
const COLOR_INK = '#1F2A33';
const COLOR_RED = '#E03E36';
const COLOR_TEAL = '#36A88E';
const COLOR_LINE = 'rgba(31, 42, 51, 0.10)';
const COLOR_MUTED = 'rgba(31, 42, 51, 0.55)';

function pickHeroPath(
  diffs: Awaited<ReturnType<typeof getShareDataBySlug>> extends infer T
    ? T extends { diffs: infer D }
      ? D
      : never
    : never,
  results: Awaited<ReturnType<typeof getShareDataBySlug>> extends infer T
    ? T extends { results: infer R }
      ? R
      : never
    : never,
): { kind: 'diff' | 'current' | 'baseline' | 'shot'; path: string } | null {
  if (diffs) {
    const changed = diffs.find((d) => d.diffImagePath);
    if (changed?.diffImagePath) return { kind: 'diff', path: changed.diffImagePath };
    const withCurrent = diffs.find((d) => d.currentImagePath);
    if (withCurrent?.currentImagePath) return { kind: 'current', path: withCurrent.currentImagePath };
    const withBaseline = diffs.find((d) => d.baselineImagePath);
    if (withBaseline?.baselineImagePath) return { kind: 'baseline', path: withBaseline.baselineImagePath };
  }
  if (results) {
    for (const r of results) {
      if (r.screenshotPath) return { kind: 'shot', path: r.screenshotPath };
      const captured = (r.screenshots ?? []) as Array<{ path?: string | null }> | null;
      const firstShot = captured?.find((s) => s.path)?.path;
      if (firstShot) return { kind: 'shot', path: firstShot };
    }
  }
  return null;
}

async function readImageAsDataUrl(storagePath: string): Promise<string | null> {
  const cleaned = storagePath.startsWith('/') ? storagePath : `/${storagePath}`;
  const abs = resolveStoragePath(cleaned);
  if (!abs || !existsSync(abs)) return null;
  try {
    const st = await stat(abs);
    if (st.size > MAX_HERO_BYTES) return null;
    const buf = await readFile(abs);
    const ext = cleaned.slice(cleaned.lastIndexOf('.') + 1).toLowerCase();
    const mime =
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function fallbackImage(message = 'Lastest', accent = COLOR_INK): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: COLOR_PAPER,
          fontFamily: 'Inter, sans-serif',
          color: COLOR_INK,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              backgroundColor: COLOR_RED,
              transform: 'translate(8px, 8px)',
              position: 'relative',
            }}
          />
          <div
            style={{
              width: 56,
              height: 56,
              border: `4px solid ${COLOR_INK}`,
              backgroundColor: '#FFFFFF',
              marginLeft: -56,
              position: 'relative',
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: 96,
              fontWeight: 900,
              letterSpacing: -3,
              marginLeft: 12,
            }}
          >
            <span>LAS</span>
            <span style={{ color: COLOR_RED }}>T</span>
            <span>EST</span>
          </div>
        </div>
        <div style={{ marginTop: 24, fontSize: 28, color: accent, fontWeight: 600 }}>{message}</div>
      </div>
    ),
    { width: OG_W, height: OG_H },
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    return await renderShareOg(await params);
  } catch (err) {
    console.error('[og/share] render failed:', err);
    return fallbackImage('Lastest', COLOR_RED);
  }
}

async function renderShareOg({ slug }: { slug: string }): Promise<ImageResponse> {
  if (!isValidShareSlug(slug)) {
    return fallbackImage('Invalid share');
  }

  const ctx = await getPublicShareContext(slug);
  if (!ctx) return fallbackImage('Share unavailable');

  const data = await getShareDataBySlug(slug);
  const diffs = data?.diffs ?? [];
  const results = data?.results ?? [];

  const domain = ctx.share.targetDomain || ctx.test?.name || 'Visual regression check';
  const changes = ctx.build.changesDetected ?? 0;
  const total = ctx.build.totalTests ?? 0;
  const status = ctx.build.overallStatus;
  const hasChanges = changes > 0;

  // Cosmetic status badge.
  const badge =
    status === 'blocked'
      ? { label: 'Blocked', color: COLOR_RED }
      : hasChanges
      ? { label: `${changes} visual ${changes === 1 ? 'change' : 'changes'}`, color: COLOR_RED }
      : status === 'safe_to_merge'
      ? { label: 'Safe to merge', color: COLOR_TEAL }
      : { label: 'Review', color: COLOR_INK };

  const headline = hasChanges
    ? `${changes} visual ${changes === 1 ? 'change' : 'changes'} detected`
    : 'No visual changes detected';

  const subhead = total > 0 ? `across ${total} test${total === 1 ? '' : 's'}` : 'Visual regression report';

  const hero = pickHeroPath(diffs, results);
  const heroDataUrl = hero ? await readImageAsDataUrl(hero.path) : null;
  const heroLabel =
    hero?.kind === 'diff'
      ? 'DIFF'
      : hero?.kind === 'baseline'
      ? 'BASELINE'
      : hero?.kind === 'current'
      ? 'CURRENT'
      : 'CAPTURE';

  // Resolve a clean domain string for the headline (strip protocol + trailing slash)
  const cleanDomain = String(domain)
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: COLOR_PAPER,
          fontFamily: 'Inter, sans-serif',
          color: COLOR_INK,
          position: 'relative',
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            height: 8,
            backgroundColor: hasChanges ? COLOR_RED : COLOR_TEAL,
            display: 'flex',
          }}
        />

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '32px 56px 0 56px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* Logo mark */}
            <div style={{ position: 'relative', width: 44, height: 44, display: 'flex' }}>
              <div
                style={{
                  position: 'absolute',
                  left: 8,
                  top: 8,
                  width: 36,
                  height: 36,
                  backgroundColor: COLOR_RED,
                  display: 'flex',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 36,
                  height: 36,
                  border: `3px solid ${COLOR_INK}`,
                  backgroundColor: '#FFFFFF',
                  display: 'flex',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 32,
                fontWeight: 900,
                letterSpacing: -1,
                marginLeft: 16,
              }}
            >
              <span>LAS</span>
              <span style={{ color: COLOR_RED }}>T</span>
              <span>EST</span>
            </div>
          </div>

          {/* Status pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 18px',
              backgroundColor: badge.color,
              color: '#FFFFFF',
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              borderRadius: 4,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: '#FFFFFF',
                display: 'flex',
              }}
            />
            {badge.label}
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            padding: '36px 56px 32px 56px',
            gap: 48,
            alignItems: 'stretch',
          }}
        >
          {/* Left column */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: COLOR_MUTED,
                textTransform: 'uppercase',
                letterSpacing: 2,
                marginBottom: 12,
              }}
            >
              {cleanDomain}
            </div>
            <div
              style={{
                fontSize: 64,
                fontWeight: 900,
                lineHeight: 1.05,
                letterSpacing: -2,
                color: COLOR_INK,
              }}
            >
              {headline}
            </div>
            <div
              style={{
                marginTop: 18,
                fontSize: 28,
                color: COLOR_MUTED,
                fontWeight: 500,
              }}
            >
              {subhead}
            </div>

            <div
              style={{
                marginTop: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                paddingTop: 24,
              }}
            >
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: COLOR_INK,
                  letterSpacing: 0.4,
                }}
              >
                LASTEST.CLOUD
              </div>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: COLOR_MUTED,
                  display: 'flex',
                }}
              />
              <div style={{ fontSize: 18, color: COLOR_MUTED, fontWeight: 500 }}>
                Before/after with teeth
              </div>
            </div>
          </div>

          {/* Right column - screenshot frame */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 520,
            }}
          >
            <div
              style={{
                position: 'relative',
                width: 520,
                height: 360,
                display: 'flex',
              }}
            >
              {/* Red offset block */}
              <div
                style={{
                  position: 'absolute',
                  left: 18,
                  top: 18,
                  right: -18,
                  bottom: -18,
                  backgroundColor: hasChanges ? COLOR_RED : COLOR_TEAL,
                  display: 'flex',
                }}
              />
              {/* Frame */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  backgroundColor: '#FFFFFF',
                  border: `3px solid ${COLOR_INK}`,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                {/* Browser chrome */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '10px 14px',
                    backgroundColor: '#F1F1EE',
                    borderBottom: `2px solid ${COLOR_INK}`,
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: '#E03E36', display: 'flex' }} />
                  <div style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: '#E09836', display: 'flex' }} />
                  <div style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: '#36A88E', display: 'flex' }} />
                  <div
                    style={{
                      flex: 1,
                      marginLeft: 14,
                      height: 16,
                      backgroundColor: '#FFFFFF',
                      border: `1px solid ${COLOR_LINE}`,
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: 8,
                      fontSize: 12,
                      color: COLOR_MUTED,
                      fontWeight: 600,
                    }}
                  >
                    {cleanDomain}
                  </div>
                </div>

                {/* Screenshot area */}
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    position: 'relative',
                    overflow: 'hidden',
                    backgroundColor: '#FAFAF7',
                  }}
                >
                  {heroDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={heroDataUrl}
                      alt=""
                      width={520}
                      height={290}
                      style={{
                        width: 520,
                        height: 290,
                        objectFit: 'cover',
                        objectPosition: 'top center',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 520,
                        height: 290,
                        fontSize: 18,
                        color: COLOR_MUTED,
                        fontWeight: 600,
                      }}
                    >
                      Visual regression report
                    </div>
                  )}

                  {/* Hero label tag */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: 12,
                      backgroundColor: hero?.kind === 'diff' ? COLOR_RED : COLOR_INK,
                      color: '#FFFFFF',
                      fontSize: 14,
                      fontWeight: 800,
                      letterSpacing: 1.5,
                      padding: '4px 10px',
                      display: 'flex',
                    }}
                  >
                    {heroLabel}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: OG_W,
      height: OG_H,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
      },
    },
  );
}

