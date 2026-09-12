"use client";

/**
 * Stage 1 — Connect.
 *
 * The whole argument of this screen is in one line of its copy: both ends come
 * from Environments. There is no host field, no API-version field and no
 * password field anywhere in the migration console; picking a connector picks
 * all three, and re-pointing a refreshed sandbox is done once, in Settings,
 * for every migration that uses it.
 */

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Cloud,
  Database,
  ExternalLink,
  Loader2,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@lastest/ui";
import { Badge } from "@lastest/ui";
import { Label } from "@lastest/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lastest/ui";
import { updateMigrationEndpoints } from "../actions";
import { timeAgo } from "@lastest/ui";
import type { ConnectorDetail, ConnectorSummary } from "../host";

export function ConnectPanel({
  projectId,
  connectors,
  source,
  target,
  configError,
}: {
  projectId: string;
  connectors: ConnectorSummary[];
  source: ConnectorDetail | null;
  target: ConnectorDetail | null;
  configError: string | null;
}) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(source?.id ?? "");
  const [targetId, setTargetId] = useState(target?.id ?? "");
  const [saving, setSaving] = useState(false);

  const sources = connectors.filter((c) => c.type === "salesforce");
  const targets = connectors.filter((c) => c.type === "vault");
  const dirty =
    sourceId !== (source?.id ?? "") || targetId !== (target?.id ?? "");

  const save = async () => {
    setSaving(true);
    try {
      await updateMigrationEndpoints(projectId, {
        sourceConnectorId: sourceId || null,
        targetConnectorId: targetId || null,
      });
      toast.success("Endpoints updated");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update endpoints",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {configError && (
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          <p>{configError}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
        <EndpointCard
          kind="source"
          label="Source"
          sublabel="Veeva CRM on Salesforce"
          icon={Cloud}
          connectors={sources}
          value={sourceId}
          onChange={setSourceId}
          selected={connectors.find((c) => c.id === sourceId) ?? null}
          empty="No Salesforce org is connected to this repository."
        />
        <div className="hidden md:flex items-center justify-center pt-16 text-muted-foreground">
          <ArrowRight className="h-5 w-5" />
        </div>
        <EndpointCard
          kind="target"
          label="Target"
          sublabel="Vault CRM"
          icon={Database}
          connectors={targets}
          value={targetId}
          onChange={setTargetId}
          selected={connectors.find((c) => c.id === targetId) ?? null}
          empty="No Vault is connected to this repository."
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <Link
          href="/settings#environments"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Manage environments and connectors
          <ExternalLink className="h-3 w-3" />
        </Link>
        <Button onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          Save endpoints
        </Button>
      </div>
    </div>
  );
}

function EndpointCard({
  kind,
  label,
  sublabel,
  icon: Icon,
  connectors,
  value,
  onChange,
  selected,
  empty,
}: {
  kind: string;
  label: string;
  sublabel: string;
  icon: typeof Cloud;
  connectors: ConnectorSummary[];
  value: string;
  onChange: (v: string) => void;
  selected: ConnectorSummary | null;
  empty: string;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
        <div>
          <p className="text-sm font-medium leading-tight">{label}</p>
          <p className="text-[11px] text-muted-foreground">{sublabel}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`endpoint-${kind}`} className="text-xs">
          Connector
        </Label>
        {connectors.length === 0 ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger id={`endpoint-${kind}`}>
              <SelectValue placeholder="Select a connector" />
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

      {selected && (
        <dl className="space-y-1.5 text-xs">
          <Row label="Environment">
            {selected.environment ? (
              <span>
                {selected.environment.label}
                {selected.environment.releaseLabel && (
                  <Badge
                    variant="outline"
                    className="ml-1.5 font-mono text-[10px]"
                  >
                    {selected.environment.releaseLabel}
                  </Badge>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">repo-wide</span>
            )}
          </Row>
          <Row label="Host">
            <span className="font-mono">{hostOf(selected)}</span>
          </Row>
          <Row label="Auth">
            <span className="font-mono">{selected.authMethod}</span>
          </Row>
          <Row label="Verified">
            {selected.lastVerifiedAt ? (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <ShieldCheck className="h-3 w-3" />
                {timeAgo(selected.lastVerifiedAt)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <ShieldAlert className="h-3 w-3" />
                never
              </span>
            )}
          </Row>
          {selected.environment?.refreshedAt && (
            // A sandbox refresh replaces record ids. The crosswalk keys on the
            // legacy id and survives it, but a lead about to run an init should
            // still see that the source moved under them.
            <Row label="Refreshed">
              <span>{timeAgo(selected.environment.refreshedAt)}</span>
            </Row>
          )}
        </dl>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right truncate">{children}</dd>
    </div>
  );
}

function hostOf(connector: ConnectorSummary): string {
  const config = connector.config as unknown as Record<string, unknown>;
  return String(
    config.vaultDns ?? config.instanceUrl ?? config.loginUrl ?? "—",
  );
}
