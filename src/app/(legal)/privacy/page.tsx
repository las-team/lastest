import { LegalDoc } from '@/components/legal/legal-doc';
import { PRIVACY_VERSION } from '@/lib/legal/versions';

export const metadata = {
  title: 'Privacy Policy - Lastest',
};

export default function PrivacyPolicyPage() {
  return <LegalDoc slug="privacy" title="Privacy Policy" version={PRIVACY_VERSION} />;
}
