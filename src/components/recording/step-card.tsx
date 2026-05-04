'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FormInput,
  Keyboard,
  ListFilter,
  Loader2,
  MousePointer,
  MousePointerClick,
  Navigation,
  ShieldCheck,
  Timer,
  Wand2,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { promoteSelector } from '@/server/actions/recording';
import { toast } from 'sonner';

export interface StepCardSelector {
  type: string;
  value: string;
}

export interface StepCardSelectorMatch extends StepCardSelector {
  count: number;
}

export interface StepCardVerification {
  syntaxValid: boolean;
  domVerified?: boolean;
  lastChecked?: number;
  selectorMatches?: StepCardSelectorMatch[];
  chosenSelector?: string;
  autoRepaired?: boolean;
}

export interface StepCardEvent {
  type: string;
  timestamp: number;
  sequence: number;
  status: 'preview' | 'committed';
  verification?: StepCardVerification;
  data: {
    action?: string;
    selector?: string;
    selectors?: StepCardSelector[];
    actionId?: string;
    thumbnailPath?: string;
    [key: string]: unknown;
  };
}

export interface StepCardProps {
  event: StepCardEvent;
  description: string;
  /** Pre-computed replay status from the host's `isActionReplayable` so the
   *  pill color stays consistent across the recorder's old logic and the
   *  new selectorMatches signal. */
  replayStatus: { replayable: boolean; reason?: 'valid-selectors' | 'coords-only' | 'no-selectors' };
  repositoryId?: string | null;
  /** Parent owns event state; this callback lets the card optimistically
   *  reflect a promoted selector before the runner round-trips back. */
  onPromoteOptimistic?: (actionId: string, selectorValue: string) => void;
}

type PillTone = 'green' | 'amber' | 'red' | 'muted';

function pillForMatches(
  matches: StepCardSelectorMatch[] | undefined,
  replayStatus: StepCardProps['replayStatus'],
  verification: StepCardVerification | undefined,
): { tone: PillTone; label: string; tooltip: string } | null {
  if (matches && matches.length > 0) {
    const chosen = matches.find(m => m.value === verification?.chosenSelector) ?? matches[0];
    if (!chosen) return null;
    if (chosen.count === 1) {
      return { tone: 'green', label: 'unique', tooltip: `Unique match: ${chosen.value}` };
    }
    if (chosen.count > 1) {
      return {
        tone: 'amber',
        label: `matches ${chosen.count}`,
        tooltip: `Selector matches ${chosen.count} elements — replay may pick the wrong one`,
      };
    }
    if (chosen.count === -1) {
      return { tone: 'green', label: 'role/text', tooltip: 'Resolved by Playwright role/text matcher' };
    }
    return { tone: 'red', label: 'no match', tooltip: 'Selector did not match the live DOM' };
  }
  // Fallback to legacy replay status when matches haven't arrived yet.
  if (!replayStatus.replayable) {
    return { tone: 'red', label: 'no selector', tooltip: 'No selectors and no coordinate fallback — may not replay' };
  }
  if (replayStatus.reason === 'coords-only') {
    return { tone: 'amber', label: 'coords only', tooltip: 'Falling back to mouse coordinates — fragile' };
  }
  if (verification?.domVerified) {
    return { tone: 'green', label: 'verified', tooltip: 'Selector resolved on the live page' };
  }
  if (verification?.syntaxValid) {
    return { tone: 'muted', label: 'verifying', tooltip: 'Checking selector against the DOM…' };
  }
  return null;
}

function toneClass(tone: PillTone): string {
  switch (tone) {
    case 'green':
      return 'border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400';
    case 'amber':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'red':
      return 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400';
    case 'muted':
      return 'border-border bg-muted/40 text-muted-foreground';
  }
}

function eventIcon(event: StepCardEvent) {
  switch (event.type) {
    case 'navigation':
      return <Navigation className="h-3 w-3 text-blue-500" />;
    case 'screenshot':
      return <Camera className="h-3 w-3 text-yellow-500" />;
    case 'mouse-down':
      return <MousePointerClick className="h-3 w-3 text-red-500" />;
    case 'mouse-up':
      return <MousePointerClick className="h-3 w-3 text-red-300" />;
    case 'hover-preview':
      return <Eye className="h-3 w-3 text-gray-400" />;
    case 'keypress':
      return <Keyboard className="h-3 w-3 text-indigo-500" />;
    case 'keydown':
      return <Keyboard className="h-3 w-3 text-green-500" />;
    case 'keyup':
      return <Keyboard className="h-3 w-3 text-orange-400" />;
    case 'download':
      return <Download className="h-3 w-3 text-emerald-500" />;
    case 'wait':
      return <Timer className="h-3 w-3 text-sky-500" />;
    case 'insert-timestamp':
      return <CalendarClock className="h-3 w-3 text-amber-500" />;
    case 'assertion':
      return event.data.elementAssertion
        ? <ShieldCheck className="h-3 w-3 text-teal-500" />
        : <CheckCircle2 className="h-3 w-3 text-purple-500" />;
    case 'action':
      if (event.data.action === 'click') return <MousePointer className="h-3 w-3 text-green-500" />;
      if (event.data.action === 'fill') return <FormInput className="h-3 w-3 text-orange-500" />;
      if (event.data.action === 'selectOption') return <ListFilter className="h-3 w-3 text-cyan-500" />;
      return <MousePointer className="h-3 w-3 text-muted-foreground" />;
    default:
      return null;
  }
}

export function StepCard({
  event,
  description,
  replayStatus,
  repositoryId,
  onPromoteOptimistic,
}: StepCardProps) {
  const verification = event.verification;
  const matches = verification?.selectorMatches;
  const isAction = event.type === 'action' && event.status === 'committed';
  const pill = useMemo(
    () => (isAction ? pillForMatches(matches, replayStatus, verification) : null),
    [isAction, matches, replayStatus, verification],
  );
  const [altsOpen, setAltsOpen] = useState(false);
  const [promoting, setPromoting] = useState(false);

  const thumbnail = event.data.thumbnailPath;
  const hasAlternatives = !!matches && matches.length > 1;
  const chosenValue = verification?.chosenSelector ?? event.data.selector ?? '';

  const handlePromote = async (selectorValue: string) => {
    if (!event.data.actionId || promoting || selectorValue === chosenValue) return;
    setPromoting(true);
    try {
      onPromoteOptimistic?.(event.data.actionId, selectorValue);
      const result = await promoteSelector(event.data.actionId, selectorValue, repositoryId);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to promote selector');
      } else {
        toast.success('Selector promoted');
      }
    } finally {
      setPromoting(false);
      setAltsOpen(false);
    }
  };

  return (
    <div
      className={`flex items-start gap-2 text-sm rounded-md px-1.5 py-1 hover:bg-muted/40 transition-colors ${
        event.status === 'preview' ? 'opacity-60 border-l-2 border-dashed border-muted-foreground pl-2' : ''
      }`}
    >
      <div className="mt-0.5 shrink-0">{eventIcon(event)}</div>

      {thumbnail ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnail}
              alt="step thumbnail"
              className="h-7 w-7 rounded border border-border object-cover shrink-0"
            />
          </TooltipTrigger>
          <TooltipContent side="left" className="p-1 bg-background border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnail} alt="step thumbnail (large)" className="max-w-60 rounded" />
          </TooltipContent>
        </Tooltip>
      ) : null}

      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
          <span className="truncate text-foreground">{description}</span>
        </div>

        {(pill || verification?.autoRepaired) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {pill && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] leading-4 ${toneClass(pill.tone)}`}
                  >
                    {pill.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{pill.tooltip}</TooltipContent>
              </Tooltip>
            )}
            {verification?.autoRepaired && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-blue-500/40 bg-blue-500/10 px-1.5 py-0 text-[10px] leading-4 text-blue-600 dark:text-blue-400">
                    <Wand2 className="h-2.5 w-2.5" />
                    repaired
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Autorepair promoted a more unique selector: {verification.chosenSelector}
                </TooltipContent>
              </Tooltip>
            )}
            {hasAlternatives && (
              <Popover open={altsOpen} onOpenChange={setAltsOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 rounded border border-border bg-muted/40 px-1.5 py-0 text-[10px] leading-4 text-muted-foreground hover:text-foreground"
                  >
                    {altsOpen ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
                    {matches!.length} selectors
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-2 space-y-1">
                  <div className="text-xs font-medium pb-1">Alternative selectors</div>
                  {matches!.map(m => {
                    const isChosen = m.value === chosenValue;
                    const tone: PillTone = m.count === 1 ? 'green' : m.count > 1 ? 'amber' : m.count === -1 ? 'green' : 'red';
                    return (
                      <button
                        key={`${m.type}-${m.value}`}
                        type="button"
                        disabled={isChosen || promoting}
                        onClick={() => handlePromote(m.value)}
                        className={`w-full text-left text-xs p-1.5 rounded border ${
                          isChosen
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-muted/60'
                        } disabled:cursor-default`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] ${toneClass(tone)}`}>
                            {m.count === -1 ? 'role/text' : m.count === 1 ? 'unique' : m.count === 0 ? 'no match' : `matches ${m.count}`}
                          </span>
                          <span className="text-muted-foreground text-[10px] uppercase tracking-wide">{m.type}</span>
                          {isChosen && <span className="ml-auto text-[10px] text-primary">in use</span>}
                        </div>
                        <div className="font-mono text-[10px] mt-0.5 truncate" title={m.value}>{m.value}</div>
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}
      </div>

      <div className="mt-0.5 flex items-center justify-end w-5 shrink-0">
        {isAction && (
          <div title={
            !replayStatus.replayable ? 'No selectors - may not replay' :
            replayStatus.reason === 'coords-only' ? 'Coords fallback only' :
            verification?.domVerified ? 'Verified' :
            verification?.syntaxValid ? 'Verifying...' : 'Checking...'
          }>
            {!replayStatus.replayable ? (
              <AlertTriangle className="h-3 w-3 text-red-500" />
            ) : replayStatus.reason === 'coords-only' ? (
              <Check className="h-3 w-3 text-yellow-500" />
            ) : verification?.domVerified ? (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            ) : verification?.syntaxValid ? (
              <div className="flex items-center">
                <Check className="h-3 w-3 text-green-500" />
                <Loader2 className="h-2.5 w-2.5 text-muted-foreground animate-spin ml-0.5" />
              </div>
            ) : (
              <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
