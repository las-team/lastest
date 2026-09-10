"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowRightLeft,
  Building2,
  Cloud,
  Database,
  Loader2,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createMigration } from "@/server/actions/migrations";
import { timeAgo } from "@/lib/utils";
import { STAGE_BY_KEY, STAGE_DEFINITIONS } from "@/lib/migration/stages";
import type {
  Environment,
  MigrationProject,
  MigrationRun,
  MigrationWave,
} from "@/lib/db/schema";
import type { ConnectorWithEnvironment } from "@/lib/db/queries/connectors";

interface ProjectSummary {
  projectId: string;
  waves: MigrationWave[];
  lastRun: MigrationRun | null;
}

interface Props {
  repositoryId: string;
  repoName: string;
  projects: MigrationProject[];
  summaries: ProjectSummary[];
  connectors: ConnectorWithEnvironment[];
  environments: Environment[];
}

/** How far along the rail a project is, as a fraction — the list's progress bar. */
function stageProgress(stage: string): number {
  const i = STAGE_DEFINITIONS.findIndex((s) => s.key === stage);
  return i < 0 ? 0 : (i + 1) / STAGE_DEFINITIONS.length;
}

export function MigrationsIndexClient({
  repositoryId,
  repoName,
  projects,
  summaries,
  connectors,
  environments,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState<string>("");
  const [targetId, setTargetId] = useState<string>("");

  const sources = useMemo(
    () => connectors.filter((c) => c.type === "salesforce"),
    [connectors],
  );
  const targets = useMemo(
    () => connectors.filter((c) => c.type === "vault"),
    [connectors],
  );
  const summaryOf = (id: string) =>
    summaries.find((s) => s.projectId === id) ?? null;

  const canCreate =
    name.trim().length > 0 && Boolean(sourceId) && Boolean(targetId);

  const submit = async () => {
    setSaving(true);
    try {
      const project = await createMigration(repositoryId, {
        name: name.trim(),
        sourceConnectorId: sourceId || null,
        targetConnectorId: targetId || null,
      });
      toast.success("Migration created");
      router.push(`/migrations/${project.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create migration",
      );
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-muted-foreground" />
            Migrations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Move Veeva CRM data out of Salesforce and into Vault CRM — and keep
            both in sync until cutover.{" "}
            <span className="text-muted-foreground/70">{repoName}</span>
          </p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          disabled={!sources.length || !targets.length}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New migration
        </Button>
      </header>

      {(!sources.length || !targets.length) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 flex items-start gap-3">
            <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                A migration needs both ends connected first.
              </p>
              <p className="text-muted-foreground">
                {!sources.length && !targets.length
                  ? "No Salesforce org and no Vault are connected to this repository."
                  : !sources.length
                    ? "No Salesforce org is connected to this repository."
                    : "No Vault is connected to this repository."}{" "}
                Add them under{" "}
                <Link
                  href="/settings#environments"
                  className="text-primary hover:underline font-medium"
                >
                  Settings → Integrations
                </Link>
                , where they are scoped to an environment.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {projects.length === 0 ? (
        <EmptyState
          canCreate={Boolean(sources.length && targets.length)}
          onCreate={() => setOpen(true)}
        />
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => {
            const summary = summaryOf(project.id);
            const stage = STAGE_BY_KEY[project.stage];
            const countries = new Set(
              (summary?.waves ?? []).flatMap((w) => w.countries),
            );
            return (
              <li key={project.id}>
                <Link
                  href={`/migrations/${project.id}`}
                  className="block group"
                >
                  <Card className="transition-colors group-hover:border-primary/50">
                    <CardContent className="pt-6 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{project.name}</p>
                          {project.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {project.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusBadge project={project} />
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Cloud className="h-3.5 w-3.5" />
                          {environmentLabel(
                            environments,
                            project.sourceEnvironmentId,
                          ) ?? "Salesforce"}
                        </span>
                        <ArrowRight className="h-3 w-3" />
                        <span className="inline-flex items-center gap-1.5">
                          <Database className="h-3.5 w-3.5" />
                          {environmentLabel(
                            environments,
                            project.targetEnvironmentId,
                          ) ?? "Vault"}
                        </span>
                        {countries.size > 0 && (
                          <span className="inline-flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5" />
                            {summary!.waves.length} wave
                            {summary!.waves.length === 1 ? "" : "s"} ·{" "}
                            {countries.size} countr
                            {countries.size === 1 ? "y" : "ies"}
                          </span>
                        )}
                        {summary?.lastRun && (
                          <span>
                            last run {summary.lastRun.mode}{" "}
                            {summary.lastRun.startedAt
                              ? timeAgo(summary.lastRun.startedAt)
                              : ""}
                          </span>
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{
                              width: `${Math.round(stageProgress(project.stage) * 100)}%`,
                            }}
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {stage?.label ?? project.stage}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New migration</DialogTitle>
            <DialogDescription>
              Both ends come from Environments, so hosts and logins are never
              retyped here. Everything else is decided in the console.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="migration-name">Name</Label>
              <Input
                id="migration-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="EU wave 1 — UAT rehearsal"
                autoFocus
              />
            </div>

            <ConnectorPicker
              id="migration-source"
              label="Source — Salesforce org"
              placeholder="Select a Salesforce connector"
              connectors={sources}
              value={sourceId}
              onChange={setSourceId}
              empty="No Salesforce org is connected to this repository."
            />

            <ConnectorPicker
              id="migration-target"
              label="Target — Vault"
              placeholder="Select a Vault connector"
              connectors={targets}
              value={targetId}
              onChange={setTargetId}
              empty="No Vault is connected to this repository."
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canCreate || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function environmentLabel(
  environments: Environment[],
  id: string | null,
): string | null {
  if (!id) return null;
  return environments.find((e) => e.id === id)?.label ?? null;
}

function StatusBadge({ project }: { project: MigrationProject }) {
  if (project.status === "signed_off")
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600">Signed off</Badge>
    );
  if (project.status === "archived")
    return <Badge variant="outline">Archived</Badge>;
  if (project.status === "draft") return <Badge variant="outline">Draft</Badge>;
  return <Badge variant="secondary">In progress</Badge>;
}

function ConnectorPicker({
  id,
  label,
  placeholder,
  connectors,
  value,
  onChange,
  empty,
}: {
  id: string;
  label: string;
  placeholder: string;
  connectors: ConnectorWithEnvironment[];
  value: string;
  onChange: (v: string) => void;
  empty: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {connectors.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {connectors.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
                {c.environment ? ` · ${c.environment.label}` : " · repo-wide"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function EmptyState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-10 pb-10 text-center space-y-4">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <ArrowRightLeft className="h-5 w-5 text-muted-foreground" />
        </span>
        <div className="space-y-1.5 max-w-lg mx-auto">
          <p className="font-medium">No migrations yet</p>
          <p className="text-sm text-muted-foreground">
            A migration walks nine steps: connect both orgs, plan the units and
            their load order, preflight against live metadata, rehearse with a
            dry run, load, keep in sync with deltas, freeze and cut over,
            verify, sign off.
          </p>
        </div>
        <Button onClick={onCreate} disabled={!canCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          New migration
        </Button>
      </CardContent>
    </Card>
  );
}
