"use client";

import { BrowserViewer } from "@/components/embedded-browser/browser-viewer-client";

/**
 * The app's fill for the explorer plugin's live-browser slot.
 *
 * The EB stream viewer is ~1,300 lines wired to the stream protocol and shared
 * across half the product — core's side of the boundary, not a feature's. The
 * plugin declares a slot typed as `ComponentType<{ streamUrl: string }>`; this
 * is what goes in it.
 *
 * A *component* rather than a render function, deliberately: the plugin's page
 * is a server component and the thing it hands down has to cross the RSC
 * boundary. A function prop cannot; a reference to a `"use client"` component
 * can, because that is exactly what the client-reference manifest exists to
 * carry.
 */
export function ExplorerBrowserViewer({ streamUrl }: { streamUrl: string }) {
  return (
    <BrowserViewer
      streamUrl={streamUrl}
      interactive={false}
      hideToolbar
      className="rounded-md overflow-hidden border"
    />
  );
}
