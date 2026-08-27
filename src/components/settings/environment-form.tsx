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
import { Loader2 } from "lucide-react";
import {
  createEnvironment,
  updateEnvironment,
} from "@/server/actions/environments";
import { toast } from "sonner";
import type { Environment } from "@/lib/db/schema";

interface EnvironmentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  repositoryId: string;
  editEnvironment: Environment | null;
}

/** `Prerelease 26R2` → `prerelease-26r2`. */
function slugToKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function EnvironmentForm({
  open,
  onOpenChange,
  onSaved,
  repositoryId,
  editEnvironment,
}: EnvironmentFormProps) {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [releaseLabel, setReleaseLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editEnvironment) {
      setLabel(editEnvironment.label);
      setKey(editEnvironment.key);
      setKeyTouched(true);
      setBaseUrl(editEnvironment.baseUrl ?? "");
      setReleaseLabel(editEnvironment.releaseLabel ?? "");
    } else {
      setLabel("");
      setKey("");
      setKeyTouched(false);
      setBaseUrl("");
      setReleaseLabel("");
    }
  }, [open, editEnvironment]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editEnvironment) {
        await updateEnvironment(editEnvironment.id, {
          label,
          baseUrl: baseUrl || null,
          releaseLabel: releaseLabel || null,
        });
        toast.success("Environment updated");
      } else {
        await createEnvironment(repositoryId, {
          key,
          label,
          baseUrl: baseUrl || null,
          releaseLabel: releaseLabel || null,
        });
        toast.success("Environment created");
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save environment",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editEnvironment ? "Edit environment" : "New environment"}
          </DialogTitle>
          <DialogDescription>
            A deployment of the system under test. Baselines, connectors and
            logins are scoped to it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="env-label">Name</Label>
            <Input
              id="env-label"
              value={label}
              placeholder="UAT"
              onChange={(e) => {
                setLabel(e.target.value);
                if (!keyTouched) setKey(slugToKey(e.target.value));
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="env-key">Key</Label>
            <Input
              id="env-key"
              value={key}
              className="font-mono"
              disabled={!!editEnvironment}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {editEnvironment
                ? "The key is fixed after creation: it is stored on every baseline this environment owns, so renaming it would orphan them."
                : "Stored on every baseline approved in this environment. Lowercase letters, digits and hyphens."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="env-url">Base URL</Label>
            <Input
              id="env-url"
              value={baseUrl}
              placeholder="https://my-vault.veevavault.com"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              What runs against this environment navigate to. Leave blank to use
              the repository&apos;s own base URL.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="env-release">Vendor release</Label>
            <Input
              id="env-release"
              value={releaseLabel}
              placeholder="26R2"
              onChange={(e) => setReleaseLabel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional. The release this deployment is running — the thing that
              makes a prerelease sandbox legible next to production.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !label || !key}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editEnvironment ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
