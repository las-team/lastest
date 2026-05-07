'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Loader2,
  Wand2,
  Trash2,
  Check,
  X,
  AlertCircle,
  BookOpen,
  ListChecks,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  createUserStory,
  updateUserStoryFields,
  deleteUserStory,
  addAcceptanceCriterion,
  updateAcceptanceCriterion,
  removeAcceptanceCriterion,
  generatePlanFromStory,
  regeneratePlaceholdersFromPlan,
} from '@/server/actions/user-stories';
import type { UserStory, AcceptanceCriterion } from '@/lib/db/schema';

interface AreaStoriesPanelProps {
  repositoryId: string;
  areaId: string;
  areaName: string;
  stories: UserStory[];
  /** AC id -> count of tests in this area covering that AC. Drives the coverage badges. */
  coverageByAcId: Record<string, number>;
}

export function AreaStoriesPanel({
  repositoryId,
  areaId,
  areaName,
  stories,
  coverageByAcId,
}: AreaStoriesPanelProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAsA, setNewAsA] = useState('');
  const [newIWant, setNewIWant] = useState('');
  const [newSoThat, setNewSoThat] = useState('');
  const [pending, startTransition] = useTransition();

  const handleCreate = async () => {
    if (!newTitle.trim()) {
      toast.error('Title is required');
      return;
    }
    setCreating(true);
    try {
      await createUserStory({
        repositoryId,
        functionalAreaId: areaId,
        title: newTitle,
        asA: newAsA || undefined,
        iWant: newIWant || undefined,
        soThat: newSoThat || undefined,
      });
      setNewTitle(''); setNewAsA(''); setNewIWant(''); setNewSoThat('');
      toast.success('User story created');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create story');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{areaName} — User Stories</h3>
          <Badge variant="secondary" className="h-5">
            {stories.length}
          </Badge>
        </div>
      </div>

      {stories.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground text-center">
          No stories yet. Add one below — it&apos;ll drive the test plan and the placeholders for this area.
        </div>
      )}

      {stories.map(story => (
        <StoryEditor
          key={story.id}
          story={story}
          coverageByAcId={coverageByAcId}
          onChanged={() => startTransition(() => router.refresh())}
          areaId={areaId}
        />
      ))}

      <div className="rounded-md border p-3 space-y-2 bg-muted/30">
        <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
          New story
        </div>
        <Input
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          placeholder="Story title (e.g. &quot;Login with email&quot;)"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={newAsA}
            onChange={e => setNewAsA(e.target.value)}
            placeholder="As a … (role)"
          />
          <Input
            value={newIWant}
            onChange={e => setNewIWant(e.target.value)}
            placeholder="I want to … (capability)"
          />
          <Input
            value={newSoThat}
            onChange={e => setNewSoThat(e.target.value)}
            placeholder="So that … (benefit)"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleCreate} disabled={creating || pending} size="sm">
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5 mr-1.5" />
            )}
            Add story
          </Button>
        </div>
      </div>
    </div>
  );
}

function StoryEditor({
  story,
  coverageByAcId,
  onChanged,
  areaId,
}: {
  story: UserStory;
  coverageByAcId: Record<string, number>;
  onChanged: () => void;
  areaId: string;
}) {
  const [title, setTitle] = useState(story.title);
  const [asA, setAsA] = useState(story.asA ?? '');
  const [iWant, setIWant] = useState(story.iWant ?? '');
  const [soThat, setSoThat] = useState(story.soThat ?? '');
  const [description, setDescription] = useState(story.description ?? '');
  const [newAcText, setNewAcText] = useState('');
  const [savingFields, setSavingFields] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [generatingPlaceholders, setGeneratingPlaceholders] = useState(false);

  const acs = (story.acceptanceCriteria ?? []) as AcceptanceCriterion[];
  const dirty =
    title !== story.title ||
    asA !== (story.asA ?? '') ||
    iWant !== (story.iWant ?? '') ||
    soThat !== (story.soThat ?? '') ||
    description !== (story.description ?? '');

  const saveFields = async () => {
    setSavingFields(true);
    try {
      await updateUserStoryFields(story.id, {
        title,
        asA: asA || null,
        iWant: iWant || null,
        soThat: soThat || null,
        description: description || null,
      });
      toast.success('Story saved');
      onChanged();
    } catch {
      toast.error('Failed to save story');
    } finally {
      setSavingFields(false);
    }
  };

  const handleAddAc = async () => {
    if (!newAcText.trim()) return;
    try {
      await addAcceptanceCriterion(story.id, newAcText);
      setNewAcText('');
      onChanged();
    } catch {
      toast.error('Failed to add AC');
    }
  };

  const handleGeneratePlan = async () => {
    setGeneratingPlan(true);
    try {
      await generatePlanFromStory(story.id);
      toast.success('Plan generated from story');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate plan');
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleSeedPlaceholders = async () => {
    setGeneratingPlaceholders(true);
    try {
      const result = await regeneratePlaceholdersFromPlan(areaId);
      toast.success(`Created ${result.created} placeholder${result.created === 1 ? '' : 's'} (${result.skipped} already existed)`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to seed placeholders');
    } finally {
      setGeneratingPlaceholders(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete story "${story.title}"?`)) return;
    try {
      await deleteUserStory(story.id);
      toast.success('Story deleted');
      onChanged();
    } catch {
      toast.error('Failed to delete story');
    }
  };

  const totalCovered = acs.filter(ac => (coverageByAcId[ac.id] ?? 0) > 0).length;

  return (
    <div className="rounded-md border p-4 space-y-3 bg-background">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="text-base font-semibold"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input
              value={asA}
              onChange={e => setAsA(e.target.value)}
              placeholder="As a …"
            />
            <Input
              value={iWant}
              onChange={e => setIWant(e.target.value)}
              placeholder="I want to …"
            />
            <Input
              value={soThat}
              onChange={e => setSoThat(e.target.value)}
              placeholder="So that …"
            />
          </div>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional product context / spec excerpt"
            rows={2}
          />
        </div>
        <div className="flex flex-col items-end gap-2">
          {story.planStale && (
            <Badge variant="outline" className="text-amber-600 border-amber-500">
              <AlertCircle className="h-3 w-3 mr-1" /> plan stale
            </Badge>
          )}
          <div className="text-xs text-muted-foreground">
            {totalCovered}/{acs.length} ACs covered
          </div>
        </div>
      </div>

      {dirty && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => {
            setTitle(story.title);
            setAsA(story.asA ?? '');
            setIWant(story.iWant ?? '');
            setSoThat(story.soThat ?? '');
            setDescription(story.description ?? '');
          }}>Discard</Button>
          <Button size="sm" onClick={saveFields} disabled={savingFields}>
            {savingFields ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
      )}

      <div className="border-t pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Acceptance criteria</span>
        </div>
        {acs.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            Add at least one AC before generating a plan.
          </div>
        )}
        <ul className="space-y-1.5">
          {acs.map(ac => (
            <AcRow
              key={ac.id}
              storyId={story.id}
              ac={ac}
              testCount={coverageByAcId[ac.id] ?? 0}
              onChanged={onChanged}
            />
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            value={newAcText}
            onChange={e => setNewAcText(e.target.value)}
            placeholder="When user does X on /path, then Y is visible"
            onKeyDown={e => { if (e.key === 'Enter') handleAddAc(); }}
          />
          <Button size="sm" variant="outline" onClick={handleAddAc} disabled={!newAcText.trim()}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add AC
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-t pt-3 gap-2 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={handleGeneratePlan} disabled={generatingPlan || acs.length === 0}>
            {generatingPlan ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
            Generate plan from story
          </Button>
          <Button size="sm" variant="outline" onClick={handleSeedPlaceholders} disabled={generatingPlaceholders}>
            {generatingPlaceholders ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5 mr-1.5" />}
            Seed test placeholders from plan
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={handleDelete} className="text-destructive hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
        </Button>
      </div>
    </div>
  );
}

function AcRow({
  storyId,
  ac,
  testCount,
  onChanged,
}: {
  storyId: string;
  ac: AcceptanceCriterion;
  testCount: number;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(ac.text);

  const save = async () => {
    if (text.trim() === ac.text) { setEditing(false); return; }
    try {
      await updateAcceptanceCriterion(storyId, ac.id, text);
      setEditing(false);
      onChanged();
    } catch {
      toast.error('Failed to update AC');
    }
  };

  const remove = async () => {
    try {
      await removeAcceptanceCriterion(storyId, ac.id);
      onChanged();
    } catch {
      toast.error('Failed to delete AC');
    }
  };

  return (
    <li className="flex items-start gap-2 group">
      <code className="text-xs text-muted-foreground mt-1 font-mono">{ac.id}</code>
      {editing ? (
        <div className="flex-1 flex gap-1">
          <Input value={text} onChange={e => setText(e.target.value)} className="h-8" />
          <Button size="sm" variant="ghost" onClick={save}><Check className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={() => { setText(ac.text); setEditing(false); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex-1 flex items-start gap-2">
          <span className="text-sm flex-1 cursor-text" onClick={() => setEditing(true)}>{ac.text}</span>
          <Badge variant={testCount > 0 ? 'default' : 'outline'} className="shrink-0">
            {testCount > 0 ? `${testCount} test${testCount === 1 ? '' : 's'}` : 'pending'}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={remove}
            className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0"
            aria-label="Delete AC"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </li>
  );
}
