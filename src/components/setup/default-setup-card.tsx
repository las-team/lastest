'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Settings } from 'lucide-react';
import { SetupSelector, type SetupSelection } from './setup-selector';
import { updateRepositoryDefaultSetup } from '@/server/actions/setup-scripts';
import { toast } from 'sonner';
import type { Repository, Test, SetupScript } from '@/lib/db/schema';

interface DefaultSetupCardProps {
  repository: Repository;
  setupScripts: SetupScript[];
  availableTests: Test[];
}

export function DefaultSetupCard({
  repository,
  setupScripts,
  availableTests,
}: DefaultSetupCardProps) {
  const [selection, setSelection] = useState<SetupSelection>({ type: 'none' });
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize selection from repository defaults
  useEffect(() => {
    if (repository.defaultSetupTestId) {
      const test = availableTests.find((t) => t.id === repository.defaultSetupTestId);
      if (test) {
        setSelection({ type: 'test', id: test.id, name: test.name });
      }
    } else if (repository.defaultSetupScriptId) {
      const script = setupScripts.find((s) => s.id === repository.defaultSetupScriptId);
      if (script) {
        setSelection({ type: 'script', id: script.id, name: script.name });
      }
    } else {
      setSelection({ type: 'none' });
    }
    setHasChanges(false);
  }, [repository, availableTests, setupScripts]);

  const handleSelectionChange = (newSelection: SetupSelection) => {
    setSelection(newSelection);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateRepositoryDefaultSetup(
        repository.id,
        selection.type,
        selection.type === 'none' ? null : selection.id
      );
      toast.success('Default setup updated');
      setHasChanges(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update default setup');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Repository Default Setup
        </CardTitle>
        <CardDescription>
          Set a default setup that applies to all tests in this repository.
          Individual tests can override this default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Default Setup</label>
          <SetupSelector
            value={selection}
            onChange={handleSelectionChange}
            availableTests={availableTests}
            availableScripts={setupScripts}
          />
        </div>

        <div className="text-sm text-muted-foreground">
          <p>
            {selection.type === 'none' && 'No default setup configured. Tests will run without setup.'}
            {selection.type === 'test' && `Tests will run "${selection.name}" as setup first.`}
            {selection.type === 'script' && `Tests will execute the "${selection.name}" script before running.`}
          </p>
        </div>

        {hasChanges && (
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
