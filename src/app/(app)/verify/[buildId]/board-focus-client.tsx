'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Filter, GitBranch, Play } from 'lucide-react';
import { runSmartBuild } from '@/server/actions/smart-run';
import { decideLayer } from '@/server/actions/layer-feedback';
import type {
  Build,
  ChangeMap,
  EvidenceLayer,
  StepComparison,
  StepLayerFeedback,
} from '@/lib/db/schema';
import { BoardView } from './board-view';
import { FocusView } from './focus-view';
import '../verify-design.css';

interface AreaLite { id: string; name: string }
interface TestLite { id: string; name: string; functionalAreaId: string | null }

interface BoardFocusClientProps {
  build: Build;
  branch: string | null;
  changeMap: ChangeMap | null;
  stepComparisons: StepComparison[];
  areas: AreaLite[];
  tests: TestLite[];
  layerFeedback: StepLayerFeedback[];
  repositoryId: string | null;
}

type Mode = 'board' | 'focus';

export function BoardFocusClient(props: BoardFocusClientProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('board');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [pending, startTransition] = useTransition();

  const testById = useMemo(() => new Map(props.tests.map((t) => [t.id, t])), [props.tests]);
  const areaById = useMemo(() => new Map(props.areas.map((a) => [a.id, a])), [props.areas]);
  const changedAreaIds = useMemo(
    () => new Set(props.changeMap?.areas
      .filter((a) => a.sources.includes('code') || a.sources.includes('manual'))
      .map((a) => a.areaId) ?? []),
    [props.changeMap],
  );

  const totalCases = props.stepComparisons.length;
  const verifiedCount = useMemo(() => {
    const decided = new Set<string>();
    for (const f of props.layerFeedback) {
      if (f.status === 'approved' || f.status === 'auto_approved' || f.status === 'rejected') {
        decided.add(f.stepComparisonId);
      }
    }
    return decided.size;
  }, [props.layerFeedback]);

  const handleRefresh = () => {
    if (!props.repositoryId) return;
    startRefresh(async () => {
      await runSmartBuild(props.repositoryId!);
      router.refresh();
    });
  };

  const decideAllForStep = (stepId: string, status: 'approved' | 'rejected' | 'snoozed') => {
    const step = props.stepComparisons.find((s) => s.id === stepId);
    if (!step) return;
    const layers: EvidenceLayer[] = step.evidence.length > 0
      ? step.evidence.map((e) => e.layer)
      : ['visual'];
    startTransition(async () => {
      for (const layer of layers) {
        await decideLayer({ stepComparisonId: stepId, buildId: props.build.id, layer, status });
      }
      router.refresh();
    });
  };

  const handleOpenCase = (stepId: string) => {
    setSelectedStepId(stepId);
    setMode('focus');
  };

  return (
    <div className="verify-page" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--c-soft-2)', minHeight: 0, fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--c-white)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/verify" className="wm" style={{ fontSize: 16, textDecoration: 'none', color: 'var(--fg-1)' }}>
            LASTES<span className="t">T</span>
          </Link>
          <span style={{ width: 1, height: 18, background: 'var(--border-strong)' }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-1)' }}>Verify</div>
            <div className="label" style={{ marginTop: 2 }}>
              Build #{props.build.id.slice(0, 8)} · {branchAndCommit(props.branch, props.build)} · {mode === 'board' ? `${verifiedCount} / ${totalCases} verified` : `${totalCases} cases`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Board ⇄ Focus segmented tabs */}
          <div className="v-tabs">
            <button
              className={`v-tab ${mode === 'board' ? 'active' : ''}`}
              onClick={() => setMode('board')}
            >
              Board
            </button>
            <button
              className={`v-tab ${mode === 'focus' ? 'active' : ''}`}
              onClick={() => setMode('focus')}
            >
              Focus
            </button>
          </div>
          <button className="v-btn"><Filter size={13} />Filter</button>
          <button className="v-btn">
            <GitBranch size={13} />
            {props.branch ?? 'unknown'}
          </button>
          <button
            className="v-btn primary"
            onClick={handleRefresh}
            disabled={refreshing || !props.repositoryId}
          >
            <Play size={13} />{refreshing ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {mode === 'board' ? (
        <BoardView
          steps={props.stepComparisons}
          feedback={props.layerFeedback}
          testById={testById}
          areaById={areaById}
          changedAreaIds={changedAreaIds}
          changeMap={props.changeMap}
          onOpenCase={handleOpenCase}
          onMarkIntended={(id) => decideAllForStep(id, 'approved')}
          onMarkMissed={(id) => decideAllForStep(id, 'rejected')}
          onTriage={handleOpenCase}
          onSkip={(id) => decideAllForStep(id, 'snoozed')}
        />
      ) : (
        <FocusView
          buildId={props.build.id}
          steps={props.stepComparisons}
          feedback={props.layerFeedback}
          testById={testById}
          areaById={areaById}
          changedAreaIds={changedAreaIds}
          changeMap={props.changeMap}
          selectedStepId={selectedStepId}
          onSelect={setSelectedStepId}
        />
      )}

      {/* aria-live announce for pending state, no visual */}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
        {pending ? 'Saving decision' : ''}
      </div>
    </div>
  );
}

function branchAndCommit(branch: string | null, build: Build): string {
  const parts: string[] = [];
  if (branch) parts.push(branch);
  if (build.completedAt) parts.push(new Date(build.completedAt).toLocaleDateString());
  parts.push(`${build.totalTests ?? 0} tests`);
  return parts.join(' · ');
}
