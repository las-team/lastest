"use client";

import { createContext, useContext } from "react";

/**
 * Whether in-product AI ("agent functions") is available to the user — true only
 * when the team has NOT banned AI and HAS configured in-product AI (BYOK). When
 * false, AI CTAs are replaced with an MCP hint so the user drives Lastest from
 * their own agent instead. Computed server-side in the app layout.
 */
const AiAvailabilityContext = createContext<boolean>(false);

export function AiAvailabilityProvider({
  aiEnabled,
  children,
}: {
  aiEnabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <AiAvailabilityContext.Provider value={aiEnabled}>
      {children}
    </AiAvailabilityContext.Provider>
  );
}

export function useAiEnabled(): boolean {
  return useContext(AiAvailabilityContext);
}
