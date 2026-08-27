"use client";

/**
 * The dialog behind `requestWebMcpConsent()`. Mounted once by
 * `WebMcpProvider`; every agent-initiated mutation waits on it.
 *
 * Deliberately not dismissible-as-approval: closing it resolves `false`. An
 * agent must never be able to turn "the user ignored this" into consent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  setWebMcpConsentHandler,
  type WebMcpConsentRequest,
} from "@/lib/webmcp/consent";

export function WebMcpConsentDialog() {
  const [request, setRequest] = useState<WebMcpConsentRequest | null>(null);
  const resolveRef = useRef<((allowed: boolean) => void) | null>(null);

  const settle = useCallback((allowed: boolean) => {
    resolveRef.current?.(allowed);
    resolveRef.current = null;
    setRequest(null);
  }, []);

  useEffect(() => {
    return setWebMcpConsentHandler((next) => {
      // A second request while one is open: refuse it rather than stack
      // dialogs, so the answer always belongs to the question shown.
      if (resolveRef.current) return Promise.resolve(false);
      setRequest(next);
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
      });
    });
  }, []);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title ?? ""}</DialogTitle>
          <DialogDescription>
            An AI agent in your browser is asking to do this in Lastest, as you.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{request?.description}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button onClick={() => settle(true)}>Allow</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
