"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { CopyReference } from "@/components/credentials/copy-reference";
import { slugToHandle } from "@/components/setup/credential-form";
import { createConnector, updateConnector } from "@/server/actions/connectors";
import { getConnectorType } from "@/lib/connectors/definitions";
import { toast } from "sonner";
import type {
  Environment,
  SutConnectorAuthMethod,
  SutConnectorType,
} from "@/lib/db/schema";
import type { ConnectorWithEnvironment } from "@/lib/db/queries/connectors";

interface ConnectorFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  repositoryId: string;
  type: SutConnectorType;
  typeLabel: string;
  environments: Environment[];
  editConnector: ConnectorWithEnvironment | null;
}

/** Sentinel for "no environment" — a Select cannot carry an empty string value. */
const NO_ENVIRONMENT = "__none__";

export function ConnectorForm({
  open,
  onOpenChange,
  onSaved,
  repositoryId,
  type,
  typeLabel,
  environments,
  editConnector,
}: ConnectorFormProps) {
  const typeDef = useMemo(() => getConnectorType(type), [type]);

  const [authMethod, setAuthMethod] = useState<SutConnectorAuthMethod>(
    typeDef.methods[0].method,
  );
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [environmentId, setEnvironmentId] = useState<string>(NO_ENVIRONMENT);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const methodDef = useMemo(
    () => typeDef.methods.find((m) => m.method === authMethod)!,
    [typeDef, authMethod],
  );

  useEffect(() => {
    if (!open) return;
    if (editConnector) {
      setAuthMethod(editConnector.authMethod);
      setLabel(editConnector.label);
      setName(editConnector.name);
      setHandleTouched(true);
      setEnvironmentId(editConnector.environmentId ?? NO_ENVIRONMENT);
      setConfig({
        ...(editConnector.config as unknown as Record<string, string>),
      });
      // Never prefilled: secrets are write-only, and an empty field on save
      // means "unchanged".
      setSecrets({});
    } else {
      const first = typeDef.methods[0];
      setAuthMethod(first.method);
      setLabel("");
      setName("");
      setHandleTouched(false);
      setEnvironmentId(
        environments.find((e) => e.isDefault)?.id ??
          environments[0]?.id ??
          NO_ENVIRONMENT,
      );
      setConfig(defaultsFor(first.configFields));
      setSecrets({});
    }
  }, [open, editConnector, typeDef, environments]);

  // Switching method changes which fields exist; seed the new ones with their
  // defaults but keep anything the two methods share (the Vault DNS, the login
  // URL) so the user does not retype it.
  useEffect(() => {
    setConfig((prev) => ({ ...defaultsFor(methodDef.configFields), ...prev }));
  }, [methodDef]);

  const handleLabelChange = (value: string) => {
    setLabel(value);
    if (!handleTouched) setName(slugToHandle(value));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const input = {
        type,
        authMethod,
        name,
        label,
        environmentId: environmentId === NO_ENVIRONMENT ? null : environmentId,
        config,
        secrets,
      };
      if (editConnector) {
        await updateConnector(editConnector.id, input);
        toast.success("Connector updated");
      } else {
        await createConnector(repositoryId, input);
        toast.success(`${typeLabel} connected`);
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save connector",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editConnector ? "Edit connector" : `Connect ${typeLabel}`}
          </DialogTitle>
          <DialogDescription>{typeDef.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="connector-label">Name</Label>
            <Input
              id="connector-label"
              value={label}
              placeholder={`${typeLabel} UAT`}
              onChange={(e) => handleLabelChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="connector-handle">Code handle</Label>
            <div className="flex items-center gap-2">
              <Input
                id="connector-handle"
                value={name}
                className="font-mono"
                onChange={(e) => {
                  setHandleTouched(true);
                  setName(e.target.value);
                }}
              />
              {name && (
                <CopyReference reference={`credentials.${name}.username`} />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Your tests read this connector&apos;s login as{" "}
              <code className="font-mono">
                credentials.{name || "handle"}.password
              </code>
              . The same handle can exist once per environment, so one test body
              runs against all of them.
            </p>
          </div>

          {environments.length > 0 && (
            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={environmentId} onValueChange={setEnvironmentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.label}
                      {env.releaseLabel ? ` · ${env.releaseLabel}` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_ENVIRONMENT}>
                    All environments
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Authentication</Label>
            <Select
              value={authMethod}
              onValueChange={(v) => setAuthMethod(v as SutConnectorAuthMethod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeDef.methods.map((m) => (
                  <SelectItem key={m.method} value={m.method}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {methodDef.description}
            </p>
          </div>

          {methodDef.configFields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`cfg-${field.key}`}>
                {field.label}
                {!field.required && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (optional)
                  </span>
                )}
              </Label>
              <Input
                id={`cfg-${field.key}`}
                value={config[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
              />
              {field.help && (
                <p className="text-xs text-muted-foreground">{field.help}</p>
              )}
            </div>
          ))}

          {methodDef.credentialFields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`sec-${field.key}`}>{field.label}</Label>
              {field.multiline ? (
                <Textarea
                  id={`sec-${field.key}`}
                  rows={5}
                  className="font-mono text-xs"
                  value={secrets[field.key] ?? ""}
                  placeholder={
                    editConnector && field.secret
                      ? "••••••••  (leave blank to keep)"
                      : field.placeholder
                  }
                  onChange={(e) =>
                    setSecrets((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                />
              ) : (
                <Input
                  id={`sec-${field.key}`}
                  type={field.secret ? "password" : "text"}
                  value={secrets[field.key] ?? ""}
                  placeholder={
                    editConnector && field.secret
                      ? "••••••••  (leave blank to keep)"
                      : field.placeholder
                  }
                  onChange={(e) =>
                    setSecrets((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                />
              )}
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            Secrets are encrypted at rest, injected into the browser at run
            time, and never written into test source, baselines or run history.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !label || !name}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editConnector ? "Save" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultsFor(
  fields: Array<{ key: string; default?: string }>,
): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, f.default ?? ""]));
}
