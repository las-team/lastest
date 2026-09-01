"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Layers,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ArrowUpFromLine,
  RefreshCw,
} from "lucide-react";
import { EnvironmentForm } from "./environment-form";
import {
  deleteEnvironment,
  promoteBaselines,
  recordEnvironmentRefresh,
  setDefaultEnvironment,
} from "@/server/actions/environments";
import { toast } from "sonner";
import { timeAgo } from "@/lib/utils";
import type { Environment } from "@/lib/db/schema";

interface EnvironmentListProps {
  repositoryId: string;
  environments: Environment[];
}

/** Sentinel for promoting the repo's pre-environment approvals. */
const UNSCOPED = "__unscoped__";

export function EnvironmentList({
  repositoryId,
  environments,
}: EnvironmentListProps) {
  const router = useRouter();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Environment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [promoteSource, setPromoteSource] = useState<Record<string, string>>(
    {},
  );

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (env: Environment) => {
    if (
      !confirm(
        `Delete "${env.label}"? Its connectors go with it. Credentials scoped to it become repo-wide rather than being deleted, and baselines approved in it stay on disk but stop matching until you recreate an environment with the key "${env.key}".`,
      )
    ) {
      return;
    }
    void run(env.id, () => deleteEnvironment(env.id), "Environment deleted");
  };

  const handleRefresh = (env: Environment) => {
    const note = prompt(
      `Record a sandbox refresh for "${env.label}"?\n\nBaselines are NOT touched — nothing in their key changes across a refresh, so every approval carries over. This timestamp lets Review explain the resulting diffs as a refresh rather than a regression.\n\nOptional note:`,
    );
    if (note === null) return;
    void run(
      env.id,
      () => recordEnvironmentRefresh(env.id, note),
      "Sandbox refresh recorded",
    );
  };

  const handlePromote = (env: Environment) => {
    const from = promoteSource[env.id];
    if (!from) return;
    const fromKey = from === UNSCOPED ? null : from;
    void run(
      env.id,
      async () => {
        const outcome = await promoteBaselines(repositoryId, fromKey, env.key);
        toast.info(
          `${outcome.promoted} baseline(s) promoted, ${outcome.superseded} superseded`,
        );
      },
      "Baselines promoted",
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">Environments</h3>
          <p className="text-sm text-muted-foreground">
            The deployments this suite runs against — production, UAT, a
            prerelease sandbox. Each carries its own base URL, connectors,
            logins and baselines, so the same tests can run against all of them
            without fighting over one set of approvals.
          </p>
        </div>
        <Button
          className="shrink-0"
          onClick={() => {
            setEditing(null);
            setIsFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          New environment
        </Button>
      </div>

      {environments.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center text-center gap-2">
            <Layers className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-lg">
              No environments yet. Runs use the repository&apos;s own base URL
              and its repo-wide credentials, exactly as before. Add one when you
              need a second deployment — a UAT sandbox on the next vendor
              release, say — and its baselines stay separate from what you have
              already approved.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {environments.map((env) => {
            const busy = busyId === env.id;
            const others = environments.filter((e) => e.id !== env.id);
            return (
              <Card key={env.id}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{env.label}</span>
                        <Badge
                          variant="secondary"
                          className="font-mono text-xs"
                        >
                          {env.key}
                        </Badge>
                        {env.releaseLabel && (
                          <Badge variant="outline" className="text-xs">
                            {env.releaseLabel}
                          </Badge>
                        )}
                        {env.isDefault && (
                          <Badge className="text-xs">Default</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {env.baseUrl || "Uses the repository base URL"}
                      </p>
                      {env.refreshedAt && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                          Sandbox refreshed {timeAgo(env.refreshedAt)}
                          {env.refreshNote ? ` — ${env.refreshNote}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!env.isDefault && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run(
                              env.id,
                              () => setDefaultEnvironment(env.id),
                              "Default environment updated",
                            )
                          }
                        >
                          Make default
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Record a sandbox refresh for ${env.label}`}
                        disabled={busy}
                        onClick={() => handleRefresh(env)}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${env.label}`}
                        onClick={() => {
                          setEditing(env);
                          setIsFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${env.label}`}
                        disabled={busy}
                        onClick={() => handleDelete(env)}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Promotion: what a validation lead does after UAT sign-off. */}
                  <div className="flex items-center gap-2 flex-wrap pt-1 border-t">
                    <span className="text-xs text-muted-foreground pt-3">
                      Promote approved baselines into {env.label} from
                    </span>
                    <Select
                      value={promoteSource[env.id] ?? ""}
                      onValueChange={(v) =>
                        setPromoteSource((p) => ({ ...p, [env.id]: v }))
                      }
                    >
                      <SelectTrigger className="w-56 mt-3 h-8">
                        <SelectValue placeholder="Choose a source" />
                      </SelectTrigger>
                      <SelectContent>
                        {others.map((e) => (
                          <SelectItem key={e.id} value={e.key}>
                            {e.label}
                          </SelectItem>
                        ))}
                        <SelectItem value={UNSCOPED}>
                          Approvals with no environment
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={busy || !promoteSource[env.id]}
                      onClick={() => handlePromote(env)}
                    >
                      <ArrowUpFromLine className="h-4 w-4 mr-2" />
                      Promote
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <EnvironmentForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSaved={() => router.refresh()}
        repositoryId={repositoryId}
        editEnvironment={editing}
      />
    </div>
  );
}
