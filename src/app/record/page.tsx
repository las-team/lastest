import { Header } from '@/components/layout/header';
import { RecordingClient } from './recording-client';
import { getFunctionalAreas } from '@/lib/db/queries';

export default async function RecordPage() {
  const areas = await getFunctionalAreas();

  return (
    <div className="flex flex-col h-full">
      <Header title="Record Test" />
      <RecordingClient areas={areas} />
    </div>
  );
}
