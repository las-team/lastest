import { LegalDoc } from "@/components/legal/legal-doc";
import { TERMS_VERSION } from "@/lib/legal/versions";

export const metadata = {
  title: "Terms of Service - Lastest",
  description:
    "The Terms of Service for Lastest, the open-source AI visual regression testing platform: your rights, responsibilities, and acceptable use of the app.",
};

export default function TermsOfServicePage() {
  return (
    <LegalDoc slug="terms" title="Terms of Service" version={TERMS_VERSION} />
  );
}
