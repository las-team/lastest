"use client";

import { useState } from "react";
import { Plus, Copy, Check, Tv2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createRunner } from "@/server/actions/runners";
import { useRouter } from "next/navigation";

export function CreateRunnerDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await createRunner(
      name.trim(),
      ["run", "record"],
      "embedded",
    );

    setLoading(false);

    if ("error" in result) {
      setError(result.error);
    } else {
      setToken(result.token);
    }
  };

  const copyToken = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCommand = async () => {
    if (!token) return;
    const serverUrl =
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:3000";
    const command = `docker run -d --name lastest-eb \\\n  -e LASTEST_TOKEN=${token} \\\n  -e LASTEST_URL=${serverUrl} \\\n  -p 9223:9223 -p 9224:9224 \\\n  ewyc/lastest-eb:latest`;
    await navigator.clipboard.writeText(command);
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  const handleClose = () => {
    setOpen(false);
    setName("");
    setToken(null);
    setError(null);
    if (token) {
      router.refresh();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleClose();
        } else {
          setOpen(true);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Create Runner
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tv2 className="w-5 h-5" />
            {token ? "Embedded Browser Created" : "Create Embedded Browser"}
          </DialogTitle>
          <DialogDescription>
            {token
              ? "Copy this token now. It will not be shown again."
              : "Create a new embedded browser to execute tests."}
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="space-y-4">
            <div className="relative">
              <div className="bg-muted p-3 rounded-md text-sm pr-12 font-mono break-all">
                {token}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
                onClick={copyToken}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3 text-sm">
              <p className="font-medium text-yellow-600 dark:text-yellow-400 mb-1">
                Important
              </p>
              <p className="text-muted-foreground">
                This token provides access to run tests on behalf of your team.
                Keep it secure and never share it publicly.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Quick Start</p>
              <p className="text-xs text-muted-foreground">
                Set the token as{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  LASTEST_TOKEN
                </code>{" "}
                in your environment or{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  .env
                </code>{" "}
                file, then start the container:
              </p>
              <div className="relative">
                <pre className="bg-muted p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-all pr-10">
                  {`docker run -d --name lastest-eb \\\n  -e LASTEST_TOKEN=${token} \\\n  -e LASTEST_URL=${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"} \\\n  -p 9223:9223 -p 9224:9224 \\\n  ewyc/lastest-eb:latest`}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={copyCommand}
                >
                  {copiedCommand ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g., Embedded Chrome, Docker Browser"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreate();
                  }
                }}
              />
              <p className="text-sm text-muted-foreground">
                A descriptive name to identify this embedded browser
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {token ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={loading}>
                {loading ? "Creating..." : "Create"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
