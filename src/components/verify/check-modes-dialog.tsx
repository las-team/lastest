'use client';

import { useState, useTransition } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  Eye,
  FileText,
  Code2,
  Globe,
  Terminal,
  Accessibility,
  Palette,
  Gauge,
  Link as LinkIcon,
} from 'lucide-react';
import { savePlaywrightSettings } from '@/server/actions/settings';
import {
  type CheckMode,
  type CheckLayer,
  type CheckModeMap,
  checkModesToSettingsPatch,
  defaultCheckModes,
} from '@/lib/verify/check-modes';

interface CheckModesDialogProps {
  open: boolean;
  onClose: () => void;
  /** Repo whose playwright_settings row owns these modes. null → global row. */
  repositoryId: string | null;
  /** Current modes (hydrated from verify-status). */
  initial: CheckModeMap;
  /** Called after a successful save so the parent re-pulls verify-status and
   *  the toolbar pills repaint. */
  onSaved?: () => void;
}

interface LayerMeta {
  id: CheckLayer;
  name: string;
  icon: typeof Eye;
  description: string;
}

const LAYERS: LayerMeta[] = [
  { id: 'visual',  name: 'Visual',   icon: Eye,           description: 'Pixel screenshot diff against the baseline.' },
  { id: 'text',    name: 'Text',     icon: FileText,      description: 'Capture page innerText alongside each screenshot and diff it.' },
  { id: 'dom',     name: 'DOM',      icon: Code2,         description: 'Capture DOM snapshots and overlay element changes.' },
  { id: 'network', name: 'Network',  icon: Globe,         description: 'Record HTTP traffic and gate on 4xx/5xx responses.' },
  { id: 'console', name: 'Console',  icon: Terminal,      description: 'Surface console errors. Capture is always on; mode governs the verdict.' },
  { id: 'a11y',    name: 'A11y',     icon: Accessibility, description: 'Run axe-core WCAG 2.2 AA compliance checks.' },
  { id: 'design',  name: 'Design',   icon: Palette,       description: 'Compare computed tokens (colors / radii / fonts) against the repo bundle.' },
  { id: 'perf',    name: 'Perf',     icon: Gauge,         description: 'Capture Web Vitals (LCP, CLS, TBT) and compare against the baseline.' },
  { id: 'url',     name: 'URL',      icon: LinkIcon,      description: 'Compare the trajectory of URLs visited during the test.' },
];

const MODE_OPTIONS: { id: CheckMode; label: string; hint: string; icon: typeof Check; tone: string }[] = [
  { id: 'enforce', label: 'Enforce', hint: 'Run and fail the test on issues', icon: AlertOctagon, tone: 'var(--c-red)' },
  { id: 'log',     label: 'Log',     hint: 'Run, surface issues, never fail', icon: AlertTriangle, tone: 'var(--c-amber)' },
  { id: 'disable', label: 'Disable', hint: "Don't run this check",            icon: Check,         tone: 'var(--fg-4)' },
];

export function CheckModesDialog({
  open,
  onClose,
  repositoryId,
  initial,
  onSaved,
}: CheckModesDialogProps) {
  // `draft` is the user's in-progress edits. Null until they touch anything
  // — `modes` then falls through to the `initial` prop, so a settings change
  // that lands while the dialog is closed shows up the next time it opens
  // without an effect-driven reset (which would also be flagged by the
  // set-state-in-effect lint rule).
  const [draft, setDraft] = useState<CheckModeMap | null>(null);
  const modes = draft ?? initial;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const setMode = (layer: CheckLayer, mode: CheckMode) => {
    setDraft((prev) => ({ ...(prev ?? initial), [layer]: mode }));
  };
  const resetToDefaults = () => setDraft(defaultCheckModes());

  const closeAndReset = () => {
    setDraft(null);
    setError(null);
    onClose();
  };

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        const patch = checkModesToSettingsPatch(modes);
        await savePlaywrightSettings({
          repositoryId,
          ...patch,
        });
        onSaved?.();
        closeAndReset();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) closeAndReset(); }}>
      <DialogContent
        className="max-w-2xl"
        style={{ background: 'var(--c-white)' }}
      >
        <DialogHeader>
          <DialogTitle>Run Variables · Check modes</DialogTitle>
          <DialogDescription>
            For each layer, pick whether issues fail the test, are surfaced as warnings, or skip the check entirely.
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {LAYERS.map((layer) => {
            const Icon = layer.icon;
            return (
              <div
                key={layer.id}
                data-testid={`check-modes-row-${layer.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--c-white)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Icon size={16} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)' }}>{layer.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.35 }}>
                      {layer.description}
                    </div>
                  </div>
                </div>

                <div
                  role="radiogroup"
                  aria-label={`${layer.name} mode`}
                  style={{
                    display: 'inline-flex',
                    gap: 0,
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: 'var(--c-white)',
                  }}
                >
                  {MODE_OPTIONS.map((opt) => {
                    const isActive = modes[layer.id] === opt.id;
                    const OptIcon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        data-testid={`check-modes-${layer.id}-${opt.id}`}
                        title={opt.hint}
                        onClick={() => setMode(layer.id, opt.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '6px 10px',
                          fontSize: 12,
                          fontWeight: isActive ? 600 : 400,
                          cursor: 'pointer',
                          background: isActive
                            ? `color-mix(in oklab, ${opt.tone} 14%, white)`
                            : 'transparent',
                          color: isActive ? opt.tone : 'var(--fg-2)',
                          border: 'none',
                          borderRight: '1px solid var(--border)',
                        }}
                      >
                        <OptIcon size={12} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              background: 'color-mix(in oklab, var(--c-red) 8%, white)',
              color: 'var(--c-red)',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <DialogFooter style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={resetToDefaults}
            disabled={pending}
            data-testid="check-modes-reset"
            style={{
              padding: '6px 12px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--c-white)',
              cursor: pending ? 'not-allowed' : 'pointer',
              color: 'var(--fg-2)',
            }}
          >
            Reset to defaults
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={closeAndReset}
              disabled={pending}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--c-white)',
                cursor: pending ? 'not-allowed' : 'pointer',
                color: 'var(--fg-2)',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              data-testid="check-modes-save"
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: '1px solid color-mix(in oklab, var(--c-teal) 30%, transparent)',
                background: 'color-mix(in oklab, var(--c-teal) 14%, white)',
                color: '#1F7B66',
                cursor: pending ? 'not-allowed' : 'pointer',
              }}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
