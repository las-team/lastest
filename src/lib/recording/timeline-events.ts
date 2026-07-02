/**
 * Shared helpers for rendering a recording "timeline" — the per-action list of
 * StepCards shown both in the /record flow (recording-client) and in the test
 * debug "record from here" view (debug-client).
 *
 * The describe/replayable logic only ever reads `event.type` and fields under
 * `event.data`, so it is typed against a minimal structural shape that both the
 * recorder's `RecordingEvent` and a debug `CodeGenEvent` (after adaptation)
 * satisfy. See `codeGenEventToStepCardEvent` for the debug adapter.
 */
import type {
  StepCardEvent,
  StepCardSelector,
} from "@/components/recording/step-card";
import type { CodeGenEvent } from "@/lib/playwright/event-to-code";

export type KeyboardModifier = "Alt" | "Control" | "Shift" | "Meta";

/** The minimal event shape the timeline helpers need to read. */
export interface TimelineEvent {
  type: string;
  data: {
    action?: string;
    selector?: string;
    selectors?: StepCardSelector[];
    value?: string;
    url?: string;
    relativePath?: string;
    coordinates?: { x: number; y: number };
    modifiers?: KeyboardModifier[] | string[];
    key?: string;
    assertionType?: string;
    elementAssertion?: {
      type: string;
      selectors: StepCardSelector[];
    };
    downloadWrap?: boolean;
    waitType?: "duration" | "selector";
    durationMs?: number;
    condition?: "visible" | "hidden";
    elementInfo?: {
      tagName: string;
      id?: string;
      textContent?: string;
      potentialAction?: string;
      selectors?: StepCardSelector[];
    };
    [key: string]: unknown;
  };
}

export function isActionReplayable(event: TimelineEvent): {
  replayable: boolean;
  reason?: "valid-selectors" | "coords-only" | "no-selectors";
} {
  if (event.type !== "action") {
    return { replayable: true }; // Non-action events are always replayable
  }

  const selectors = event.data.selectors || [];
  const validSelectors = selectors.filter(
    (sel) => sel.value && sel.value.trim() && !sel.value.includes("undefined"),
  );
  const hasCoords = event.data.coordinates !== undefined;

  if (validSelectors.length > 0) {
    return { replayable: true, reason: "valid-selectors" };
  }

  if (
    (event.data.action === "click" || event.data.action === "rightclick") &&
    hasCoords
  ) {
    return { replayable: true, reason: "coords-only" };
  }

  return { replayable: false, reason: "no-selectors" };
}

function formatModifiers(modifiers?: KeyboardModifier[] | string[]): string {
  if (!modifiers || modifiers.length === 0) return "";
  return `[${modifiers.join("+")}] `;
}

export function getEventDescription(event: TimelineEvent): string {
  const modPrefix = formatModifiers(event.data.modifiers);
  switch (event.type) {
    case "navigation":
      return `Navigate to ${event.data.relativePath || event.data.url || "page"}`;
    case "action":
      if (event.data.action === "click") {
        const dlSuffix = event.data.downloadWrap ? " (download)" : "";
        return `${modPrefix}Click ${event.data.selector?.slice(0, 40) || "element"}${dlSuffix}`;
      }
      if (event.data.action === "rightclick") {
        const coords = event.data.coordinates;
        const target =
          event.data.selector?.slice(0, 40) ||
          (coords ? `at (${coords.x}, ${coords.y})` : "element");
        return `${modPrefix}Right-click ${target}`;
      }
      if (event.data.action === "fill") {
        return `Fill ${event.data.selector?.slice(0, 30) || "input"} with "${event.data.value?.slice(0, 20) || ""}"`;
      }
      if (event.data.action === "selectOption") {
        return `Select "${event.data.value?.slice(0, 20) || ""}"`;
      }
      return event.data.action || "action";
    case "screenshot":
      return "Screenshot captured";
    case "assertion":
      // Handle element assertions from Shift+right-click
      if (event.data.elementAssertion) {
        const ea = event.data.elementAssertion;
        const assertLabel = ea.type
          .replace(/^to/, "")
          .replace(/([A-Z])/g, " $1")
          .trim();
        const selectorHint = ea.selectors[0]?.value?.slice(0, 25) || "element";
        return `Assert: ${assertLabel} on ${selectorHint}`;
      }
      // Page-level assertions
      const labels: Record<string, string> = {
        pageLoad: "Page Load",
        networkIdle: "Network Idle",
        urlMatch: "URL Match",
        domContentLoaded: "DOM Ready",
      };
      return `Assert: ${labels[event.data.assertionType || ""] || event.data.assertionType}`;
    case "download":
      return "Download expected";
    case "insert-timestamp":
      return "Insert timestamp";
    case "mouse-down":
      return `${modPrefix}Mouse down at (${event.data.coordinates?.x}, ${event.data.coordinates?.y})`;
    case "mouse-up":
      return `${modPrefix}Mouse up at (${event.data.coordinates?.x}, ${event.data.coordinates?.y})`;
    case "hover-preview": {
      const info = event.data.elementInfo;
      if (info) {
        const parts: string[] = [];
        parts.push(`<${info.tagName}>`);
        if (info.id) parts.push(`#${info.id}`);
        if (info.textContent)
          parts.push(
            `"${info.textContent.slice(0, 15)}${info.textContent.length > 15 ? "..." : ""}"`,
          );
        const selectorCount = info.selectors?.length || 0;
        if (selectorCount > 0) parts.push(`(${selectorCount} sel)`);
        return `${info.potentialAction || "interact"} → ${parts.join(" ")}`;
      }
      return "Hovering...";
    }
    case "keypress":
      return `${modPrefix}Press "${event.data.key || "key"}"`;
    case "keydown":
      return `Hold "${event.data.key || "key"}"`;
    case "keyup":
      return `Release "${event.data.key || "key"}"`;
    case "wait": {
      if (event.data.waitType === "duration") {
        return `Wait ${event.data.durationMs ?? 0}ms`;
      }
      const sel =
        event.data.selector || event.data.selectors?.[0]?.value || "element";
      const cond = event.data.condition || "visible";
      return `Wait for ${sel.slice(0, 30)} (${cond})`;
    }
    default:
      return event.type;
  }
}

/**
 * Adapt a debug-session `CodeGenEvent` to the `StepCardEvent` shape the timeline
 * renders. Debug recorder events have no preview/verification lifecycle and no
 * per-event sequence, so `status` is always "committed" and `sequence` is the
 * positional index within the live buffer (stable for keys while the list only
 * grows).
 */
export function codeGenEventToStepCardEvent(
  event: CodeGenEvent,
  index: number,
): StepCardEvent {
  return {
    type: event.type,
    timestamp: event.timestamp,
    sequence: index,
    status: "committed",
    data: event.data as StepCardEvent["data"],
  };
}
