import { MobileClient } from "./mobile-client";

/**
 * Mobile PoC live view (issue #197). Renders the mobile runner's simulator
 * stream in Lastest's existing embedded-browser viewer.
 */
export default function MobilePage() {
  return <MobileClient />;
}
