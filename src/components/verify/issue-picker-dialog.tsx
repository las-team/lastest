'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CircleDot, ExternalLink, Loader2, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  createIssueForCase,
  linkIssueToCase,
  searchIssuesForCase,
} from '@/server/actions/verify-issues';
import type { GitHubIssueListItem } from '@/lib/integrations/github-issues';
import '../../app/(app)/verify/verify-design.css';

interface IssuePickerDialogProps {
  open: boolean;
  onClose: () => void;
  stepComparisonId: string;
  caseTitle: string;
  /** Pre-fill for the Create-tab body. Reviewer note + test/step context. */
  defaultBody?: string;
  defaultTitle?: string;
  /** Fired after a successful link or create. Used by the verify page to
   *  pull a fresh /verify-status snapshot — without this, the parent's
   *  `stepComparisons` state stays stale (it only seeds from props on first
   *  mount) so the chip won't update until a hard reload. */
  onLinked?: () => void;
}

type Tab = 'browse' | 'create';

export function IssuePickerDialog({
  open,
  onClose,
  stepComparisonId,
  caseTitle,
  defaultBody,
  defaultTitle,
  onLinked,
}: IssuePickerDialogProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('browse');
  const [query, setQuery] = useState('');
  const [issues, setIssues] = useState<GitHubIssueListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [createTitle, setCreateTitle] = useState(defaultTitle ?? caseTitle);
  const [createBody, setCreateBody] = useState(defaultBody ?? '');

  // (No prop-sync effect — the parent re-mounts this component with a fresh
  // `key` per case, which resets all internal state.)

  // Live search with debounce.
  useEffect(() => {
    if (!open || tab !== 'browse') return;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      const res = await searchIssuesForCase(stepComparisonId, query.trim() || undefined);
      setSearching(false);
      if (!res.ok) {
        setSearchError(res.error ?? 'Failed to load issues');
        setIssues([]);
        return;
      }
      setIssues(res.issues ?? []);
    }, 300);
    return () => clearTimeout(timer);
  }, [open, tab, query, stepComparisonId]);

  const handleLink = (issue: GitHubIssueListItem) => {
    startTransition(async () => {
      const res = await linkIssueToCase({ stepComparisonId, issueUrl: issue.url });
      if (res.ok) {
        onClose();
        onLinked?.();
        router.refresh();
      } else {
        setSearchError(res.error ?? 'Failed to link issue');
      }
    });
  };

  const handleCreate = () => {
    startTransition(async () => {
      const res = await createIssueForCase({
        stepComparisonId,
        title: createTitle.trim() || undefined,
        body: createBody.trim() || undefined,
      });
      if (res.ok) {
        onClose();
        onLinked?.();
        router.refresh();
      } else {
        setSearchError(res.error ?? 'Failed to create issue');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="verify-page max-w-xl">
        <DialogHeader>
          <DialogTitle>Link a GitHub issue to this case</DialogTitle>
          <DialogDescription>
            Browse open issues from this repo, or file a new one. The case&apos;s test/step context is pre-filled.
          </DialogDescription>
        </DialogHeader>

        <div className="v-tabs" style={{ width: 'fit-content', marginBottom: 12 }}>
          <button className={`v-tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>
            Browse
          </button>
          <button className={`v-tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>
            Create new
          </button>
        </div>

        {tab === 'browse' ? (
          <BrowseTab
            query={query}
            onQueryChange={setQuery}
            issues={issues}
            searching={searching}
            error={searchError}
            onLink={handleLink}
            disabled={pending}
          />
        ) : (
          <CreateTab
            title={createTitle}
            onTitleChange={setCreateTitle}
            body={createBody}
            onBodyChange={setCreateBody}
            onCreate={handleCreate}
            error={searchError}
            pending={pending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BrowseTab({
  query,
  onQueryChange,
  issues,
  searching,
  error,
  onLink,
  disabled,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  issues: GitHubIssueListItem[];
  searching: boolean;
  error: string | null;
  onLink: (i: GitHubIssueListItem) => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-3)' }} />
        <input
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search issues by title…"
          style={{
            width: '100%',
            padding: '8px 10px 8px 30px',
            fontSize: 13,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--c-white)',
            color: 'var(--fg-1)',
          }}
        />
      </div>
      {error && <div className="v-chip regression" style={{ alignSelf: 'flex-start' }}>{error}</div>}
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {searching && (
          <div className="label" style={{ padding: 12, textAlign: 'center' }}>
            <Loader2 size={12} style={{ animation: 'verify-spin 1s linear infinite', verticalAlign: 'middle', marginRight: 6 }} />
            searching…
          </div>
        )}
        {!searching && issues.length === 0 && !error && (
          <div className="label" style={{ padding: 12, textAlign: 'center' }}>no issues found</div>
        )}
        {issues.map((issue) => (
          <button
            key={issue.number}
            onClick={() => onLink(issue)}
            disabled={disabled}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '8px 10px', borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--c-white)',
              cursor: disabled ? 'wait' : 'pointer',
              textAlign: 'left',
            }}
          >
            <CircleDot
              size={14}
              style={{ marginTop: 2, color: issue.state === 'open' ? 'var(--c-teal)' : 'var(--fg-3)', flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg-1)' }}>
                <span className="mono" style={{ color: 'var(--fg-3)', marginRight: 6 }}>#{issue.number}</span>
                {issue.title}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {issue.labels.slice(0, 3).map((l) => (
                  <span key={l} className="v-chip" style={{ fontSize: 9, padding: '0 5px' }}>{l}</span>
                ))}
              </div>
            </div>
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open in GitHub"
              style={{ color: 'var(--fg-3)', padding: 2, alignSelf: 'center' }}
            >
              <ExternalLink size={12} />
            </a>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateTab({
  title,
  onTitleChange,
  body,
  onBodyChange,
  onCreate,
  error,
  pending,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  body: string;
  onBodyChange: (v: string) => void;
  onCreate: () => void;
  error: string | null;
  pending: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="label" style={{ fontSize: 9 }}>Title</span>
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          style={{
            padding: '8px 10px',
            fontSize: 13,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--c-white)',
            color: 'var(--fg-1)',
          }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="label" style={{ fontSize: 9 }}>Body (markdown)</span>
        <textarea
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          rows={10}
          style={{
            padding: '8px 10px',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--c-white)',
            color: 'var(--fg-1)',
            resize: 'vertical',
            minHeight: 200,
          }}
        />
      </label>
      <div className="label" style={{ fontSize: 10 }}>
        Test name, step label, build, branch + evidence are auto-appended below your text.
      </div>
      {error && <div className="v-chip regression" style={{ alignSelf: 'flex-start' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="v-btn" onClick={onCreate} disabled={pending || title.trim().length === 0}>
          {pending ? 'Filing…' : 'File issue'}
        </button>
      </div>
    </div>
  );
}
