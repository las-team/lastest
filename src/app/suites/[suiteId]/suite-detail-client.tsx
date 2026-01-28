'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SuiteBuilder } from '@/components/suites/suite-builder';
import { CreateSuiteDialog } from '@/components/suites/create-suite-dialog';
import { deleteSuite, runSuite } from '@/server/actions/suites';
import type { Suite, FunctionalArea } from '@/lib/db/schema';

interface SuiteTest {
  id: string;
  suiteId: string;
  testId: string;
  orderIndex: number;
  testName: string;
  testCode: string;
  targetUrl: string | null;
  functionalAreaId: string | null;
}

interface TestWithStatus {
  id: string;
  name: string;
  code: string;
  targetUrl: string | null;
  functionalAreaId: string | null;
  latestStatus: string | null;
  area: FunctionalArea | null;
}

interface SuiteWithTests extends Suite {
  tests: SuiteTest[];
}

interface SuiteDetailClientProps {
  suite: SuiteWithTests;
  availableTests: TestWithStatus[];
  areas: FunctionalArea[];
}

export function SuiteDetailClient({ suite, availableTests, areas }: SuiteDetailClientProps) {
  const router = useRouter();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete suite "${suite.name}"? This cannot be undone.`)) return;
    await deleteSuite(suite.id);
    router.push('/suites');
  };

  const handleRun = async () => {
    if (suite.tests.length === 0) {
      alert('Add tests to the suite before running');
      return;
    }
    setIsRunning(true);
    try {
      await runSuite(suite.id);
      router.push('/run');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to run suite');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="p-6 border-b bg-muted/30">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">{suite.name}</h2>
            {suite.description && (
              <p className="text-sm text-muted-foreground mt-1">{suite.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {suite.tests.length} test{suite.tests.length !== 1 ? 's' : ''} in suite
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleRun} disabled={isRunning || suite.tests.length === 0}>
              <Play className="w-4 h-4 mr-2" />
              {isRunning ? 'Starting...' : 'Run Suite'}
            </Button>
            <Button variant="outline" size="icon" onClick={() => setIsEditOpen(true)}>
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="text-destructive" onClick={handleDelete}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <SuiteBuilder
        suiteId={suite.id}
        suiteTests={suite.tests}
        availableTests={availableTests}
        areas={areas}
      />

      <CreateSuiteDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        editSuite={suite}
      />
    </div>
  );
}
