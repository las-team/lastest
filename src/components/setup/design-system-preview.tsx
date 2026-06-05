"use client";

/**
 * Claude-Design-style preview of the uploaded design system. Mirrors the
 * "Your design system is ready" screen: header card, font-missing warning
 * banner, then a stack of collapsible sections (brand palette / surfaces
 * / semantic / radii / spacing / type scale / fonts).
 *
 * Token grouping is computed at upload time by `parseDesignSystemCss`
 * and persisted on `playwright_settings.designSystem.groups`. This
 * component is a pure renderer — no parsing, no state besides which
 * sections are expanded.
 */
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Check,
  Upload,
} from "lucide-react";
import type { DesignSystemConfig, DesignRoleToken } from "@/lib/db/schema";
import { detectMissingFonts } from "@/lib/design-system/tokens";
import { cn } from "@/lib/utils";

interface DesignSystemPreviewProps {
  config: DesignSystemConfig;
  /** Repo-level enable toggle. When false the preview shows a "not
   *  active" hint with a pointer at Playwright Settings. */
  enabled: boolean;
  /** Optional repo name used in the header card. */
  repoName?: string;
}

export function DesignSystemPreview({
  config,
  enabled,
  repoName,
}: DesignSystemPreviewProps) {
  const g = config.groups ?? {};
  const meta = config.meta ?? {};
  const missingFonts = detectMissingFonts(config);

  const totalTokens =
    (g.brandPalette?.length ?? 0) +
    (g.surfaces?.length ?? 0) +
    (g.semantic?.length ?? 0) +
    (g.inkScale?.length ?? 0) +
    (g.radii?.length ?? 0) +
    (g.spacing?.length ?? 0) +
    (g.typeScale?.length ?? 0) +
    (g.fonts?.length ?? 0);

  const title = meta.title || "Your design system is ready";
  const description =
    meta.description ||
    `Tests in ${repoName ? `the ${repoName} repo` : "this repo"} will compare captured DOM against this set. Update it any time by uploading a fresh bundle below.`;

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-md border p-4">
        <h3 className="text-base font-semibold tracking-tight mb-1">{title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
        <div className="mt-3 pt-3 border-t flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {totalTokens} tokens loaded
            </span>
            {meta.files && meta.files.length > 0 && (
              <span>
                · {meta.files.length} source file
                {meta.files.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border",
              enabled
                ? "bg-success/15 text-success border-success/30"
                : "bg-muted text-muted-foreground border-border",
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                enabled ? "bg-success" : "bg-muted-foreground/50",
              )}
            />
            {enabled ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      {/* Missing brand fonts warning */}
      {missingFonts.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 text-warning-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-medium">Missing brand fonts</div>
              <div className="text-xs text-muted-foreground truncate">
                {missingFonts.join(", ")}{" "}
                {missingFonts.length === 1 ? "is" : "are"} declared but not in
                the bundle. Tests will see substitute web fonts.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-background transition-colors shrink-0"
            // No-op for now: font-file ingestion is a follow-up. The button
            // exists so the visual mirrors Claude Design and signals intent.
            disabled
            title="Font ingestion coming soon"
          >
            <Upload className="h-3 w-3" /> Upload fonts
          </button>
        </div>
      )}

      {/* Sections */}
      {g.fonts && g.fonts.length > 0 && (
        <Section title="Type">
          <Collapsible label="Type families" badge={`${g.fonts.length}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {g.fonts.map((f) => (
                <TypeFamilyTile key={f.name} token={f} />
              ))}
            </div>
          </Collapsible>
          {g.typeScale && g.typeScale.length > 0 && (
            <Collapsible label="Type scale" badge={`${g.typeScale.length}`}>
              <div className="space-y-2">
                {g.typeScale.map((t) => (
                  <TypeScaleRow key={t.name} token={t} />
                ))}
              </div>
            </Collapsible>
          )}
        </Section>
      )}

      <Section title="Colors">
        {g.brandPalette && g.brandPalette.length > 0 && (
          <Collapsible
            label="Brand palette"
            sublabel={`${g.brandPalette.length}-stop palette anchor`}
            defaultOpen
            badge={`${g.brandPalette.length}`}
          >
            <BrandPaletteGrid tokens={g.brandPalette} />
          </Collapsible>
        )}
        {g.semantic && g.semantic.length > 0 && (
          <Collapsible label="Semantic colors" badge={`${g.semantic.length}`}>
            <SemanticGrid tokens={g.semantic} />
          </Collapsible>
        )}
        {g.surfaces && g.surfaces.length > 0 && (
          <Collapsible label="Surface neutrals" badge={`${g.surfaces.length}`}>
            <SemanticGrid tokens={g.surfaces} />
          </Collapsible>
        )}
        {g.inkScale && g.inkScale.length > 0 && (
          <Collapsible label="Ink scale" badge={`${g.inkScale.length}`}>
            <SemanticGrid tokens={g.inkScale} />
          </Collapsible>
        )}
      </Section>

      {(g.radii || g.spacing) && (
        <Section title="Spacing">
          {g.radii && g.radii.length > 0 && (
            <Collapsible label="Corner radii" badge={`${g.radii.length}`}>
              <div className="flex items-end gap-4 flex-wrap">
                {g.radii.map((r) => (
                  <RadiusTile key={r.name} token={r} />
                ))}
              </div>
            </Collapsible>
          )}
          {g.spacing && g.spacing.length > 0 && (
            <Collapsible label="Spacing scale" badge={`${g.spacing.length}`}>
              <div className="space-y-1.5">
                {g.spacing.map((s) => (
                  <SpacingRow key={s.name} token={s} />
                ))}
              </div>
            </Collapsible>
          )}
        </Section>
      )}

      {meta.files && meta.files.length > 0 && (
        <Section title="Imported from">
          <ul className="text-xs text-muted-foreground space-y-1 font-mono">
            {meta.files.map((f) => (
              <li key={f} className="flex items-center gap-1.5">
                <Check className="h-3 w-3 text-success" />
                {f}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Collapsible({
  label,
  sublabel,
  badge,
  defaultOpen = false,
  children,
}: {
  label: string;
  sublabel?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{label}</div>
          {sublabel && (
            <div className="text-[11px] text-muted-foreground">{sublabel}</div>
          )}
        </div>
        {badge && (
          <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 py-4 border-t bg-background">{children}</div>
      )}
    </div>
  );
}

// ── Color tiles ──────────────────────────────────────────────────────────

function isDark(hex: string): boolean {
  // Treat 6-digit hex as the swatch luminance; 8-digit alpha is ignored.
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return false;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  // Perceptual luma — black text is readable above ~140.
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma < 140;
}

function BrandPaletteGrid({ tokens }: { tokens: DesignRoleToken[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {tokens.map((t) => {
        const dark = isDark(t.value);
        return (
          <div
            key={t.name}
            className="relative rounded-md overflow-hidden border h-32 flex flex-col justify-between p-3"
            style={{ backgroundColor: t.value }}
          >
            <div
              className={cn(
                "text-[10px] font-mono uppercase tracking-widest font-semibold",
                dark ? "text-white/85" : "text-black/70",
              )}
            >
              {t.role ?? ""}
            </div>
            <div>
              <div
                className={cn(
                  "text-base font-semibold leading-none",
                  dark ? "text-white" : "text-black",
                )}
              >
                {t.label}
              </div>
              <div
                className={cn(
                  "text-[11px] font-mono mt-0.5",
                  dark ? "text-white/75" : "text-black/60",
                )}
              >
                {t.value.toUpperCase()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SemanticGrid({ tokens }: { tokens: DesignRoleToken[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
      {tokens.map((t) => {
        const dark = isDark(t.value);
        return (
          <div
            key={t.name}
            className="rounded-md border overflow-hidden flex items-stretch"
          >
            <div
              className="w-10 shrink-0 flex items-center justify-center"
              style={{ backgroundColor: t.value }}
            >
              {t.role && (
                <span
                  className={cn(
                    "text-[9px] font-mono uppercase font-semibold writing-mode-vertical px-1",
                    dark ? "text-white/80" : "text-black/60",
                  )}
                  style={{
                    writingMode: "vertical-rl" as const,
                    transform: "rotate(180deg)",
                  }}
                >
                  {t.role.slice(0, 4)}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 px-2.5 py-2">
              <div
                className="text-xs font-medium font-mono truncate"
                title={t.name}
              >
                {t.name}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {t.value.toUpperCase()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RadiusTile({ token }: { token: DesignRoleToken }) {
  const px = Math.min(parseFloat(token.value) || 0, 28);
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-[64px]">
      <div
        className="w-12 h-12 bg-primary/15 border-2 border-primary/40"
        style={{ borderRadius: `${px}px` }}
      />
      <div className="text-[11px] font-mono">
        {token.name.replace(/^--/, "")}
      </div>
      <div className="text-[10px] text-muted-foreground font-mono">
        {token.value}
      </div>
    </div>
  );
}

function SpacingRow({ token }: { token: DesignRoleToken }) {
  const px = parseFloat(token.value) || 0;
  return (
    <div className="flex items-center gap-3">
      <div
        className="font-mono text-[11px] w-20 shrink-0 truncate"
        title={token.name}
      >
        {token.name.replace(/^--/, "")}
      </div>
      <div className="font-mono text-[10px] text-muted-foreground w-12 shrink-0">
        {token.value}
      </div>
      <div
        className="bg-primary/30 h-3 rounded-sm"
        style={{ width: `${Math.min(px, 320)}px` }}
      />
    </div>
  );
}

function TypeFamilyTile({ token }: { token: DesignRoleToken }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {token.label}
      </div>
      <div
        className="text-2xl mt-1 truncate"
        style={{ fontFamily: `${token.value}, system-ui, sans-serif` }}
        title={token.value}
      >
        Aa
      </div>
      <div className="text-[11px] font-mono text-muted-foreground mt-1 truncate">
        {token.value}
      </div>
    </div>
  );
}

function TypeScaleRow({ token }: { token: DesignRoleToken }) {
  const px = parseFloat(token.value) || 14;
  return (
    <div className="flex items-baseline gap-3 py-1 border-b last:border-0">
      <div className="font-mono text-[10px] text-muted-foreground w-16 shrink-0">
        {token.name.replace(/^--/, "")}
      </div>
      <div className="font-mono text-[10px] text-muted-foreground w-12 shrink-0">
        {token.value}
      </div>
      <div
        className="truncate flex-1"
        style={{ fontSize: `${Math.min(px, 48)}px`, lineHeight: 1.1 }}
      >
        The quick brown fox
      </div>
    </div>
  );
}
