'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Bot,
  Check,
  ChevronRight,
  Github,
  Hand,
  Loader2,
  Rocket,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { authClient } from '@/lib/auth/auth-client';
import { toast } from 'sonner';
import {
  setOnboardingPath,
  setBaseUrl,
  completeOnboarding,
  kickoffPlayAgent,
} from '@/server/actions/onboarding';
import { selectRepo, createLocalRepo, fetchAndSyncRepos, fetchAndSyncGitlabRepos } from '@/server/actions/repos';
import type { OnboardingPath } from '@/lib/db/schema';

type RepoLite = {
  id: string;
  fullName: string;
  provider: string;
  defaultBranch: string | null;
};

type AccountLite = { username: string };

interface OnboardingClientProps {
  initialStep: number;
  initialPath: OnboardingPath | null;
  userName: string;
  githubAccount: AccountLite | null;
  gitlabAccount: AccountLite | null;
  repos: RepoLite[];
  selectedRepoId: string | null;
  selectedRepoBaseUrl: string | null;
}

const PATHS: Array<{
  id: OnboardingPath;
  name: string;
  tagline: string;
  time: string;
  recommended?: boolean;
  bullets: string[];
  bestFor: string;
  Icon: typeof Hand;
}> = [
  {
    id: 'manual',
    name: 'Manual',
    tagline: 'Record by clicking, own the code.',
    time: '~3 min setup',
    bullets: ['No AI keys needed', 'Point-and-click recorder', 'Edit code by hand'],
    bestFor: 'Air-gapped · simple flows',
    Icon: Hand,
  },
  {
    id: 'ai',
    name: 'AI-assisted',
    tagline: 'You drive, AI helps.',
    time: '~5 min setup',
    recommended: true,
    bullets: ['AI generates from URL', 'AI fixes broken tests', 'You review + approve'],
    bestFor: 'Day-to-day dev',
    Icon: Sparkles,
  },
  {
    id: 'agent',
    name: 'Play agent',
    tagline: 'One click → full coverage.',
    time: '~20 min (mostly waiting)',
    bullets: ['11-step pipeline', 'Scans + plans + generates', 'Asks when stuck'],
    bestFor: 'New projects · full coverage',
    Icon: Bot,
  },
];

export function OnboardingClient({
  initialStep,
  initialPath,
  userName,
  githubAccount,
  gitlabAccount,
  repos,
  selectedRepoId,
  selectedRepoBaseUrl,
}: OnboardingClientProps) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [path, setPath] = useState<OnboardingPath | null>(initialPath ?? 'ai');
  const [pending, startTransition] = useTransition();

  // For manual path, step 4 (AI) is skipped entirely.
  const visibleSteps = useMemo(() => {
    if (path === 'manual') return [1, 2, 3, 5];
    return [1, 2, 3, 4, 5];
  }, [path]);

  const next = useCallback(() => {
    setStep((s) => {
      const idx = visibleSteps.indexOf(s);
      if (idx === -1 || idx === visibleSteps.length - 1) return s;
      return visibleSteps[idx + 1];
    });
  }, [visibleSteps]);

  const back = useCallback(() => {
    setStep((s) => {
      const idx = visibleSteps.indexOf(s);
      if (idx <= 0) return s;
      return visibleSteps[idx - 1];
    });
  }, [visibleSteps]);

  // Allow Esc to skip the current step (steps 2, 3, 4 only).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && step > 1 && step < 5) {
        next();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, next]);

  const finish = useCallback(
    async (target: string) => {
      await completeOnboarding();
      router.push(target);
    },
    [router],
  );

  const currentIndex = visibleSteps.indexOf(step);
  const progressPct = Math.round(((currentIndex + 1) / visibleSteps.length) * 100);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-8">
      {/* Top bar */}
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Lastest
        </Link>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            Step {currentIndex + 1} of {visibleSteps.length}
          </span>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Step body */}
      <div className="flex-1">
        {step === 1 && (
          <Step1Fork
            userName={userName}
            selected={path}
            onSelect={setPath}
            pending={pending}
            onNext={() => {
              if (!path) return;
              startTransition(async () => {
                await setOnboardingPath(path);
                next();
              });
            }}
          />
        )}

        {step === 2 && (
          <Step2Repo
            githubAccount={githubAccount}
            gitlabAccount={gitlabAccount}
            repos={repos}
            selectedRepoId={selectedRepoId}
            pending={pending}
            onSelectRepo={(repoId) =>
              startTransition(async () => {
                await selectRepo(repoId);
                router.refresh();
              })
            }
            onCreateSandbox={() =>
              startTransition(async () => {
                await createLocalRepo('My First Project');
                router.refresh();
              })
            }
            onSyncGithub={() =>
              startTransition(async () => {
                const result = await fetchAndSyncRepos();
                if (result.success) {
                  toast.success(`Synced ${result.count} repos`);
                  router.refresh();
                } else {
                  toast.error('No repos found');
                }
              })
            }
            onSyncGitlab={() =>
              startTransition(async () => {
                const result = await fetchAndSyncGitlabRepos();
                if (result.success) {
                  toast.success(`Synced ${result.count} projects`);
                  router.refresh();
                } else {
                  toast.error('No projects found');
                }
              })
            }
            onNext={next}
            onBack={back}
            onSkip={next}
          />
        )}

        {step === 3 && (
          <Step3Url
            selectedRepoId={selectedRepoId}
            currentBaseUrl={selectedRepoBaseUrl}
            pending={pending}
            onSave={(url) =>
              startTransition(async () => {
                if (!selectedRepoId) {
                  next();
                  return;
                }
                await setBaseUrl(selectedRepoId, url);
                next();
              })
            }
            onBack={back}
            onSkip={next}
          />
        )}

        {step === 4 && path !== 'manual' && (
          <Step4Ai
            path={path}
            pending={pending}
            onContinue={() => next()}
            onUseOwnKey={() => router.push('/settings?highlight=ai')}
            onBack={back}
            onSkip={next}
          />
        )}

        {step === 5 && (
          <Step5Launch
            path={path ?? 'ai'}
            selectedRepoId={selectedRepoId}
            selectedRepoBaseUrl={selectedRepoBaseUrl}
            pending={pending}
            onLaunch={async (target) => {
              if (path === 'agent' && selectedRepoId) {
                try {
                  await kickoffPlayAgent(selectedRepoId);
                  toast.success('Play agent started — watch it work in the activity feed.');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not start play agent');
                }
              }
              await finish(target);
            }}
            onSkipToDashboard={() => finish('/')}
            onBack={back}
          />
        )}
      </div>

      {/* Bottom escape hatch — always available */}
      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={() => finish('/')}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Skip setup, take me to the dashboard
        </button>
      </div>
    </div>
  );
}

// ─── Step 1: Fork ────────────────────────────────────────────────────────────

function Step1Fork({
  userName,
  selected,
  onSelect,
  onNext,
  pending,
}: {
  userName: string;
  selected: OnboardingPath | null;
  onSelect: (p: OnboardingPath) => void;
  onNext: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Hi {userName}, how do you want to build tests?
        </h1>
        <p className="text-sm text-muted-foreground">
          You can always switch later. This just tailors the setup.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PATHS.map((p) => {
          const active = selected === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className={`relative rounded-lg border-2 p-4 text-left transition-all ${
                active
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border bg-card hover:border-muted-foreground/40'
              }`}
            >
              {p.recommended && (
                <Badge
                  variant="default"
                  className="absolute -top-2 right-3 px-2 py-0.5 text-[10px] uppercase tracking-wider"
                >
                  Recommended
                </Badge>
              )}
              <div className="flex items-center gap-2">
                <p.Icon className="h-5 w-5 text-primary" />
                <h2 className="text-base font-semibold">{p.name}</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {p.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 space-y-0.5 border-t pt-2 text-[11px] uppercase tracking-wide text-muted-foreground/80">
                <div>{p.time}</div>
                <div>Best for: {p.bestFor}</div>
              </div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3 text-xs text-muted-foreground">
          <span className="font-medium">After you pick:</span>
          <Badge variant="outline">1 · connect repo</Badge>
          <ArrowRight className="h-3 w-3" />
          <Badge variant="outline">2 · base url</Badge>
          <ArrowRight className="h-3 w-3" />
          <Badge variant="outline">3 · path setup</Badge>
          <ArrowRight className="h-3 w-3" />
          <Badge variant="outline">4 · first build</Badge>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!selected || pending} size="lg">
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Continue
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 2: Connect repo ────────────────────────────────────────────────────

function Step2Repo({
  githubAccount,
  gitlabAccount,
  repos,
  selectedRepoId,
  pending,
  onSelectRepo,
  onCreateSandbox,
  onSyncGithub,
  onSyncGitlab,
  onNext,
  onBack,
  onSkip,
}: {
  githubAccount: AccountLite | null;
  gitlabAccount: AccountLite | null;
  repos: RepoLite[];
  selectedRepoId: string | null;
  pending: boolean;
  onSelectRepo: (id: string) => void;
  onCreateSandbox: () => void;
  onSyncGithub: () => void;
  onSyncGitlab: () => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const recentRepos = repos.slice(0, 5);
  const hasConnection = !!githubAccount || !!gitlabAccount;
  const hasSelected = !!selectedRepoId;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Connect your code</h1>
        <p className="text-sm text-muted-foreground">
          Link a repo so Lastest can scope tests, comment on PRs, and watch branches.
        </p>
      </div>

      {githubAccount && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5" />
              <div>
                <div className="text-sm font-medium">
                  Connected as @{githubAccount.username}
                </div>
                <div className="text-xs text-muted-foreground">GitHub</div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onSyncGithub} disabled={pending}>
              {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Sync repos
            </Button>
          </CardContent>
        </Card>
      )}

      {gitlabAccount && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5" />
              <div>
                <div className="text-sm font-medium">
                  Connected as @{gitlabAccount.username}
                </div>
                <div className="text-xs text-muted-foreground">GitLab</div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onSyncGitlab} disabled={pending}>
              {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Sync projects
            </Button>
          </CardContent>
        </Card>
      )}

      {recentRepos.length > 0 && (
        <Card>
          <CardContent className="space-y-1 py-3">
            <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recent repos
            </div>
            {recentRepos.map((r) => {
              const active = r.id === selectedRepoId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelectRepo(r.id)}
                  disabled={pending}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors ${
                    active ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Github className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono text-xs">{r.fullName}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {r.provider}
                    </Badge>
                  </div>
                  {active && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {!hasConnection && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button
            variant="outline"
            className="h-auto justify-start gap-2 py-3"
            onClick={() =>
              authClient.signIn.social({
                provider: 'github',
                callbackURL: '/onboarding?step=2',
              })
            }
          >
            <Github className="h-4 w-4" />
            <span>Connect GitHub</span>
          </Button>
          <Button asChild variant="outline" className="h-auto justify-start gap-2 py-3">
            <a href="/api/connect/gitlab">
              <Github className="h-4 w-4" />
              <span>Connect GitLab</span>
            </a>
          </Button>
          <Button
            variant="outline"
            className="h-auto justify-start gap-2 py-3"
            onClick={onCreateSandbox}
            disabled={pending}
          >
            <Rocket className="h-4 w-4" />
            <span>Use a sandbox</span>
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            I&apos;ll pick later
          </Button>
          <Button onClick={onNext} disabled={pending} size="lg">
            {hasSelected ? 'Continue' : 'Continue without a repo'}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Base URL ────────────────────────────────────────────────────────

function Step3Url({
  selectedRepoId,
  currentBaseUrl,
  pending,
  onSave,
  onBack,
  onSkip,
}: {
  selectedRepoId: string | null;
  currentBaseUrl: string | null;
  pending: boolean;
  onSave: (url: string) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [url, setUrl] = useState(currentBaseUrl ?? '');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Where does your app live?</h1>
        <p className="text-sm text-muted-foreground">
          Lastest needs a URL to point the browser at. You can change it per branch later.
        </p>
      </div>

      {!selectedRepoId && (
        <Card>
          <CardContent className="py-3 text-xs text-muted-foreground">
            No repo selected — we&apos;ll remember your URL once you pick one in Settings.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <Label htmlFor="base-url">Base URL</Label>
        <Input
          id="base-url"
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setUrl('http://localhost:3000')}
          >
            http://localhost:3000
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setUrl('https://playwright.dev')}
          >
            I don&apos;t have one — use a demo
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
          <Button
            onClick={() => onSave(url.trim())}
            disabled={!url.trim() || pending || !selectedRepoId}
            size="lg"
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save & continue
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: AI confirm (only ai-assisted + agent paths) ─────────────────────

function Step4Ai({
  path,
  pending,
  onContinue,
  onUseOwnKey,
  onBack,
  onSkip,
}: {
  path: OnboardingPath | null;
  pending: boolean;
  onContinue: () => void;
  onUseOwnKey: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const isAgent = path === 'agent';
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {isAgent ? 'Ready to fire up the agent?' : 'AI is on by default'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAgent
            ? "We'll kick off the play agent on your repo. It scans, plans, generates, and runs — you can watch from the activity feed."
            : "Lastest's hosted Claude is ready to generate and heal tests. Sound good?"}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <div className="text-sm font-medium">Lastest hosted AI</div>
              <div className="text-xs text-muted-foreground">
                Free during beta. No API key needed.
              </div>
            </div>
            <Badge variant="default">Default</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onUseOwnKey}>
            Use my own key →
          </Button>
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Disable AI
          </Button>
          <Button onClick={onContinue} disabled={pending} size="lg">
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isAgent ? 'Continue' : 'Yes, continue'}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 5: Launch ──────────────────────────────────────────────────────────

function Step5Launch({
  path,
  selectedRepoId,
  selectedRepoBaseUrl,
  pending,
  onLaunch,
  onSkipToDashboard,
  onBack,
}: {
  path: OnboardingPath;
  selectedRepoId: string | null;
  selectedRepoBaseUrl: string | null;
  pending: boolean;
  onLaunch: (target: string) => void;
  onSkipToDashboard: () => void;
  onBack: () => void;
}) {
  const urlQuery = selectedRepoBaseUrl
    ? `&url=${encodeURIComponent(selectedRepoBaseUrl)}`
    : '';
  const repoQuery = selectedRepoId ? `?repoId=${selectedRepoId}` : '';

  const config = (() => {
    if (path === 'manual') {
      return {
        title: "Let's record your first test",
        body: 'The recorder watches you click through your app and writes a Playwright test. Takes about 90 seconds.',
        cta: 'Open recorder',
        target: `/record${repoQuery}${urlQuery ? '&' + urlQuery.slice(1) : ''}`,
      };
    }
    if (path === 'ai') {
      return {
        title: "Let's generate your first test",
        body: 'Tell the AI what to test and it writes a draft you can run, review, and approve.',
        cta: 'Open generator',
        target: `/tests/new${repoQuery ? `${repoQuery}&ai=true` : '?ai=true'}${urlQuery}`,
      };
    }
    return {
      title: 'Agent is running',
      body: "The play agent is scanning your app, planning tests, and writing them now. Watch the live timeline on your dashboard — we'll keep you posted.",
      cta: 'Open activity feed',
      target: '/?focusActivity=1',
    };
  })();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{config.title}</h1>
        <p className="text-sm text-muted-foreground">{config.body}</p>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Rocket className="h-5 w-5 text-primary" />
            <div className="text-sm">
              <div className="font-medium">You&apos;re all set.</div>
              <div className="text-xs text-muted-foreground">
                {selectedRepoBaseUrl
                  ? `Target: ${selectedRepoBaseUrl}`
                  : 'No URL set — you can add one in Settings.'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSkipToDashboard} disabled={pending}>
            Just take me to the dashboard
          </Button>
          <Button onClick={() => onLaunch(config.target)} disabled={pending} size="lg">
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {config.cta}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
