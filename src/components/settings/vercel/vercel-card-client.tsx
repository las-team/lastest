"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2, Save, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  VercelProjectConfig,
  VercelRunOn,
  Repository,
} from "@/lib/db/schema";
import {
  ConnectVercelButton,
  VercelLogo,
} from "@/components/settings/connect-vercel-button";
import {
  refreshVercelProjectsAction,
  createVercelProjectConfigAction,
  updateVercelProjectConfigAction,
  deleteVercelProjectConfigAction,
  disconnectVercelAction,
} from "@/server/actions/vercel";
import { toast } from "sonner";

interface VercelProjectOption {
  id: string;
  name: string;
}

interface VercelCardProps {
  account: { vercelTeamId: string | null; vercelUserId: string | null } | null;
  configs: VercelProjectConfig[];
  repos: Repository[];
}

const RUN_ON_LABELS: Record<VercelRunOn, string> = {
  preview: "Preview only",
  production: "Production only",
  both: "Preview + Production",
};

export function VercelCard({ account, configs, repos }: VercelCardProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const repoName = (id: string) =>
    repos.find((r) => r.id === id)?.fullName ?? "Unknown repo";

  const mappedProjectIds = new Set(configs.map((c) => c.vercelProjectId));

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectVercelAction();
      toast.success("Vercel disconnected");
    } catch {
      toast.error("Failed to disconnect Vercel");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card id="vercel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <VercelLogo className="w-4 h-4" />
            Vercel
            <Badge variant="outline" className="text-[10px]">
              Marketplace
            </Badge>
          </CardTitle>
          <CardDescription>
            Run a Lastest visual-regression check on every Vercel deployment. No
            GitHub Actions workflow required.
          </CardDescription>
        </div>
        {account && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add project
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!account ? (
          <>
            <p className="text-sm text-muted-foreground">
              Install Lastest from the Vercel Marketplace, then map each Vercel
              project to a Lastest repository. Deterministic replays, $0 in AI
              tokens per run.
            </p>
            <ConnectVercelButton />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                  <VercelLogo className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-medium text-sm">Connected</div>
                  <div className="text-xs text-muted-foreground">
                    {account.vercelTeamId
                      ? `Team ${account.vercelTeamId}`
                      : "Personal account"}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-destructive hover:text-destructive"
              >
                {disconnecting && (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                )}
                Disconnect
              </Button>
            </div>

            {configs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <VercelLogo className="w-6 h-6 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground mb-3">
                  No projects mapped yet.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add project
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {configs.map((config) => (
                  <VercelConfigRow
                    key={config.id}
                    config={config}
                    repos={repos}
                    repoName={repoName}
                  />
                ))}
              </div>
            )}

            <AddVercelMappingDialog
              open={addOpen}
              onOpenChange={setAddOpen}
              repos={repos}
              mappedProjectIds={mappedProjectIds}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function VercelConfigRow({
  config,
  repos,
  repoName,
}: {
  config: VercelProjectConfig;
  repos: Repository[];
  repoName: (id: string) => string;
}) {
  const [repositoryId, setRepositoryId] = useState(config.repositoryId);
  const [runOn, setRunOn] = useState<VercelRunOn>(config.runOn as VercelRunOn);
  const [blocking, setBlocking] = useState(config.blocking);
  const [enabled, setEnabled] = useState(config.enabled);
  const [timeoutMinutes, setTimeoutMinutes] = useState(
    String(config.timeoutMinutes),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty =
    repositoryId !== config.repositoryId ||
    runOn !== config.runOn ||
    blocking !== config.blocking ||
    enabled !== config.enabled ||
    Number(timeoutMinutes) !== config.timeoutMinutes;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateVercelProjectConfigAction(config.id, {
        repositoryId,
        runOn,
        blocking,
        enabled,
        timeoutMinutes: Math.max(1, Number(timeoutMinutes) || 15),
      });
      toast.success("Mapping saved");
    } catch {
      toast.error("Failed to save mapping");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteVercelProjectConfigAction(config.id);
      toast.success("Mapping removed");
    } catch {
      toast.error("Failed to remove mapping");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-medium truncate">
            {config.vercelProjectName || config.vercelProjectId}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            → {repoName(config.repositoryId)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleSave}
            disabled={!dirty || saving}
            title="Save"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Repository</Label>
          <Select value={repositoryId} onValueChange={setRepositoryId}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {repos.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Run on</Label>
          <Select
            value={runOn}
            onValueChange={(v) => setRunOn(v as VercelRunOn)}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="preview">{RUN_ON_LABELS.preview}</SelectItem>
              <SelectItem value="production">
                {RUN_ON_LABELS.production}
              </SelectItem>
              <SelectItem value="both">{RUN_ON_LABELS.both}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Switch
            id={`blocking-${config.id}`}
            checked={blocking}
            onCheckedChange={setBlocking}
          />
          <Label htmlFor={`blocking-${config.id}`} className="text-xs">
            Block deploy on failure
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`enabled-${config.id}`}
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor={`enabled-${config.id}`} className="text-xs">
            Enabled
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor={`timeout-${config.id}`}
            className="text-xs text-muted-foreground"
          >
            Timeout (min)
          </Label>
          <Input
            id={`timeout-${config.id}`}
            type="number"
            min={1}
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(e.target.value)}
            className="h-8 w-20"
          />
        </div>
      </div>
    </div>
  );
}

function AddVercelMappingDialog({
  open,
  onOpenChange,
  repos,
  mappedProjectIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repos: Repository[];
  mappedProjectIds: Set<string>;
}) {
  const [projects, setProjects] = useState<VercelProjectOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [runOn, setRunOn] = useState<VercelRunOn>("preview");
  const [blocking, setBlocking] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const list = await refreshVercelProjectsAction();
      setProjects(list.map((p) => ({ id: p.id, name: p.name })));
    } catch {
      toast.error("Failed to load Vercel projects");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  // Lazy-load the project list the first time the dialog opens.
  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next && projects === null && !loading) void loadProjects();
  };

  const available = (projects ?? []).filter((p) => !mappedProjectIds.has(p.id));
  const selectedProject = available.find((p) => p.id === projectId);

  const handleSave = async () => {
    if (!projectId || !repositoryId) return;
    setSaving(true);
    try {
      await createVercelProjectConfigAction({
        repositoryId,
        vercelProjectId: projectId,
        vercelProjectName: selectedProject?.name,
        runOn,
        blocking,
      });
      toast.success("Project mapped");
      onOpenChange(false);
      setProjectId("");
      setRepositoryId("");
    } catch {
      toast.error("Failed to map project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Map a Vercel project</DialogTitle>
          <DialogDescription>
            Pick a Vercel project and the Lastest repository whose tests should
            run against its deployments.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Vercel project
            </Label>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
              </div>
            ) : available.length === 0 ? (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-xs flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  {projects === null
                    ? "Open to load projects."
                    : "No unmapped Vercel projects available."}
                </span>
              </div>
            ) : (
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Lastest repository
            </Label>
            <Select value={repositoryId} onValueChange={setRepositoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a repository" />
              </SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Run on</Label>
            <Select
              value={runOn}
              onValueChange={(v) => setRunOn(v as VercelRunOn)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preview">{RUN_ON_LABELS.preview}</SelectItem>
                <SelectItem value="production">
                  {RUN_ON_LABELS.production}
                </SelectItem>
                <SelectItem value="both">{RUN_ON_LABELS.both}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="new-blocking"
              checked={blocking}
              onCheckedChange={setBlocking}
            />
            <Label htmlFor="new-blocking" className="text-xs">
              Block the deploy when Lastest finds unapproved changes
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!projectId || !repositoryId || saving}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Map project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
