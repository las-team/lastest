import { LegalDoc } from '@/components/legal/legal-doc';
import { COOKIES_VERSION } from '@/lib/legal/versions';

export const metadata = {
  title: 'Cookie Policy - Lastest',
};

export default function CookiePolicyPage() {
  return <LegalDoc slug="cookies" title="Cookie Policy" version={COOKIES_VERSION} />;
}
