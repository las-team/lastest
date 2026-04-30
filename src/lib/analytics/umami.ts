type EventData = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: EventData) => void;
      identify: (id: string, data?: EventData) => void;
    };
  }
}

export function track(event: string, data?: EventData): void {
  if (typeof window === "undefined") return;
  try {
    window.umami?.track(event, data);
  } catch {
    // Tracker errors must never propagate to app code.
  }
}

export function identify(id: string, data?: EventData): void {
  if (typeof window === "undefined") return;
  try {
    window.umami?.identify(id, data);
  } catch {
    // Tracker errors must never propagate to app code.
  }
}
