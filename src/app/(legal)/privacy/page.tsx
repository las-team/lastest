import { LegalDoc } from "@/components/legal/legal-doc";
import { PRIVACY_VERSION } from "@/lib/legal/versions";

export const metadata = {
  title: "Privacy Policy - Lastest",
  description:
    "How Lastest handles your data: what we collect, how visual-test screenshots and recordings are stored, and your privacy rights on the open-source platform.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDoc slug="privacy" title="Privacy Policy" version={PRIVACY_VERSION} />
  );
}
