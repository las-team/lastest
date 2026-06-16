"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Sparkles, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import type {
  ApiTestDefinition,
  ApiAssertion,
  ApiAssertionKind,
  ApiAuth,
  FunctionalArea,
  LoadTestConfig,
} from "@/lib/db/schema";
import {
  createApiTest,
  updateApiTest,
  generateApiTestDefinitionAction,
} from "@/server/actions/api-tests";

export interface ApiTestFormProps {
  repositoryId: string;
  areas: FunctionalArea[];
  /** When editing, the existing test id + initial values. */
  testId?: string;
  initialName?: string;
  initialDefinition?: ApiTestDefinition;
  initialLoadConfig?: LoadTestConfig | null;
  initialAreaId?: string | null;
  /** Called with the saved test id after a successful create/update. */
  onSaved?: (testId: string) => void;
  /** When provided, a Cancel button is shown that calls this. */
  onCancel?: () => void;
}

type Row = { key: string; value: string };

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const ASSERTION_KINDS: { value: ApiAssertionKind; label: string }[] = [
  { value: "status", label: "Status code" },
  { value: "jsonPath", label: "JSON path" },
  { value: "header", label: "Header" },
  { value: "bodyContains", label: "Body contains" },
  { value: "latencyMs", label: "Max latency (ms)" },
  { value: "jsonSchema", label: "JSON schema" },
];

const NONE_AREA = "__none__";

function headersToRows(h?: Record<string, string>): Row[] {
  return h ? Object.entries(h).map(([key, value]) => ({ key, value })) : [];
}
function rowsToRecord(rows: Row[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.key.trim()) out[r.key.trim()] = r.value;
  return Object.keys(out).length ? out : undefined;
}

export function ApiTestForm({
  repositoryId,
  areas,
  testId,
  initialName,
  initialDefinition,
  initialLoadConfig,
  initialAreaId,
  onSaved,
  onCancel,
}: ApiTestFormProps) {
  const editing = !!testId;
  const [name, setName] = useState(initialName ?? "");
  const [areaId, setAreaId] = useState<string>(initialAreaId ?? NONE_AREA);
  const [method, setMethod] = useState<ApiTestDefinition["method"]>(
    initialDefinition?.method ?? "GET",
  );
  const [url, setUrl] = useState(initialDefinition?.url ?? "");
  const [headerRows, setHeaderRows] = useState<Row[]>(
    headersToRows(initialDefinition?.headers),
  );
  const [body, setBody] = useState(
    initialDefinition?.body !== undefined
      ? JSON.stringify(initialDefinition.body, null, 2)
      : "",
  );
  const [authType, setAuthType] = useState<ApiAuth["type"]>(
    initialDefinition?.auth?.type ?? "none",
  );
  const [authToken, setAuthToken] = useState("");
  const [authUser, setAuthUser] = useState(
    initialDefinition?.auth?.type === "basic"
      ? initialDefinition.auth.username
      : "",
  );
  const [authPass, setAuthPass] = useState("");
  const [assertions, setAssertions] = useState<ApiAssertion[]>(
    initialDefinition?.assertions?.length
      ? initialDefinition.assertions
      : [{ kind: "status", in: [200] }],
  );

  const [loadEnabled, setLoadEnabled] = useState(!!initialLoadConfig);
  const [concurrency, setConcurrency] = useState(
    String(initialLoadConfig?.concurrency ?? 10),
  );
  const [totalRequests, setTotalRequests] = useState(
    String(initialLoadConfig?.totalRequests ?? 100),
  );
  const [p95Ms, setP95Ms] = useState(
    initialLoadConfig?.thresholds?.p95Ms != null
      ? String(initialLoadConfig.thresholds.p95Ms)
      : "1000",
  );
  const [maxErrorPct, setMaxErrorPct] = useState(
    initialLoadConfig?.thresholds?.maxErrorRate != null
      ? String(initialLoadConfig.thresholds.maxErrorRate * 100)
      : "1",
  );

  const [aiPrompt, setAiPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const buildDefinition = (): ApiTestDefinition => {
    let auth: ApiAuth | undefined;
    if (authType === "bearer" && authToken)
      auth = { type: "bearer", token: authToken };
    else if (authType === "basic")
      auth = { type: "basic", username: authUser, password: authPass };
    else if (
      initialDefinition?.auth &&
      authType === initialDefinition.auth.type
    )
      // Keep the stored (un-edited) credential when the user didn't retype it.
      auth = initialDefinition.auth;

    let parsedBody: unknown;
    if (body.trim() && method !== "GET") {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        parsedBody = body; // send as raw string if not valid JSON
      }
    }
    return {
      method,
      url: url.trim(),
      headers: rowsToRecord(headerRows),
      body: parsedBody,
      auth,
      assertions,
    };
  };

  const loadConfig = (): LoadTestConfig | null =>
    loadEnabled
      ? {
          concurrency: Math.max(1, parseInt(concurrency) || 1),
          totalRequests: Math.max(1, parseInt(totalRequests) || 1),
          thresholds: {
            ...(p95Ms ? { p95Ms: parseInt(p95Ms) } : {}),
            ...(maxErrorPct
              ? { maxErrorRate: (parseFloat(maxErrorPct) || 0) / 100 }
              : {}),
          },
        }
      : null;

  async function handleGenerate() {
    if (!aiPrompt.trim()) {
      toast.error("Describe the endpoint to generate a test.");
      return;
    }
    setGenerating(true);
    try {
      const res = await generateApiTestDefinitionAction({
        repositoryId,
        prompt: aiPrompt,
      });
      if (res.status !== "generated" || !res.definition) {
        toast.error(res.summary || "Could not generate a definition.");
        return;
      }
      const d = res.definition;
      setMethod(d.method);
      setUrl(d.url);
      setHeaderRows(headersToRows(d.headers));
      setBody(d.body !== undefined ? JSON.stringify(d.body, null, 2) : "");
      setAssertions(d.assertions?.length ? d.assertions : assertions);
      toast.success(res.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!url.trim()) {
      toast.error("URL is required.");
      return;
    }
    if (assertions.length === 0) {
      toast.error("Add at least one assertion.");
      return;
    }
    setSaving(true);
    try {
      const def = buildDefinition();
      if (editing) {
        await updateApiTest(testId!, {
          name,
          apiDefinition: def,
          loadConfig: loadConfig(),
        });
        toast.success("API test updated.");
        onSaved?.(testId!);
      } else {
        const { id } = await createApiTest({
          repositoryId,
          name,
          apiDefinition: def,
          functionalAreaId: areaId === NONE_AREA ? null : areaId,
          loadConfig: loadConfig(),
        });
        toast.success("API test created.");
        onSaved?.(id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        {/* AI generate */}
        {!editing && (
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Generate from a description
              (optional)
            </Label>
            <div className="flex gap-2">
              <Input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. GET /api/users/:id returns the user with a 200"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Generate"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Name + area */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto from method + URL if blank"
            />
          </div>
          {!editing && (
            <div className="space-y-1.5">
              <Label className="text-xs">Functional area</Label>
              <Select value={areaId} onValueChange={setAreaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_AREA}>Uncategorized</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Request line */}
        <div className="space-y-1.5">
          <Label className="text-xs">Request</Label>
          <div className="flex gap-2">
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as ApiTestDefinition["method"])}
            >
              <SelectTrigger className="w-28 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/api/path  or  https://api.example.com/x"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Relative URLs are resolved against the repo&apos;s base URL.
          </p>
        </div>

        {/* Auth */}
        <div className="space-y-1.5">
          <Label className="text-xs">Authentication</Label>
          <Select
            value={authType}
            onValueChange={(v) => setAuthType(v as ApiAuth["type"])}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="bearer">Bearer token</SelectItem>
              <SelectItem value="basic">Basic auth</SelectItem>
            </SelectContent>
          </Select>
          {authType === "bearer" && (
            <Input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder={
                editing ? "•••••• (leave blank to keep current)" : "Token"
              }
            />
          )}
          {authType === "basic" && (
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={authUser}
                onChange={(e) => setAuthUser(e.target.value)}
                placeholder="Username"
              />
              <Input
                type="password"
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                placeholder={editing ? "•••••• (unchanged)" : "Password"}
              />
            </div>
          )}
          {authType !== "none" && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" /> Credentials are stored encrypted at
              rest and never shown in test code or history.
            </p>
          )}
        </div>

        {/* Headers */}
        <KeyValueEditor
          label="Headers"
          rows={headerRows}
          onChange={setHeaderRows}
          keyPlaceholder="Header"
          valuePlaceholder="Value"
        />

        {/* Body */}
        {method !== "GET" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Request body (JSON)</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder='{ "name": "example" }'
              className="font-mono text-xs min-h-20"
            />
          </div>
        )}

        <Separator />

        {/* Assertions */}
        <AssertionsEditor value={assertions} onChange={setAssertions} />

        <Separator />

        {/* Load testing */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Load test</Label>
              <p className="text-[11px] text-muted-foreground">
                Fire N concurrent requests and gate on latency / error
                thresholds.
              </p>
            </div>
            <Switch checked={loadEnabled} onCheckedChange={setLoadEnabled} />
          </div>
          {loadEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <LabeledNumber
                label="Concurrency"
                value={concurrency}
                onChange={setConcurrency}
                hint="max 50"
              />
              <LabeledNumber
                label="Total requests"
                value={totalRequests}
                onChange={setTotalRequests}
                hint="max 2000"
              />
              <LabeledNumber
                label="p95 budget (ms)"
                value={p95Ms}
                onChange={setP95Ms}
              />
              <LabeledNumber
                label="Max error rate (%)"
                value={maxErrorPct}
                onChange={setMaxErrorPct}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
          {editing ? "Save changes" : "Create test"}
        </Button>
      </div>
    </div>
  );
}

function KeyValueEditor({
  label,
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  label: string;
  rows: Row[];
  onChange: (r: Row[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={row.key}
            onChange={(e) =>
              onChange(
                rows.map((r, j) =>
                  j === i ? { ...r, key: e.target.value } : r,
                ),
              )
            }
            placeholder={keyPlaceholder}
          />
          <Input
            value={row.value}
            onChange={(e) =>
              onChange(
                rows.map((r, j) =>
                  j === i ? { ...r, value: e.target.value } : r,
                ),
              )
            }
            placeholder={valuePlaceholder}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <Plus className="h-3.5 w-3.5 mr-1" /> Add {label.toLowerCase()}
      </Button>
    </div>
  );
}

function LabeledNumber({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] flex justify-between">
        <span>{label}</span>
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function AssertionsEditor({
  value,
  onChange,
}: {
  value: ApiAssertion[];
  onChange: (a: ApiAssertion[]) => void;
}) {
  const update = (i: number, patch: Partial<ApiAssertion>) =>
    onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <div className="space-y-2">
      <Label className="text-xs">Assertions</Label>
      {value.map((a, i) => (
        <div key={i} className="flex gap-2 items-start">
          <Select
            value={a.kind}
            onValueChange={(v) =>
              update(i, { kind: v as ApiAssertionKind } as ApiAssertion)
            }
          >
            <SelectTrigger className="w-40 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSERTION_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1">
            <AssertionFields
              assertion={a}
              onChange={(patch) => update(i, patch)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { kind: "status", in: [200] }])}
      >
        <Plus className="h-3.5 w-3.5 mr-1" /> Add assertion
      </Button>
    </div>
  );
}

function AssertionFields({
  assertion,
  onChange,
}: {
  assertion: ApiAssertion;
  onChange: (patch: Partial<ApiAssertion>) => void;
}) {
  switch (assertion.kind) {
    case "status":
      return (
        <Input
          value={(
            assertion.in ?? (assertion.equals ? [assertion.equals] : [])
          ).join(", ")}
          onChange={(e) => {
            const codes = e.target.value
              .split(",")
              .map((s) => parseInt(s.trim()))
              .filter((n) => !Number.isNaN(n));
            onChange(
              codes.length <= 1
                ? { in: undefined, equals: codes[0] }
                : { equals: undefined, in: codes },
            );
          }}
          placeholder="200  or  200, 201, 204"
        />
      );
    case "jsonPath":
      return (
        <div className="flex gap-2">
          <Input
            value={assertion.path ?? ""}
            onChange={(e) => onChange({ path: e.target.value })}
            placeholder="data.id"
          />
          <Input
            value={assertion.value != null ? String(assertion.value) : ""}
            onChange={(e) => onChange({ value: e.target.value || undefined })}
            placeholder="expected (blank = present)"
          />
        </div>
      );
    case "header":
      return (
        <div className="flex gap-2">
          <Input
            value={assertion.header ?? ""}
            onChange={(e) => onChange({ header: e.target.value })}
            placeholder="content-type"
          />
          <Input
            value={assertion.value != null ? String(assertion.value) : ""}
            onChange={(e) => onChange({ value: e.target.value || undefined })}
            placeholder="expected (blank = present)"
          />
        </div>
      );
    case "bodyContains":
      return (
        <Input
          value={assertion.value != null ? String(assertion.value) : ""}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="substring the body must contain"
        />
      );
    case "latencyMs":
      return (
        <Input
          type="number"
          value={assertion.maxMs != null ? String(assertion.maxMs) : ""}
          onChange={(e) =>
            onChange({ maxMs: parseInt(e.target.value) || undefined })
          }
          placeholder="max ms"
        />
      );
    case "jsonSchema":
      return (
        <Textarea
          value={
            assertion.schema ? JSON.stringify(assertion.schema, null, 2) : ""
          }
          onChange={(e) => {
            try {
              onChange({ schema: JSON.parse(e.target.value) });
            } catch {
              /* keep typing; invalid JSON ignored until valid */
            }
          }}
          placeholder='{ "type": "object" }'
          className="font-mono text-xs min-h-16"
        />
      );
    default:
      return null;
  }
}
