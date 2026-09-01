"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Plug,
  CheckCircle2,
  AlertCircle,
  Info,
} from "lucide-react";
import { ConnectorForm } from "./connector-form";
import { CopyReference } from "@/components/credentials/copy-reference";
import { deleteConnector, verifyConnector } from "@/server/actions/connectors";
import { getAuthMethod } from "@/lib/connectors/definitions";
import { toast } from "sonner";
import { timeAgo } from "@/lib/utils";
import type { Environment, SutConnectorType } from "@/lib/db/schema";
import type { ConnectorWithEnvironment } from "@/lib/db/queries/connectors";

interface ConnectorListProps {
  repositoryId: string;
  type: SutConnectorType;
  typeLabel: string;
  connectors: ConnectorWithEnvironment[];
  environments: Environment[];
}

export function ConnectorList({
  repositoryId,
  type,
  typeLabel,
  connectors,
  environments,
}: ConnectorListProps) {
  const router = useRouter();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectorWithEnvironment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleDelete = async (connector: ConnectorWithEnvironment) => {
    if (
      !confirm(
        `Disconnect "${connector.label}"? This also removes the credential it manages, so tests using credentials.${connector.name} will fail on the next run.`,
      )
    ) {
      return;
    }
    setBusyId(connector.id);
    try {
      await deleteConnector(connector.id);
      toast.success("Connector removed");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove connector",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleVerify = async (connector: ConnectorWithEnvironment) => {
    setBusyId(connector.id);
    try {
      const result = await verifyConnector(connector.id);
      if (result.ok) {
        toast.success(result.detail ?? "Connection succeeded");
      } else {
        toast.error(result.error ?? "Connection failed");
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not test the connection",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {connectors.length === 0 ? (
        <div className="rounded-lg border border-dashed py-8 flex flex-col items-center text-center gap-2">
          <Plug className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-md">
            No {typeLabel} orgs connected yet. Connect one per environment —
            production, UAT and a prerelease sandbox are separate connectors,
            each with its own login.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {connectors.map((connector) => {
            const method = getAuthMethod(connector.type, connector.authMethod);
            const busy = busyId === connector.id;
            return (
              <div
                key={connector.id}
                className="rounded-lg border p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{connector.label}</span>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {connector.name}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {connector.environment?.label ?? "All environments"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {method.label}
                      {" · "}
                      {describeTarget(connector)}
                    </p>
                    <VerificationState
                      connector={connector}
                      verifiable={method.verifiable}
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {method.verifiable && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleVerify(connector)}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Test connection"
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${connector.label}`}
                      onClick={() => {
                        setEditing(connector);
                        setIsFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${connector.label}`}
                      disabled={busy}
                      onClick={() => handleDelete(connector)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* The payoff: the handle a test reads, ready to paste. */}
                <div className="rounded-md border divide-y">
                  {method.credentialFields.map((field) => (
                    <div
                      key={field.key}
                      className="flex items-center gap-3 px-3 py-1.5 text-sm"
                    >
                      <span className="font-mono text-xs text-muted-foreground w-32 shrink-0 truncate">
                        {field.key}
                      </span>
                      <span className="text-muted-foreground">
                        {field.secret ? "••••••••" : "set in the credential"}
                      </span>
                      <CopyReference
                        className="ml-auto h-7 w-7"
                        reference={`credentials.${connector.name}.${field.key}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Button
        variant="outline"
        onClick={() => {
          setEditing(null);
          setIsFormOpen(true);
        }}
      >
        <Plus className="h-4 w-4 mr-2" />
        Add {typeLabel} connector
      </Button>

      <ConnectorForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSaved={() => router.refresh()}
        repositoryId={repositoryId}
        type={type}
        typeLabel={typeLabel}
        environments={environments}
        editConnector={editing}
      />
    </div>
  );
}

/** The org this connector points at, read off whichever config shape it has. */
function describeTarget(connector: ConnectorWithEnvironment): string {
  const config = connector.config as unknown as Record<
    string,
    string | undefined
  >;
  return config.vaultDns || config.instanceUrl || config.loginUrl || "—";
}

function VerificationState({
  connector,
  verifiable,
}: {
  connector: ConnectorWithEnvironment;
  verifiable: boolean;
}) {
  // Never show a green tick for a connector with no API to check — an
  // unverified browser login is honest; a fake pass is not.
  if (!verifiable) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Used by browser tests — run a test to confirm the login works.
      </p>
    );
  }
  if (connector.lastVerifyError) {
    return (
      <p className="text-xs text-destructive flex items-start gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>{connector.lastVerifyError}</span>
      </p>
    );
  }
  if (connector.lastVerifiedAt) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        Verified {timeAgo(connector.lastVerifiedAt)}
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">Not tested yet.</p>;
}
