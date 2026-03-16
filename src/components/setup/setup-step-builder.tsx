'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus, Search, ChevronRight, FlaskConical, FileCode, Settings, Cookie } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SetupStepItem } from './setup-step-item';
import { SetupScriptEditor } from './setup-script-editor';
import {
  addDefaultSetupStep,
  removeDefaultSetupStep,
  reorderDefaultSetupSteps,
  type SetupStep,
} from '@/server/actions/setup-steps';
import type { Test, SetupScript, StorageState } from '@/lib/db/schema';

interface SetupStepBuilderProps {
  repositoryId: string;
  setupSteps: SetupStep[];
  availableTests: Test[];
  availableScripts: SetupScript[];
  availableStorageStates?: StorageState[];
  onAddStep?: (repoId: string, stepType: 'test' | 'script' | 'storage_state', itemId: string) => Promise<unknown>;
  onRemoveStep?: (stepId: string) => Promise<unknown>;
  onReorderSteps?: (repoId: string, stepIds: string[]) => Promise<unknown>;
  title?: string;
  description?: string;
}

export function SetupStepBuilder({
  repositoryId,
  setupSteps,
  availableTests,
  availableScripts,
  availableStorageStates = [],
  onAddStep,
  onRemoveStep,
  onReorderSteps,
  title = 'Default Setup Steps',
  description = 'Configure the default setup sequence for all tests in this repository.',
}: SetupStepBuilderProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [orderedSteps, setOrderedSteps] = useState(setupSteps);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['tests', 'scripts', 'auth-states'])
  );

  // Script editor state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<SetupScript | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOrderedSteps(setupSteps);
  }, [setupSteps]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Filter available items - memoize selected IDs inside the useMemo
  const filteredTests = useMemo(() => {
    const selectedTestIds = new Set(
      orderedSteps.filter((s) => s.stepType === 'test').map((s) => s.testId)
    );
    return availableTests.filter(
      (t) =>
        !selectedTestIds.has(t.id) &&
        t.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableTests, orderedSteps, searchQuery]);

  const filteredScripts = useMemo(() => {
    const selectedScriptIds = new Set(
      orderedSteps.filter((s) => s.stepType === 'script').map((s) => s.scriptId)
    );
    return availableScripts.filter(
      (s) =>
        !selectedScriptIds.has(s.id) &&
        s.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableScripts, orderedSteps, searchQuery]);

  const filteredStorageStates = useMemo(() => {
    const selectedStorageStateIds = new Set(
      orderedSteps.filter((s) => s.stepType === 'storage_state').map((s) => s.storageStateId)
    );
    return availableStorageStates.filter(
      (ss) =>
        !selectedStorageStateIds.has(ss.id) &&
        ss.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableStorageStates, orderedSteps, searchQuery]);

  // Create a map of script ID to script for quick lookup
  const scriptsById = useMemo(() => {
    return new Map(availableScripts.map((s) => [s.id, s]));
  }, [availableScripts]);

  const addStepAction = onAddStep ?? addDefaultSetupStep;
  const removeStepAction = onRemoveStep ?? removeDefaultSetupStep;
  const reorderStepsAction = onReorderSteps ?? reorderDefaultSetupSteps;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedSteps.findIndex((s) => s.id === active.id);
    const newIndex = orderedSteps.findIndex((s) => s.id === over.id);

    const newOrder = arrayMove(orderedSteps, oldIndex, newIndex);
    setOrderedSteps(newOrder);

    // Persist reorder
    await reorderStepsAction(repositoryId, newOrder.map((s) => s.id));
  };

  const handleAddTest = async (testId: string) => {
    await addStepAction(repositoryId, 'test', testId);
    router.refresh();
  };

  const handleAddScript = async (scriptId: string) => {
    await addStepAction(repositoryId, 'script', scriptId);
    router.refresh();
  };

  const handleAddStorageState = async (storageStateId: string) => {
    await addStepAction(repositoryId, 'storage_state', storageStateId);
    router.refresh();
  };

  const handleRemoveStep = async (stepId: string) => {
    await removeStepAction(stepId);
    router.refresh();
  };

  const handleEditScript = (scriptId: string) => {
    const script = scriptsById.get(scriptId);
    if (script) {
      setEditingScript(script);
      setIsEditorOpen(true);
    }
  };

  const handleCreateScript = () => {
    setEditingScript(null);
    setIsEditorOpen(true);
  };

  const handleEditorClose = () => {
    setIsEditorOpen(false);
    setEditingScript(null);
    router.refresh();
  };

  const toggleSection = (section: string) => {
    const next = new Set(expandedSections);
    if (next.has(section)) {
      next.delete(section);
    } else {
      next.add(section);
    }
    setExpandedSections(next);
  };

  if (!mounted) {
    return (
      <div className="flex gap-4 overflow-hidden" style={{ height: '500px' }}>
        <div className="w-1/2 border rounded-lg p-4 bg-card">Loading...</div>
        <div className="w-1/2 border rounded-lg p-4 bg-card">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-muted-foreground" />
            <div>
              <h3 className="font-medium">{title}</h3>
              <p className="text-sm text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-4 overflow-hidden" style={{ height: '500px' }}>
          {/* Available Items Panel */}
          <div className="w-1/2 border rounded-lg flex flex-col bg-card">
            <div className="p-4 border-b">
              <h4 className="font-medium mb-3 text-sm">Available</h4>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search tests and scripts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {/* Tests Section */}
              <div className="border rounded-lg">
                <button
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSection('tests')}
                >
                  <ChevronRight
                    className={`w-4 h-4 transition-transform ${
                      expandedSections.has('tests') ? 'rotate-90' : ''
                    }`}
                  />
                  <FlaskConical className="w-4 h-4 text-blue-500" />
                  <span className="font-medium text-sm">Tests</span>
                  <Badge variant="secondary" className="ml-auto">
                    {filteredTests.length}
                  </Badge>
                </button>
                {expandedSections.has('tests') && filteredTests.length > 0 && (
                  <div className="border-t divide-y max-h-56 overflow-auto">
                    {filteredTests.map((test) => (
                      <div
                        key={test.id}
                        className="flex items-center gap-3 p-3 hover:bg-muted/30"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{test.name}</p>
                          {test.targetUrl && (
                            <p className="text-xs text-muted-foreground truncate">
                              {test.targetUrl}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleAddTest(test.id)}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {expandedSections.has('tests') && filteredTests.length === 0 && (
                  <div className="border-t p-3">
                    <p className="text-sm text-muted-foreground text-center">
                      {searchQuery ? 'No tests match' : 'All tests added'}
                    </p>
                  </div>
                )}
              </div>

              {/* Scripts Section */}
              <div className="border rounded-lg">
                <button
                  className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSection('scripts')}
                >
                  <ChevronRight
                    className={`w-4 h-4 transition-transform ${
                      expandedSections.has('scripts') ? 'rotate-90' : ''
                    }`}
                  />
                  <FileCode className="w-4 h-4 text-green-500" />
                  <span className="font-medium text-sm">Scripts</span>
                  <Badge variant="secondary" className="ml-auto">
                    {filteredScripts.length}
                  </Badge>
                </button>
                {expandedSections.has('scripts') && (
                  <div className="border-t">
                    {/* New Script Button */}
                    <button
                      className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/30 text-sm text-primary"
                      onClick={handleCreateScript}
                    >
                      <Plus className="w-4 h-4" />
                      <span>New Script</span>
                    </button>
                    {filteredScripts.length > 0 && (
                      <div className="divide-y max-h-56 overflow-auto">
                        {filteredScripts.map((script) => (
                          <div
                            key={script.id}
                            className="flex items-center gap-3 p-3 hover:bg-muted/30"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{script.name}</p>
                              {script.description && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {script.description}
                                </p>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleAddScript(script.id)}
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {filteredScripts.length === 0 && (
                      <div className="p-3 border-t">
                        <p className="text-sm text-muted-foreground text-center">
                          {searchQuery ? 'No scripts match' : 'All scripts added'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Auth States Section */}
              {availableStorageStates.length > 0 && (
                <div className="border rounded-lg">
                  <button
                    className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => toggleSection('auth-states')}
                  >
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${
                        expandedSections.has('auth-states') ? 'rotate-90' : ''
                      }`}
                    />
                    <Cookie className="w-4 h-4 text-amber-500" />
                    <span className="font-medium text-sm">Auth States</span>
                    <Badge variant="secondary" className="ml-auto">
                      {filteredStorageStates.length}
                    </Badge>
                  </button>
                  {expandedSections.has('auth-states') && filteredStorageStates.length > 0 && (
                    <div className="border-t divide-y max-h-56 overflow-auto">
                      {filteredStorageStates.map((ss) => (
                        <div
                          key={ss.id}
                          className="flex items-center gap-3 p-3 hover:bg-muted/30"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{ss.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {ss.cookieCount} cookies, {ss.originCount} origins
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleAddStorageState(ss.id)}
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  {expandedSections.has('auth-states') && filteredStorageStates.length === 0 && (
                    <div className="border-t p-3">
                      <p className="text-sm text-muted-foreground text-center">
                        {searchQuery ? 'No auth states match' : 'All auth states added'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Selected Steps Panel (Sortable) */}
          <div className="w-1/2 border rounded-lg flex flex-col bg-card">
            <div className="p-4 border-b">
              <h4 className="font-medium text-sm">Selected Steps</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Drag to reorder. Steps run in this order.
              </p>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {orderedSteps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Add tests or scripts from the left panel
                </p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={orderedSteps.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {orderedSteps.map((step, index) => (
                        <SetupStepItem
                          key={step.id}
                          id={step.id}
                          stepType={step.stepType}
                          name={step.testName || step.scriptName || step.storageStateName || 'Unknown'}
                          index={index}
                          onRemove={() => handleRemoveStep(step.id)}
                          onEdit={
                            step.stepType === 'script' && step.scriptId
                              ? () => handleEditScript(step.scriptId!)
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </div>
      </div>

      <SetupScriptEditor
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        onClose={handleEditorClose}
        repositoryId={repositoryId}
        editScript={editingScript}
      />
    </>
  );
}
