import { LegalDoc } from '@/components/legal/legal-doc';
import { TERMS_VERSION } from '@/lib/legal/versions';

export const metadata = {
  title: 'Terms of Service - Lastest',
};

export default function TermsOfServicePage() {
  return <LegalDoc slug="terms" title="Terms of Service" version={TERMS_VERSION} />;
}
