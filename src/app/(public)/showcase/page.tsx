import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ReplayPlayer } from "@/components/replay-player";
import { ChapterRail, type Chapter } from "@/components/share/chapter-rail";

// Local-only showcase of the "In this video" chapter rail + cinematic recording.
// Not part of the product surface — 404s in production. Assets live in
// public/showcase/ and are produced by the generator under /tmp/showcase-gen.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Share showcase · Lastest",
  robots: { index: false, follow: false },
};

type Manifest = {
  durationMs: number;
  chapters: { label: string; atMs: number; file: string }[];
};

function loadManifest(): Manifest | null {
  try {
    const p = path.join(process.cwd(), "public", "showcase", "manifest.json");
    return JSON.parse(fs.readFileSync(p, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

export default function ShowcasePage() {
  if (process.env.NODE_ENV === "production") notFound();

  const manifest = loadManifest();

  if (!manifest || manifest.chapters.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Showcase assets missing</h1>
        <p className="mt-3 text-muted-foreground">
          Generate them first, then reload:
        </p>
        <pre className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
          node /tmp/showcase-gen/gen.mjs
        </pre>
      </main>
    );
  }

  const chapters: Chapter[] = manifest.chapters.map((c) => ({
    src: `/showcase/${c.file}`,
    label: c.label,
    atSec: c.atMs / 1000,
  }));

  const clips = [
    {
      src: "/showcase/recording.webm",
      durationMs: manifest.durationMs,
      poster: chapters[0]?.src ?? null,
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <span className="font-semibold">Lastest · share showcase</span>
          <span className="rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            local dev only
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
        <section className="space-y-3">
          <figure className="m-0 space-y-2">
            <ReplayPlayer clips={clips} />
            <figcaption className="text-sm text-muted-foreground">
              Cinematic recording of a Nimbus Analytics walkthrough — each step
              below seeks the player.
            </figcaption>
          </figure>
          <ChapterRail chapters={chapters} />
        </section>

        <section className="rounded-xl border bg-card p-5 sm:p-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            “In this video” chapters
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page renders the exact components the public{" "}
            <code className="rounded bg-muted px-1">/r/&lt;slug&gt;</code> share
            uses. What it demonstrates:
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex gap-2">
              <span aria-hidden>▸</span>
              <span>
                <strong>Chapter rail</strong> — each captured step shows its
                thumbnail, label, and <code>MM:SS</code> timecode.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>▸</span>
              <span>
                <strong>Click-to-seek</strong> — clicking a chapter seeks the
                recording to that step&apos;s real <code>atMs</code> offset (via
                the player&apos;s <code>data-seek</code> listener).
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>▸</span>
              <span>
                <strong>Enlarge</strong> — the corner button opens the
                fullscreen screenshot viewer.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>▸</span>
              <span>
                <strong>Cinematic capture</strong> — the recording was made with
                the demo skill&apos;s smooth-scroll walk and CDP full-page
                capture (no resize flicker, animations play).
              </span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
