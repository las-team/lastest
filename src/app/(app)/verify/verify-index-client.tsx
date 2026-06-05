"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, GitBranch, Play } from "lucide-react";
import { toast } from "sonner";
import { runVerifyBuild } from "@/server/actions/smart-run";
import { updateRepoSelectedBranch } from "@/server/actions/repos";
import "./verify-design.css";

interface VerifyIndexClientProps {
  hasRepo: boolean;
  repositoryId: string | null;
  activeBranch: string | null;
  defaultBranch: string | null;
  branches: string[];
}

export function VerifyIndexClient({
  hasRepo,
  repositoryId,
  activeBranch,
  defaultBranch,
  branches,
}: VerifyIndexClientProps) {
  if (!hasRepo) {
    return (
      <EmptyState
        title="Select a repository"
        description="Pick a repo from the sidebar to start verifying changes."
      />
    );
  }

  // Empty-state with full header — the user can still switch branches and
  // kick off a build even when the active branch has no builds yet.
  return (
    <VerifyEmptyShell
      repositoryId={repositoryId}
      activeBranch={activeBranch}
      defaultBranch={defaultBranch}
      branches={branches}
    />
  );
}

interface VerifyEmptyShellProps {
  repositoryId: string | null;
  activeBranch: string | null;
  defaultBranch: string | null;
  branches: string[];
}

function VerifyEmptyShell({
  repositoryId,
  activeBranch,
  defaultBranch,
  branches,
}: VerifyEmptyShellProps) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [, startBranchTransition] = useTransition();
  const [branchOpen, setBranchOpen] = useState(false);

  const handleRefresh = () => {
    if (!repositoryId) return;
    startRefresh(async () => {
      const result = await runVerifyBuild(repositoryId);
      if ("error" in result) {
        toast.error(result.error || "Could not start build");
        return;
      }
      if (result.fallback) {
        toast.message("Running all tests", { description: result.reason });
      }
      router.push(`/verify/${result.buildId}`);
      router.refresh();
    });
  };

  const handleBranchSelect = (branch: string) => {
    if (!repositoryId || branch === activeBranch) {
      setBranchOpen(false);
      return;
    }
    startBranchTransition(async () => {
      await updateRepoSelectedBranch(repositoryId, branch);
      // The /verify route re-runs and either lands us on the latest build of
      // the new branch or back on this empty shell if that branch has none.
      router.push("/verify");
      router.refresh();
    });
    setBranchOpen(false);
  };

  return (
    <div
      className="verify-page"
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        inset: 0,
        background: "var(--c-soft-2)",
        minHeight: 0,
        overflow: "hidden",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Header — same shape as the build view so the user has familiar
          branch + Run controls even with nothing built yet. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--c-white)",
          position: "relative",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-1)" }}>
            Verify
          </div>
          <div className="label" style={{ marginTop: 2 }}>
            No builds yet · {activeBranch ?? "unknown"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <button
              className="v-btn"
              onClick={() => setBranchOpen((v) => !v)}
              disabled={!repositoryId}
            >
              <GitBranch size={13} />
              {activeBranch ?? "unknown"}
              <ChevronDown size={11} />
            </button>
            {branchOpen && branches.length > 0 && (
              <BranchPicker
                current={activeBranch}
                defaultBranch={defaultBranch}
                branches={branches}
                onSelect={handleBranchSelect}
                onClose={() => setBranchOpen(false)}
              />
            )}
          </div>
          <button
            className="v-btn primary"
            onClick={handleRefresh}
            disabled={refreshing || !repositoryId}
          >
            <Play size={13} />
            {refreshing ? "Running…" : "Run"}
          </button>
        </div>
      </div>

      {/* Empty-state body */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          minHeight: 0,
        }}
      >
        <div
          style={{
            background: "white",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 32,
            maxWidth: 460,
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(31,42,51,0.05)",
          }}
        >
          <h1
            style={{
              fontSize: 18,
              fontWeight: 600,
              marginBottom: 8,
              color: "var(--foreground)",
            }}
          >
            No builds on {activeBranch ?? "this branch"}
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--muted-foreground)",
              marginBottom: 16,
              lineHeight: 1.6,
            }}
          >
            Press <strong>Run</strong> above to kick off a smart build, or
            switch back to a branch that has builds with the branch picker.
          </p>
          <Link
            href="/builds"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 8,
              background: "var(--secondary)",
              color: "var(--foreground)",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid var(--border)",
            }}
          >
            Open Builds
          </Link>
        </div>
      </div>
    </div>
  );
}

interface BranchPickerProps {
  current: string | null;
  defaultBranch: string | null;
  branches: string[];
  onSelect: (branch: string) => void;
  onClose: () => void;
}

function BranchPicker({
  current,
  defaultBranch,
  branches,
  onSelect,
  onClose,
}: BranchPickerProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches
      .filter((b) => !q || b.toLowerCase().includes(q))
      .slice(0, 50);
  }, [query, branches]);
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 50 }}
      />
      <div
        className="v-card"
        style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          width: 280,
          padding: 8,
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search branch…"
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 12,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--c-white)",
            color: "var(--fg-1)",
          }}
        />
        <div
          style={{
            maxHeight: 280,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          {filtered.map((b) => {
            const active = b === current;
            return (
              <button
                key={b}
                onClick={() => onSelect(b)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  borderRadius: 6,
                  fontSize: 12,
                  background: active
                    ? "color-mix(in oklab, var(--c-teal) 12%, white)"
                    : "transparent",
                  color: active ? "#1F7B66" : "var(--fg-1)",
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                  border: "0",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b}
                </span>
                {b === defaultBranch && (
                  <span className="label" style={{ fontSize: 9 }}>
                    default
                  </span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="label" style={{ padding: 8, fontSize: 9 }}>
              no matches
            </div>
          )}
        </div>
      </div>
    </>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}

function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: EmptyStateProps) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--secondary)",
      }}
    >
      <div
        style={{
          background: "white",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 32,
          maxWidth: 460,
          textAlign: "center",
          boxShadow: "0 1px 2px rgba(31,42,51,0.05)",
        }}
      >
        <h1
          style={{
            fontSize: 18,
            fontWeight: 600,
            marginBottom: 8,
            color: "var(--foreground)",
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--muted-foreground)",
            marginBottom: actionHref ? 16 : 0,
          }}
        >
          {description}
        </p>
        {actionHref && (
          <Link
            href={actionHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 8,
              background: "var(--primary)",
              color: "white",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {actionLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
