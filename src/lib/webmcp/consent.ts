/**
 * Human-in-the-loop consent for agent-initiated mutations.
 *
 * `document.modelContext.requestUserInteraction()` is the spec's hook for
 * getting the page a moment of user attention, but it does not tell the user
 * *what* is about to happen, and the polyfill has no browser UI to raise at
 * all. So Lastest asks its own question, naming the exact action, and the
 * agent's tool call does not proceed until the user says yes.
 *
 * A module-level handler rather than React context: the asker is a WebMCP
 * `execute` callback living outside the React tree, and it needs an answer as
 * a promise. `WebMcpConsentDialog` installs the handler; `window.confirm` is
 * the fallback when no dialog is mounted (e.g. a page that registers tools
 * without the app shell).
 */
export interface WebMcpConsentRequest {
  /** Human-readable action, e.g. "Approve visual diffs". */
  title: string;
  /** What the tool will do, from the registry description. */
  description: string;
}

type ConsentHandler = (request: WebMcpConsentRequest) => Promise<boolean>;

let handler: ConsentHandler | null = null;

/** Install the in-app asker. Returns a disposer; last mount wins. */
export function setWebMcpConsentHandler(next: ConsentHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export async function requestWebMcpConsent(
  request: WebMcpConsentRequest,
): Promise<boolean> {
  if (handler) return handler(request);
  if (typeof window === "undefined") return false;
  return window.confirm(
    `Allow the AI agent to run "${request.title}" in Lastest?`,
  );
}
