"use client";

import { useId, useState } from "react";
import type { DomDiffResult, DomSnapshotElement } from "@/lib/db/schema";
import type { XrayElement } from "@/lib/share/xray";

// Ported from the authenticated Verify > DOM tab, in two modes:
//  - "diff":  draws each changed element's bounding box on the step's current
//             screenshot (the original behaviour; used on regression shares).
//  - "xray":  annotates a step's captured element inventory (h1, landmarks, CTAs,
//             fields) over the screenshot — the DOM X-ray showcase on demo shares.
// Bounding boxes are in the screenshot's native pixel space; we measure the
// image's natural size on load and position boxes as percentages so the overlay
// scales with the responsive <img>. Self-contained (no app CSS vars) so it
// renders correctly on the public share page.
//
// Interaction model (accessible, applies to BOTH modes): every box is a focusable
// <button> with a visible focus ring; its popover opens on focus AND click/tap
// (toggle) and closes on Escape or blur. Color is never the only signal — the
// +/−/~ sign (diff) or the role/tag label (xray) renders in the chip text.

type Tone =
  | "added"
  | "removed"
  | "changed"
  | "heading"
  | "region"
  | "action"
  | "field"
  | "other";

const TONE_STYLE: Record<
  Tone,
  { box: string; chipBg: string; ring: string; popBorder: string; sign: string }
> = {
  added: {
    box: "border-emerald-500 bg-emerald-500/25",
    chipBg: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-500/40",
    popBorder: "border-emerald-500",
    sign: "+",
  },
  removed: {
    box: "border-rose-500 bg-rose-500/25",
    chipBg: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    ring: "ring-rose-500/40",
    popBorder: "border-rose-500",
    sign: "−",
  },
  changed: {
    box: "border-amber-500 bg-amber-500/25",
    chipBg: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    ring: "ring-amber-500/40",
    popBorder: "border-amber-500",
    sign: "~",
  },
  heading: {
    box: "border-sky-500 bg-sky-500/20",
    chipBg: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    ring: "ring-sky-500/40",
    popBorder: "border-sky-500",
    sign: "H",
  },
  region: {
    box: "border-violet-500 bg-violet-500/15",
    chipBg: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    ring: "ring-violet-500/40",
    popBorder: "border-violet-500",
    sign: "▢",
  },
  action: {
    box: "border-emerald-500 bg-emerald-500/20",
    chipBg: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-500/40",
    popBorder: "border-emerald-500",
    sign: "▸",
  },
  field: {
    box: "border-amber-500 bg-amber-500/15",
    chipBg: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    ring: "ring-amber-500/40",
    popBorder: "border-amber-500",
    sign: "▤",
  },
  other: {
    box: "border-slate-400 bg-slate-400/15",
    chipBg: "bg-muted text-muted-foreground",
    ring: "ring-slate-400/40",
    popBorder: "border-slate-400",
    sign: "·",
  },
};

const ROLE_LABEL: Record<string, string> = {
  heading: "heading",
  region: "region",
  action: "action",
  field: "field",
  other: "element",
};

type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: Tone;
  tag: string;
  selector: string;
  text: string;
  /** Persistent chip label (xray pinned elements) shown without interaction. */
  label?: string;
  pinned?: boolean;
};

function toPct(
  b: { x: number; y: number; width: number; height: number },
  vw: number,
  vh: number,
) {
  return {
    x: vw > 0 ? (b.x / vw) * 100 : 0,
    y: vh > 0 ? (b.y / vh) * 100 : 0,
    w: vw > 0 ? (b.width / vw) * 100 : 0,
    h: vh > 0 ? (b.height / vh) * 100 : 0,
  };
}

function diffBoxes(dom: DomDiffResult, vw: number, vh: number): Box[] {
  const out: Box[] = [];
  const push = (el: DomSnapshotElement, tone: Tone) => {
    const b = el.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
    out.push({
      ...toPct(b, vw, vh),
      tone,
      tag: el.tag,
      selector: el.selectors?.[0]?.value ?? "",
      text: (el.textContent ?? "").trim(),
    });
  };
  for (const el of dom.removed ?? []) push(el, "removed");
  for (const el of dom.added ?? []) push(el, "added");
  for (const c of dom.changed ?? []) push(c.current, "changed");
  return out;
}

function xrayBoxes(elements: XrayElement[], vw: number, vh: number): Box[] {
  return elements.map((el) => ({
    ...toPct(el.boundingBox, vw, vh),
    tone: el.role as Tone,
    tag: el.tag,
    selector: el.selector,
    text: el.text,
    label: el.label,
    pinned: el.pinned,
  }));
}

export function DomOverlay({
  screenshotSrc,
  dom,
  elements,
  stepLabel,
  variant = "diff",
}: {
  screenshotSrc: string;
  dom?: DomDiffResult;
  elements?: XrayElement[];
  stepLabel: string | null;
  variant?: "diff" | "xray";
}) {
  const uid = useId();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // `active` = focused/clicked (sticky, keyboard + touch). `hovered` = mouse.
  const [active, setActive] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  // Read intrinsic size via BOTH a ref callback and onLoad: a cached/decoded
  // <img> finishes before React attaches onLoad, so the ref callback's
  // `complete` check is what guarantees `size` gets set in that case.
  const measure = (img: HTMLImageElement | null) => {
    if (!img || !img.complete || img.naturalWidth === 0) return;
    setSize((s) =>
      s && s.w === img.naturalWidth && s.h === img.naturalHeight
        ? s
        : { w: img.naturalWidth, h: img.naturalHeight },
    );
  };

  const isXray = variant === "xray";
  const allBoxes: Box[] = size
    ? isXray
      ? xrayBoxes(elements ?? [], size.w, size.h)
      : dom
        ? diffBoxes(dom, size.w, size.h)
        : []
    : [];

  // DOM snapshots span the whole document; the screenshot is often just the
  // viewport. Keep only boxes overlapping the captured frame; count the rest.
  const boxes = allBoxes.filter(
    (r) => r.x < 100 && r.y < 100 && r.x + r.w > 0 && r.y + r.h > 0,
  );
  const offFrameCount = allBoxes.length - boxes.length;
  // Diff mode: if every change is off-frame there's nothing to annotate — hide
  // the redundant screenshot. Xray mode never hides (the screenshot IS the point).
  const hideFrame = !isXray && size != null && boxes.length === 0;

  const added = dom?.added?.length ?? 0;
  const removed = dom?.removed?.length ?? 0;
  const changed = dom?.changed?.length ?? 0;

  return (
    <figure className="space-y-2">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        {stepLabel && (
          <span className="font-medium text-foreground truncate">
            {stepLabel}
          </span>
        )}
        {isXray ? (
          <span className="text-muted-foreground">
            Tab or tap the highlighted elements
          </span>
        ) : (
          <>
            <span
              className={`font-mono rounded px-1 ${TONE_STYLE.added.chipBg}`}
            >
              +{added} added
            </span>
            <span
              className={`font-mono rounded px-1 ${TONE_STYLE.removed.chipBg}`}
            >
              −{removed} removed
            </span>
            <span
              className={`font-mono rounded px-1 ${TONE_STYLE.changed.chipBg}`}
            >
              ~{changed} changed
            </span>
          </>
        )}
      </header>
      <div
        className={`relative rounded-md border bg-muted overflow-hidden ${
          hideFrame ? "hidden" : ""
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={measure}
          src={screenshotSrc}
          alt={
            isXray
              ? stepLabel
                ? `Annotated elements on ${stepLabel}`
                : "Annotated page elements"
              : stepLabel
                ? `DOM changes for ${stepLabel}`
                : "DOM changes"
          }
          loading="lazy"
          decoding="async"
          onLoad={(e) => measure(e.currentTarget)}
          className="block w-full h-auto select-none"
        />
        <div className="absolute inset-0 pointer-events-none">
          {boxes.map((r, i) => {
            const t = TONE_STYLE[r.tone];
            const shown = active === i || hovered === i;
            const popId = `${uid}-pop-${i}`;
            const pinRight = r.x < 50;
            const roleWord = isXray
              ? (ROLE_LABEL[r.tone] ?? "element")
              : r.tone;
            return (
              <button
                type="button"
                key={i}
                aria-label={`${roleWord} <${r.tag}>${r.selector ? ` ${r.selector}` : ""}`}
                aria-expanded={shown}
                aria-describedby={shown ? popId : undefined}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                onClick={() => setActive((a) => (a === i ? null : i))}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setActive(null);
                    e.currentTarget.blur();
                  }
                }}
                className={`absolute rounded-[2px] border-2 p-0 pointer-events-auto cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${t.box} ${
                  shown ? `ring-2 ${t.ring} z-20` : "ring-1 ring-black/25 z-10"
                }`}
                style={{
                  left: `${r.x}%`,
                  top: `${r.y}%`,
                  width: `${r.w}%`,
                  height: `${r.h}%`,
                }}
              >
                {/* Persistent label for pinned xray elements — visible with no
                    interaction (the "first scroll-through" requirement). */}
                {r.pinned && r.label && !shown && (
                  <span
                    className={`absolute -top-5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium shadow-sm ${t.chipBg} ${
                      pinRight ? "left-0" : "right-0"
                    }`}
                  >
                    <span aria-hidden="true" className="mr-0.5 font-mono">
                      {t.sign}
                    </span>
                    {r.label}
                  </span>
                )}
                {shown && (
                  <span
                    id={popId}
                    role="tooltip"
                    className={`absolute top-0 z-30 block min-w-[200px] max-w-[300px] rounded-md border bg-card text-left text-foreground p-2 text-[11px] leading-relaxed shadow-lg ${t.popBorder} ${
                      pinRight ? "left-full ml-1.5" : "right-full mr-1.5"
                    }`}
                  >
                    <span className="mb-1 flex items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${t.chipBg}`}
                      >
                        <span aria-hidden="true" className="mr-0.5 font-mono">
                          {t.sign}
                        </span>
                        {roleWord}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {`<${r.tag}>`}
                      </span>
                    </span>
                    {r.selector && (
                      <span className="block font-mono break-all text-[10.5px]">
                        {r.selector}
                      </span>
                    )}
                    {r.text && (
                      <span className="mt-1 block italic break-words text-muted-foreground">
                        {r.text.length > 240
                          ? r.text.slice(0, 237) + "…"
                          : r.text}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {offFrameCount > 0 && (
        <figcaption className="text-[11px] text-muted-foreground">
          {offFrameCount} {boxes.length > 0 ? "more " : ""}
          {isXray ? "element" : "change"}
          {offFrameCount === 1 ? "" : "s"} below the captured frame
        </figcaption>
      )}
    </figure>
  );
}
