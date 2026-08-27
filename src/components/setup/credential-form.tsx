"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { CopyReference } from "@/components/credentials/copy-reference";
import {
  createCredential,
  updateCredential,
} from "@/server/actions/credentials";
import { toast } from "sonner";
import type { CredentialField } from "@/lib/db/schema";
import type { MaskedCredential } from "@/lib/db/queries/credentials";

interface CredentialFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  repositoryId: string;
  editCredential: MaskedCredential | null;
}

/** `Vault sandbox admin` → `vaultAdmin`. Words after the first are capitalised. */
export function slugToHandle(label: string): string {
  const words = label
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  const [first, ...rest] = words;
  return (
    first.toLowerCase() +
    rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("")
  ).replace(/^[^a-z]+/, "");
}

/** Almost every login is these two, so start there rather than at an empty list. */
const DEFAULT_FIELDS: CredentialField[] = [
  { key: "username", value: "", secret: false },
  { key: "password", value: "", secret: true },
];

export function CredentialForm({
  open,
  onOpenChange,
  onSaved,
  repositoryId,
  editCredential,
}: CredentialFormProps) {
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  // Once the user edits the handle, stop deriving it from the label.
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<CredentialField[]>(DEFAULT_FIELDS);
  const [isSaving, setIsSaving] = useState(false);

  const originalName = editCredential?.name ?? null;
  const renamed = !!originalName && originalName !== name;

  useEffect(() => {
    if (!open) return;
    if (editCredential) {
      setLabel(editCredential.label);
      setName(editCredential.name);
      setNameTouched(true);
      setDescription(editCredential.description ?? "");
      // Secrets come back masked (""). An untouched secret stays "" and the
      // update action carries the stored ciphertext forward.
      setFields(
        editCredential.fields.length > 0
          ? editCredential.fields.map((f) => ({ ...f }))
          : DEFAULT_FIELDS.map((f) => ({ ...f })),
      );
    } else {
      setLabel("");
      setName("");
      setNameTouched(false);
      setDescription("");
      setFields(DEFAULT_FIELDS.map((f) => ({ ...f })));
    }
  }, [open, editCredential]);

  const handleLabelChange = (value: string) => {
    setLabel(value);
    if (!nameTouched) setName(slugToHandle(value));
  };

  const updateField = (
    index: number,
    patch: Partial<CredentialField>,
  ): void => {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        name,
        label,
        description: description.trim() || null,
        fields: fields
          .filter((f) => f.key.trim())
          .map((f) => ({ ...f, key: f.key.trim() })),
      };
      if (editCredential) {
        await updateCredential(editCredential.id, payload);
        toast.success("Credential updated");
      } else {
        await createCredential(repositoryId, payload);
        toast.success("Credential created");
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save credential",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editCredential ? "Edit credential" : "New credential"}
          </DialogTitle>
          <DialogDescription>
            Stored encrypted and injected into your tests as{" "}
            <code className="font-mono text-xs">credentials.{name || "…"}</code>
            . Never substituted into test source, so rotating a password does
            not invalidate a baseline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cred-label">Label</Label>
            <Input
              id="cred-label"
              value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="Vault sandbox admin"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-name">Name</Label>
            <Input
              id="cred-name"
              value={name}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              placeholder="vaultAdmin"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              The handle used in test code. Letters and digits, starting
              lowercase.
            </p>
            {renamed && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Test code referring to{" "}
                  <code className="font-mono">credentials.{originalName}</code>{" "}
                  will break. Find and replace it with{" "}
                  <code className="font-mono">credentials.{name}</code> before
                  the next run.
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-description">Description (optional)</Label>
            <Input
              id="cred-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Service account with the fixed QA role"
            />
          </div>

          <div className="space-y-2">
            <Label>Fields</Label>
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={field.key}
                    onChange={(e) =>
                      updateField(index, { key: e.target.value })
                    }
                    placeholder="username"
                    className="w-[9rem] font-mono text-sm"
                  />
                  <Input
                    type={field.secret ? "password" : "text"}
                    value={field.value}
                    onChange={(e) =>
                      updateField(index, { value: e.target.value })
                    }
                    placeholder={
                      field.secret && editCredential
                        ? "Unchanged — type to replace"
                        : "Value"
                    }
                    className="flex-1"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      checked={field.secret}
                      onCheckedChange={(secret) =>
                        updateField(index, { secret })
                      }
                      aria-label={`Treat ${field.key || "field"} as a secret`}
                    />
                    <span className="text-xs text-muted-foreground w-10">
                      {field.secret ? "Secret" : "Plain"}
                    </span>
                  </div>
                  {name && field.key && (
                    <CopyReference
                      reference={`credentials.${name}.${field.key}`}
                    />
                  )}
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${field.key || "field"}`}
                      onClick={() =>
                        setFields((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setFields((prev) => [
                    ...prev,
                    { key: "", value: "", secret: true },
                  ])
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                Add field
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Secret values are write-only: once saved they are never returned
              to the browser. To change one, type a new value.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editCredential ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
