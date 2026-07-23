"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  upsertExplorerKnowledge,
  deleteExplorerKnowledge,
} from "@/server/actions/explorer-agent";
import type { KnowledgeMatchKind } from "@/lib/db/schema";
import { BookOpen, Plus, Trash2, KeyRound } from "lucide-react";
import { toast } from "sonner";

/** Knowledge rows as shipped to the client: password replaced by a flag. */
export interface KnowledgeListItem {
  id: string;
  title: string;
  urlPattern: string;
  matchKind: KnowledgeMatchKind;
  body: string;
  credEmail: string | null;
  hasCredentials: boolean;
  enabled: boolean;
}

interface DraftNote {
  id?: string;
  title: string;
  urlPattern: string;
  matchKind: KnowledgeMatchKind;
  body: string;
  credEmail: string;
  credPassword: string;
}

const EMPTY_DRAFT: DraftNote = {
  title: "",
  urlPattern: "/",
  matchKind: "prefix",
  body: "",
  credEmail: "",
  credPassword: "",
};

export function KnowledgeEditor({
  repositoryId,
  initialNotes,
}: {
  repositoryId: string;
  initialNotes: KnowledgeListItem[];
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState<DraftNote | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const { id } = await upsertExplorerKnowledge({
        id: draft.id,
        repositoryId,
        title: draft.title,
        urlPattern: draft.urlPattern,
        matchKind: draft.matchKind,
        body: draft.body,
        credEmail: draft.credEmail || undefined,
        // Only send a password when the user typed one — keeps existing.
        ...(draft.credPassword ? { credPassword: draft.credPassword } : {}),
      });
      const updated: KnowledgeListItem = {
        id,
        title: draft.title,
        urlPattern: draft.urlPattern,
        matchKind: draft.matchKind,
        body: draft.body,
        credEmail: draft.credEmail || null,
        hasCredentials: Boolean(
          draft.credPassword || notes.find((n) => n.id === id)?.hasCredentials,
        ),
        enabled: true,
      };
      setNotes((prev) => {
        const idx = prev.findIndex((n) => n.id === id);
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
      setDraft(null);
      toast.success("Knowledge note saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteExplorerKnowledge(id, repositoryId);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      toast.success("Knowledge note deleted");
    } catch {
      toast.error("Could not delete the note");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Knowledge
            <span className="text-xs font-normal text-muted-foreground">
              hints the explorer loads when a matching page opens
            </span>
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add note
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {draft && (
          <div className="rounded-md border p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="k-title">Title</Label>
                <Input
                  id="k-title"
                  value={draft.title}
                  placeholder="Login credentials"
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </div>
              <div className="flex gap-2">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="k-pattern">URL pattern</Label>
                  <Input
                    id="k-pattern"
                    value={draft.urlPattern}
                    placeholder="/admin/*"
                    onChange={(e) =>
                      setDraft({ ...draft, urlPattern: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1 w-28">
                  <Label>Match</Label>
                  <Select
                    value={draft.matchKind}
                    onValueChange={(v) =>
                      setDraft({ ...draft, matchKind: v as KnowledgeMatchKind })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prefix">prefix</SelectItem>
                      <SelectItem value="exact">exact</SelectItem>
                      <SelectItem value="regex">regex</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="k-body">Hint (markdown)</Label>
              <Textarea
                id="k-body"
                rows={4}
                value={draft.body}
                placeholder={
                  "The date filter expects DD.MM.YYYY.\nUse the demo project, never touch 'Production'."
                }
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="k-email">Login email (optional)</Label>
                <Input
                  id="k-email"
                  value={draft.credEmail}
                  autoComplete="off"
                  onChange={(e) =>
                    setDraft({ ...draft, credEmail: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="k-password">
                  Password (optional{draft.id ? ", blank keeps existing" : ""})
                </Label>
                <Input
                  id="k-password"
                  type="password"
                  value={draft.credPassword}
                  autoComplete="new-password"
                  onChange={(e) =>
                    setDraft({ ...draft, credPassword: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                Save note
              </Button>
            </div>
          </div>
        )}
        {notes.length === 0 && !draft ? (
          <p className="text-sm text-muted-foreground">
            No knowledge yet. Add credentials, form quirks, or navigation hints
            — the explorer injects matching notes into its planning and testing
            prompts.
          </p>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className="rounded-md border p-3 flex items-start justify-between gap-2"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{note.title}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {note.urlPattern}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {note.matchKind}
                  </Badge>
                  {note.hasCredentials && (
                    <KeyRound className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">
                  {note.body}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setDraft({
                      id: note.id,
                      title: note.title,
                      urlPattern: note.urlPattern,
                      matchKind: note.matchKind,
                      body: note.body,
                      credEmail: note.credEmail ?? "",
                      credPassword: "",
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={() => remove(note.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
