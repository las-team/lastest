"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { KeyRound, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { CredentialForm } from "./credential-form";
import { CopyReference } from "@/components/credentials/copy-reference";
import { deleteCredential } from "@/server/actions/credentials";
import { toast } from "sonner";
import { timeAgo } from "@/lib/utils";
import type { MaskedCredential } from "@/lib/db/queries/credentials";

interface CredentialListProps {
  repositoryId: string;
  credentials: MaskedCredential[];
}

const SECRET_DISPLAY = "••••••••";

export function CredentialList({
  repositoryId,
  credentials,
}: CredentialListProps) {
  const router = useRouter();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<MaskedCredential | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (cred: MaskedCredential) => {
    if (
      !confirm(
        `Delete "${cred.label}"? Tests using credentials.${cred.name} will fail on the next run.`,
      )
    ) {
      return;
    }
    setDeletingId(cred.id);
    try {
      await deleteCredential(cred.id);
      toast.success("Credential deleted");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete credential",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Credentials</h2>
          <p className="text-sm text-muted-foreground">
            Logins your setup scripts and tests use. Stored encrypted, injected
            into the browser at run time, and never written into test source or
            run history.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setIsFormOpen(true);
          }}
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-2" />
          New credential
        </Button>
      </div>

      {credentials.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center text-center gap-2">
            <KeyRound className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-md">
              No credentials yet. Add one and your tests can read it as{" "}
              <code className="font-mono text-xs">
                credentials.vaultAdmin.password
              </code>{" "}
              — no token syntax, no value in the test source.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {credentials.map((cred) => (
            <Card key={cred.id}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{cred.label}</span>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {cred.name}
                      </Badge>
                    </div>
                    {cred.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {cred.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-muted-foreground mr-2 whitespace-nowrap">
                      {cred.lastUsedAt
                        ? `Last used ${timeAgo(cred.lastUsedAt)}`
                        : "Never used"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${cred.label}`}
                      onClick={() => {
                        setEditing(cred);
                        setIsFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${cred.label}`}
                      disabled={deletingId === cred.id}
                      onClick={() => handleDelete(cred)}
                    >
                      {deletingId === cred.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border divide-y">
                  {cred.fields.map((field) => (
                    <div
                      key={field.key}
                      className="flex items-center gap-3 px-3 py-1.5 text-sm"
                    >
                      <span className="font-mono text-xs text-muted-foreground w-28 shrink-0 truncate">
                        {field.key}
                      </span>
                      <span
                        className={
                          field.secret
                            ? "text-muted-foreground tracking-widest"
                            : "truncate"
                        }
                      >
                        {field.secret ? SECRET_DISPLAY : field.value || "—"}
                      </span>
                      <CopyReference
                        className="ml-auto h-7 w-7"
                        reference={`credentials.${cred.name}.${field.key}`}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CredentialForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSaved={() => router.refresh()}
        repositoryId={repositoryId}
        editCredential={editing}
      />
    </div>
  );
}
