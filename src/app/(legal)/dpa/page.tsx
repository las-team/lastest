import { LegalDoc } from '@/components/legal/legal-doc';
import { DPA_VERSION } from '@/lib/legal/versions';

export const metadata = {
  title: 'Data Processing Agreement - Lastest',
};

export default function DataProcessingAgreementPage() {
  return <LegalDoc slug="dpa" title="Data Processing Agreement" version={DPA_VERSION} />;
}
