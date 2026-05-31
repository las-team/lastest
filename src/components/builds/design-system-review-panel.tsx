'use client';

/**
 * Verify-page graphical review of the design-system layer. Mirrors the
 * Setup tab's "Your design system is ready" preview, but in REVIEW mode:
 *
 *   - tokens IN USE (matched at least once during the harvester walk) are
 *     rendered at full opacity with a usage count badge
 *   - tokens UNUSED (never rendered) are dimmed and labeled "unused"
 *   - off-token "extras" are shown next to their nearest expected token
 *     so reviewers see "we used X but the design system says Y"
 *
 * Powered by:
 *   - buildDesignSystem.config       — the uploaded token bundle
 *   - buildDesignSystem.tokenUsage   — aggregated on-token usage counts
 *   - buildDesignSystem.violations   — off-token rows with nearest match
 */
import { useMemo } from 'react';
import type {
  DesignSystemConfig,
  DesignSystemTokenUsage,
  DesignRoleToken,
  DesignTokenCategory,
} from '@/lib/db/schema';
import type { BuildDesignSystemViolationRow } from '@/lib/db/queries/builds';
import { cn } from '@/lib/utils';

interface DesignSystemReviewPanelProps {
  config: DesignSystemConfig;
  tokenUsage: DesignSystemTokenUsage;
  violations: BuildDesignSystemViolationRow[];
}

const CATEGORY_LABEL: Record<DesignTokenCategory, string> = {
  color: 'Colors',
  'border-radius': 'Radii',
  'font-family': 'Fonts',
  'font-size': 'Type scale',
  spacing: 'Spacing',
};

function isDark(hex: string): boolean {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return false;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

export function DesignSystemReviewPanel({
  config,
  tokenUsage,
  violations,
}: DesignSystemReviewPanelProps) {
  const groups = config.groups ?? {};

  // Group violations by category so each section renders its own extras.
  const violationsByCategory = useMemo(() => {
    const m: Record<DesignTokenCategory, BuildDesignSystemViolationRow[]> = {
      color: [], 'border-radius': [], 'font-family': [], 'font-size': [], spacing: [],
    };
    for (const v of violations) {
      if (m[v.category]) m[v.category].push(v);
    }
    // Sort each bucket by nodes desc — most-frequent extras first.
    for (const cat of Object.keys(m) as DesignTokenCategory[]) {
      m[cat].sort((a, b) => b.totalNodes - a.totalNodes);
    }
    return m;
  }, [violations]);

  // Per-category headline counts shown on each section title.
  const headline = useMemo(() => {
    return {
      color: countSection(groups.brandPalette, tokenUsage.color, violationsByCategory.color),
      surfaces: countSection(groups.surfaces, tokenUsage.color, []),
      semantic: countSection(groups.semantic, tokenUsage.color, []),
      radii: countSection(groups.radii, tokenUsage['border-radius'], violationsByCategory['border-radius']),
      spacing: countSection(groups.spacing, tokenUsage.spacing, violationsByCategory.spacing),
      typeScale: countSection(groups.typeScale, tokenUsage['font-size'], violationsByCategory['font-size']),
      fonts: countSection(groups.fonts, tokenUsage['font-family'], violationsByCategory['font-family']),
    };
  }, [groups, tokenUsage, violationsByCategory]);

  return (
    <div className="space-y-4">
      {/* ── Brand palette ── */}
      {groups.brandPalette && groups.brandPalette.length > 0 && (
        <Section
          title="Brand palette"
          sublabel={`${headline.color.used} of ${headline.color.total} used`}
          extraCount={headline.color.extras}
        >
          <BrandPaletteRow tokens={groups.brandPalette} usage={tokenUsage.color} />
          {violationsByCategory.color.length > 0 && (
            <ExtrasRow rows={violationsByCategory.color} kind="color" />
          )}
        </Section>
      )}

      {/* ── Semantic + surfaces (single colors view) ── */}
      {(groups.semantic?.length || groups.surfaces?.length) && (
        <Section
          title="Semantic + surface colors"
          sublabel={`${(headline.semantic.used + headline.surfaces.used)} of ${(headline.semantic.total + headline.surfaces.total)} used`}
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {[...(groups.semantic ?? []), ...(groups.surfaces ?? [])].map((t) => (
              <ColorRowTile key={t.name} token={t} usage={tokenUsage.color?.[t.value] ?? 0} />
            ))}
          </div>
        </Section>
      )}

      {/* ── Corner radii ── */}
      {groups.radii && groups.radii.length > 0 && (
        <Section
          title="Corner radii"
          sublabel={`${headline.radii.used} of ${headline.radii.total} used`}
          extraCount={headline.radii.extras}
        >
          <div className="flex items-end gap-4 flex-wrap">
            {groups.radii.map((r) => (
              <RadiusTile key={r.name} token={r} usage={tokenUsage['border-radius']?.[r.value] ?? 0} />
            ))}
          </div>
          {violationsByCategory['border-radius'].length > 0 && (
            <ExtrasRow rows={violationsByCategory['border-radius']} kind="radius" />
          )}
        </Section>
      )}

      {/* ── Spacing ── */}
      {groups.spacing && groups.spacing.length > 0 && (
        <Section
          title="Spacing scale"
          sublabel={`${headline.spacing.used} of ${headline.spacing.total} used`}
          extraCount={headline.spacing.extras}
        >
          <div className="space-y-1.5">
            {groups.spacing.map((s) => (
              <SpacingRow key={s.name} token={s} usage={tokenUsage.spacing?.[s.value] ?? 0} />
            ))}
          </div>
          {violationsByCategory.spacing.length > 0 && (
            <ExtrasRow rows={violationsByCategory.spacing} kind="px" />
          )}
        </Section>
      )}

      {/* ── Type scale ── */}
      {groups.typeScale && groups.typeScale.length > 0 && (
        <Section
          title="Type scale"
          sublabel={`${headline.typeScale.used} of ${headline.typeScale.total} used`}
          extraCount={headline.typeScale.extras}
        >
          <div className="space-y-1">
            {groups.typeScale.map((t) => (
              <TypeScaleRow key={t.name} token={t} usage={tokenUsage['font-size']?.[t.value] ?? 0} />
            ))}
          </div>
          {violationsByCategory['font-size'].length > 0 && (
            <ExtrasRow rows={violationsByCategory['font-size']} kind="px" />
          )}
        </Section>
      )}

      {/* ── Type families ── */}
      {groups.fonts && groups.fonts.length > 0 && (
        <Section
          title="Type families"
          sublabel={`${headline.fonts.used} of ${headline.fonts.total} used`}
          extraCount={headline.fonts.extras}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groups.fonts.map((f) => (
              <TypeFamilyTile key={f.name} token={f} usage={tokenUsage['font-family']?.[f.value] ?? 0} />
            ))}
          </div>
          {violationsByCategory['font-family'].length > 0 && (
            <ExtrasRow rows={violationsByCategory['font-family']} kind="font" />
          )}
        </Section>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function countSection(
  tokens: DesignRoleToken[] | undefined,
  usageMap: Record<string, number> | undefined,
  extras: BuildDesignSystemViolationRow[],
): { used: number; total: number; extras: number } {
  if (!tokens) return { used: 0, total: 0, extras: extras.length };
  let used = 0;
  for (const t of tokens) {
    if ((usageMap?.[t.value] ?? 0) > 0) used++;
  }
  return { used, total: tokens.length, extras: extras.length };
}

// ── Layout ───────────────────────────────────────────────────────────────

function Section({
  title,
  sublabel,
  extraCount,
  children,
}: {
  title: string;
  sublabel?: string;
  extraCount?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          {sublabel && <div className="text-[11px] text-muted-foreground">{sublabel}</div>}
        </div>
        {extraCount !== undefined && extraCount > 0 && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-destructive bg-destructive/10 border border-destructive/30 rounded-full px-2 py-0.5">
            +{extraCount} extra{extraCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

// ── Token tiles ──────────────────────────────────────────────────────────

function BrandPaletteRow({
  tokens,
  usage,
}: {
  tokens: DesignRoleToken[];
  usage: Record<string, number> | undefined;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {tokens.map((t) => {
        const n = usage?.[t.value] ?? 0;
        const used = n > 0;
        const dark = isDark(t.value);
        return (
          <div
            key={t.name}
            className={cn(
              'relative rounded-md overflow-hidden border h-28 flex flex-col justify-between p-3 transition-opacity',
              !used && 'opacity-40 grayscale',
            )}
            style={{ backgroundColor: t.value }}
            title={used ? `Used on ${n} element${n === 1 ? '' : 's'}` : 'Not rendered in this build'}
          >
            <div
              className={cn(
                'text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center justify-between gap-1',
                dark ? 'text-white/85' : 'text-black/70',
              )}
            >
              <span>{t.role ?? ''}</span>
              {used && (
                <span className={cn(
                  'text-[9px] rounded-full px-1.5 py-0.5 font-bold',
                  dark ? 'bg-white/20 text-white' : 'bg-black/20 text-black',
                )}>
                  ×{formatCount(n)}
                </span>
              )}
            </div>
            <div>
              <div className={cn('text-base font-semibold leading-none', dark ? 'text-white' : 'text-black')}>
                {t.label}
              </div>
              <div className={cn('text-[11px] font-mono mt-0.5', dark ? 'text-white/75' : 'text-black/60')}>
                {t.value.toUpperCase()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColorRowTile({ token, usage }: { token: DesignRoleToken; usage: number }) {
  const used = usage > 0;
  const dark = isDark(token.value);
  return (
    <div
      className={cn(
        'rounded-md border overflow-hidden flex items-stretch transition-opacity',
        !used && 'opacity-40',
      )}
      title={used ? `Used ${usage}×` : 'Unused'}
    >
      <div
        className="w-10 shrink-0 flex items-center justify-center"
        style={{ backgroundColor: token.value }}
      >
        {token.role && (
          <span
            className={cn(
              'text-[9px] font-mono uppercase font-semibold',
              dark ? 'text-white/80' : 'text-black/60',
            )}
            style={{ writingMode: 'vertical-rl' as const, transform: 'rotate(180deg)' }}
          >
            {token.role.slice(0, 4)}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0 px-2.5 py-2 flex flex-col justify-center">
        <div className="text-xs font-medium font-mono truncate flex items-center justify-between gap-1" title={token.name}>
          <span className="truncate">{token.name}</span>
          {used && <span className="text-[10px] text-foreground/80 shrink-0">×{formatCount(usage)}</span>}
        </div>
        <div className="text-[10px] text-muted-foreground font-mono">{token.value.toUpperCase()}</div>
      </div>
    </div>
  );
}

function RadiusTile({ token, usage }: { token: DesignRoleToken; usage: number }) {
  const used = usage > 0;
  const px = Math.min(parseFloat(token.value) || 0, 28);
  return (
    <div
      className={cn('flex flex-col items-center gap-1.5 min-w-[64px] transition-opacity', !used && 'opacity-40')}
      title={used ? `Used ${usage}×` : 'Unused'}
    >
      <div
        className="w-12 h-12 bg-primary/15 border-2 border-primary/40"
        style={{ borderRadius: `${px}px` }}
      />
      <div className="text-[11px] font-mono">{token.name.replace(/^--/, '')}</div>
      <div className="text-[10px] text-muted-foreground font-mono">
        {token.value} {used && <span className="text-foreground/80">· ×{formatCount(usage)}</span>}
      </div>
    </div>
  );
}

function SpacingRow({ token, usage }: { token: DesignRoleToken; usage: number }) {
  const used = usage > 0;
  const px = parseFloat(token.value) || 0;
  return (
    <div
      className={cn('flex items-center gap-3 transition-opacity', !used && 'opacity-40')}
      title={used ? `Used ${usage}×` : 'Unused'}
    >
      <div className="font-mono text-[11px] w-20 shrink-0 truncate">{token.name.replace(/^--/, '')}</div>
      <div className="font-mono text-[10px] text-muted-foreground w-12 shrink-0">{token.value}</div>
      <div className="bg-primary/30 h-3 rounded-sm" style={{ width: `${Math.min(px, 320)}px` }} />
      {used && <div className="text-[10px] text-muted-foreground ml-auto shrink-0">×{formatCount(usage)}</div>}
    </div>
  );
}

function TypeScaleRow({ token, usage }: { token: DesignRoleToken; usage: number }) {
  const used = usage > 0;
  const px = parseFloat(token.value) || 14;
  return (
    <div
      className={cn('flex items-baseline gap-3 py-1 border-b last:border-0 transition-opacity', !used && 'opacity-40')}
      title={used ? `Used ${usage}×` : 'Unused'}
    >
      <div className="font-mono text-[10px] text-muted-foreground w-16 shrink-0">{token.name.replace(/^--/, '')}</div>
      <div className="font-mono text-[10px] text-muted-foreground w-12 shrink-0">{token.value}</div>
      <div className="truncate flex-1" style={{ fontSize: `${Math.min(px, 42)}px`, lineHeight: 1.1 }}>
        The quick brown fox
      </div>
      {used && <div className="text-[10px] text-muted-foreground shrink-0">×{formatCount(usage)}</div>}
    </div>
  );
}

function TypeFamilyTile({ token, usage }: { token: DesignRoleToken; usage: number }) {
  const used = usage > 0;
  return (
    <div
      className={cn('rounded-md border p-3 transition-opacity', !used && 'opacity-40')}
      title={used ? `Used ${usage}×` : 'Unused'}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{token.label}</div>
        {used && <div className="text-[10px] font-medium">×{formatCount(usage)}</div>}
      </div>
      <div
        className="text-2xl mt-1 truncate"
        style={{ fontFamily: `${token.value}, system-ui, sans-serif` }}
        title={token.value}
      >
        Aa
      </div>
      <div className="text-[11px] font-mono text-muted-foreground mt-1 truncate">{token.value}</div>
    </div>
  );
}

// ── Extras (off-token) ───────────────────────────────────────────────────

function ExtrasRow({
  rows,
  kind,
}: {
  rows: BuildDesignSystemViolationRow[];
  kind: 'color' | 'radius' | 'px' | 'font';
}) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-destructive mb-2">
        Extras · not in the design system
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {rows.slice(0, 30).map((r) => (
          <ExtraTile key={r.id} row={r} kind={kind} />
        ))}
      </div>
      {rows.length > 30 && (
        <div className="text-[11px] text-muted-foreground mt-2">
          +{rows.length - 30} more · see the violations list below
        </div>
      )}
    </div>
  );
}

function ExtraTile({
  row,
  kind,
}: {
  row: BuildDesignSystemViolationRow;
  kind: 'color' | 'radius' | 'px' | 'font';
}) {
  return (
    <div className="rounded border bg-background px-2.5 py-2 flex items-center gap-2">
      <ExtraSwatch value={row.actual} kind={kind} />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] truncate">{row.actual}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {row.property} · {row.totalNodes} node{row.totalNodes === 1 ? '' : 's'}
        </div>
      </div>
      {row.expected && (
        <>
          <span className="text-muted-foreground text-[10px]">→</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <ExtraSwatch value={row.expected} kind={kind} />
            <div className="min-w-0">
              <div className="font-mono text-[11px] truncate">{row.expected}</div>
              {row.expectedName && (
                <div className="text-[10px] text-muted-foreground truncate">{row.expectedName}</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ExtraSwatch({ value, kind }: { value: string; kind: 'color' | 'radius' | 'px' | 'font' }) {
  if (kind === 'color') {
    return (
      <span
        className="inline-block w-6 h-6 rounded border border-border shrink-0"
        style={{ backgroundColor: value }}
      />
    );
  }
  if (kind === 'radius') {
    const px = Math.min(parseFloat(value) || 0, 16);
    return (
      <span
        className="inline-block w-6 h-6 bg-primary/15 border border-primary/40 shrink-0"
        style={{ borderRadius: `${px}px` }}
      />
    );
  }
  if (kind === 'px') {
    return (
      <span
        className="inline-block bg-primary/30 h-3 rounded-sm shrink-0"
        style={{ width: `${Math.min(parseFloat(value) || 0, 56)}px`, minWidth: 4 }}
      />
    );
  }
  // font
  return (
    <span
      className="inline-block w-6 h-6 rounded border border-border text-center text-base font-semibold shrink-0 leading-6"
      style={{ fontFamily: `${value}, system-ui, sans-serif` }}
    >
      A
    </span>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
