'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  discoverSpecFiles,
  extractUserStoriesFromFiles,
  extractUserStoriesFromUpload,
  generateTestsFromStories,
  createPlaceholdersFromStories,
  getBranchChanges,
  validateAllTestsWithMCP,
} from '@/server/actions/spec-import';
import type { DiscoveredSpecFile } from '@/server/actions/spec-import';
import type { ExtractedUserStory } from '@/lib/db/schema';
import {
  Loader2,
  FileText,
  Upload,
  FolderSearch,
  Sparkles,
  Check,
  Square,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileCode,
  FolderTree,
  GitBranch,
  ArrowRight,
  Pencil,
  Trash2,
  Plus,
  Globe,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

type Step = 'input' | 'file-selection' | 'extracting' | 'review' | 'generating' | 'results';

interface ImportFromSpecDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  branch: string;
  onComplete?: () => void;
}

export function ImportFromSpecDialog({
  open,
  onOpenChange,
  repositoryId,
  branch,
  onComplete,
}: ImportFromSpecDialogProps) {
  const [step, setStep] = useState<Step>('input');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreatingPlaceholders, setIsCreatingPlaceholders] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  // File selection
  const [discoveredFiles, setDiscoveredFiles] = useState<DiscoveredSpecFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Extracted stories
  const [stories, setStories] = useState<ExtractedUserStory[]>([]);
  const [importId, setImportId] = useState<string | null>(null);
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set());
  const [editingAC, setEditingAC] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Generation options
  const [useBranchContext, setUseBranchContext] = useState(true);
  const [targetUrl, setTargetUrl] = useState('');
  const [changedFiles, setChangedFiles] = useState<string[]>([]);

  // Results
  const [results, setResults] = useState<{
    areasCreated: number;
    testsCreated: number;
    errors: string[];
    testIds?: string[];
    usedPlaceholders?: boolean;
  } | null>(null);

  // ============================================
  // Step 1: Document Selection
  // ============================================

  const handleGitHubScan = async () => {
    setIsDiscovering(true);
    try {
      const response = await discoverSpecFiles(repositoryId, branch);
      if (response.success && response.files) {
        setDiscoveredFiles(response.files);
        setSelectedFiles(new Set(response.files.map(f => f.path)));
        setStep('file-selection');
        toast.success(`Found ${response.files.length} spec file(s)`);
      } else {
        toast.error(response.error || 'Failed to discover specs');
      }
    } catch {
      toast.error('Failed to scan repository');
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setUploadedFiles(Array.from(e.target.files));
    }
  };

  const toggleFile = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => setSelectedFiles(new Set(discoveredFiles.map(f => f.path)));
  const deselectAll = () => setSelectedFiles(new Set());

  // ============================================
  // Step 2: Extract User Stories
  // ============================================

  const handleExtractFromGitHub = async () => {
    if (selectedFiles.size === 0) {
      toast.error('Please select at least one file');
      return;
    }


    setStep('extracting');
    try {
      const response = await extractUserStoriesFromFiles(
        repositoryId,
        branch,
        Array.from(selectedFiles)
      );
      if (response.success && response.stories) {
        setStories(response.stories);
        setImportId(response.importId || null);
        setExpandedStories(new Set(response.stories.map(s => s.id)));

        // Also fetch branch changes in parallel
        const branchResult = await getBranchChanges(repositoryId, branch);
        if (branchResult.success && branchResult.changedFiles) {
          setChangedFiles(branchResult.changedFiles);
        }

        setStep('review');
        const totalAC = response.stories.reduce((sum, s) => sum + s.acceptanceCriteria.length, 0);
        toast.success(`Extracted ${response.stories.length} user stories, ${totalAC} acceptance criteria`);
      } else {
        toast.error(response.error || 'Failed to extract user stories');
        setStep('file-selection');
      }
    } catch {
      toast.error('Failed to extract user stories');
      setStep('file-selection');
    } finally {

    }
  };

  const handleExtractFromUpload = async () => {
    if (uploadedFiles.length === 0) {
      toast.error('Please select files first');
      return;
    }


    setStep('extracting');
    try {
      const encodedFiles = await Promise.all(
        uploadedFiles.map(async (file) => {
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return { name: file.name, content: btoa(binary) };
        })
      );

      const response = await extractUserStoriesFromUpload(encodedFiles, repositoryId, branch);
      if (response.success && response.stories) {
        setStories(response.stories);
        setImportId(response.importId || null);
        setExpandedStories(new Set(response.stories.map(s => s.id)));

        const branchResult = await getBranchChanges(repositoryId, branch);
        if (branchResult.success && branchResult.changedFiles) {
          setChangedFiles(branchResult.changedFiles);
        }

        setStep('review');
        const totalAC = response.stories.reduce((sum, s) => sum + s.acceptanceCriteria.length, 0);
        toast.success(`Extracted ${response.stories.length} user stories, ${totalAC} acceptance criteria`);
      } else {
        toast.error(response.error || 'Failed to extract user stories');
        setStep('input');
      }
    } catch {
      toast.error('Failed to extract user stories');
      setStep('input');
    } finally {

    }
  };

  // ============================================
  // Step 3: Review & Edit
  // ============================================

  const toggleStory = (storyId: string) => {
    setExpandedStories(prev => {
      const next = new Set(prev);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  };

  const removeStory = (storyId: string) => {
    setStories(prev => prev.filter(s => s.id !== storyId));
  };

  const removeAC = (storyId: string, acId: string) => {
    setStories(prev => prev.map(s => {
      if (s.id !== storyId) return s;
      return {
        ...s,
        acceptanceCriteria: s.acceptanceCriteria.filter(ac => ac.id !== acId),
      };
    }));
  };

  const startEditAC = (acId: string, currentName: string) => {
    setEditingAC(acId);
    setEditingValue(currentName);
  };

  const saveEditAC = (storyId: string, acId: string) => {
    if (!editingValue.trim()) return;
    setStories(prev => prev.map(s => {
      if (s.id !== storyId) return s;
      return {
        ...s,
        acceptanceCriteria: s.acceptanceCriteria.map(ac => {
          if (ac.id !== acId) return ac;
          return { ...ac, testName: editingValue.trim() };
        }),
      };
    }));
    setEditingAC(null);
    setEditingValue('');
  };

  const addACToStory = useCallback((storyId: string) => {
    setStories(prev => prev.map(s => {
      if (s.id !== storyId) return s;
      const newId = `AC-${storyId.replace('US-', '')}.${s.acceptanceCriteria.length + 1}`;
      return {
        ...s,
        acceptanceCriteria: [
          ...s.acceptanceCriteria,
          {
            id: newId,
            description: 'New acceptance criterion',
            testName: 'New test',
          },
        ],
      };
    }));
  }, []);

  // ============================================
  // Step 4: Generate Tests
  // ============================================

  const handleGenerate = async () => {
    if (stories.length === 0) {
      toast.error('No user stories to generate tests from');
      return;
    }

    setIsGenerating(true);
    setStep('generating');
    try {
      const response = await generateTestsFromStories(
        repositoryId,
        importId,
        stories,
        branch,
        {
          useBranchContext,
          targetUrl: targetUrl.trim() || undefined,
        }
      );

      setResults({
        areasCreated: response.areasCreated,
        testsCreated: response.testsCreated,
        errors: response.errors,
      });
      setStep('results');

      if (response.success) {
        toast.success(`Created ${response.areasCreated} areas and ${response.testsCreated} tests`);
      } else {
        toast.error(response.error || 'Failed to generate tests');
      }
    } catch {
      toast.error('Failed to generate tests');
      setStep('review');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreatePlaceholders = async () => {
    if (stories.length === 0) {
      toast.error('No user stories to create placeholders from');
      return;
    }

    setIsCreatingPlaceholders(true);
    setStep('generating');
    try {
      const response = await createPlaceholdersFromStories(
        repositoryId,
        importId,
        stories,
        branch,
        { targetUrl: targetUrl.trim() || undefined }
      );

      setResults({
        areasCreated: response.areasCreated,
        testsCreated: response.testsCreated,
        errors: response.errors,
        usedPlaceholders: true,
      });
      setStep('results');

      if (response.success) {
        toast.success(`Created ${response.areasCreated} areas and ${response.testsCreated} placeholder tests`);
      } else {
        toast.error(response.error || 'Failed to create placeholders');
      }
    } catch {
      toast.error('Failed to create placeholder tests');
      setStep('review');
    } finally {
      setIsCreatingPlaceholders(false);
    }
  };

  // ============================================
  // Step 5: MCP Validation (optional)
  // ============================================

  const handleMCPValidation = async () => {
    if (!results?.testIds || results.testIds.length === 0) return;
    const validationUrl = targetUrl.trim() || 'http://localhost:3000';

    setIsValidating(true);
    try {
      const result = await validateAllTestsWithMCP(
        repositoryId,
        results.testIds,
        validationUrl
      );
      if (result.success) {
        toast.success(`Validated ${result.validated} tests, fixed ${result.fixed}`);
      }
    } catch {
      toast.error('MCP validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  // ============================================
  // Dialog management
  // ============================================

  const handleClose = () => {
    setStep('input');
    setStories([]);
    setImportId(null);
    setDiscoveredFiles([]);
    setSelectedFiles(new Set());
    setUploadedFiles([]);
    setExpandedStories(new Set());
    setResults(null);
    setChangedFiles([]);
    setEditingAC(null);
    onOpenChange(false);
    if (results && results.testsCreated > 0) {
      onComplete?.();
    }
  };

  const totalAC = stories.reduce((sum, s) => sum + s.acceptanceCriteria.length, 0);
  const isLocalhostTarget = targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1') || !targetUrl.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => v ? onOpenChange(true) : handleClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Import from Specification
          </DialogTitle>
          <DialogDescription>
            {step === 'input' && 'Import a specification document to extract User Stories and generate tests.'}
            {step === 'file-selection' && 'Select which spec files to analyze for User Stories.'}
            {step === 'extracting' && 'Extracting User Stories and Acceptance Criteria...'}
            {step === 'review' && `Review ${stories.length} User Stories with ${totalAC} Acceptance Criteria before generating tests.`}
            {step === 'generating' && (isCreatingPlaceholders ? 'Creating placeholder tests for each acceptance criterion...' : 'Generating test scripts for each acceptance criterion...')}
            {step === 'results' && 'Import complete. Review the results below.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Input */}
        {step === 'input' && (
          <Tabs defaultValue="github" className="flex-1">
            <TabsList className="w-full">
              <TabsTrigger value="github" className="flex-1">Scan GitHub</TabsTrigger>
              <TabsTrigger value="upload" className="flex-1">Upload Files</TabsTrigger>
            </TabsList>

            <TabsContent value="github" className="py-4">
              <div className="flex flex-col items-center justify-center py-8 gap-4">
                <FolderSearch className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center max-w-sm">
                  Scan the <code className="font-mono text-xs px-1 py-0.5 bg-muted rounded">{branch}</code> branch
                  for specification files in <code className="text-xs">docs/</code>, <code className="text-xs">specs/</code>,
                  <code className="text-xs">requirements/</code>, and <code className="text-xs">stories/</code>.
                </p>
                <Button onClick={handleGitHubScan} disabled={isDiscovering}>
                  {isDiscovering ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FolderSearch className="h-4 w-4 mr-2" />
                  )}
                  Scan for Specs
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="upload" className="py-4">
              <div className="flex flex-col items-center justify-center py-8 gap-4">
                <Upload className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">
                  Upload specification files (.md, .txt, .pdf, .docx)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md,.txt,.pdf,.docx"
                  onChange={handleFilesChange}
                  className="hidden"
                />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Select Files
                </Button>
                {uploadedFiles.length > 0 && (
                  <div className="w-full space-y-2">
                    <p className="text-sm text-muted-foreground">{uploadedFiles.length} file(s) selected:</p>
                    <div className="flex flex-wrap gap-1">
                      {uploadedFiles.map((f, i) => (
                        <Badge key={i} variant="secondary">{f.name}</Badge>
                      ))}
                    </div>
                    <Button onClick={handleExtractFromUpload} className="w-full mt-2">
                      <Sparkles className="h-4 w-4 mr-2" />
                      Extract User Stories
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* Step 2: File Selection */}
        {step === 'file-selection' && (
          <div className="flex-1 min-h-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {selectedFiles.size} of {discoveredFiles.length} file(s) selected
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  <CheckSquare className="h-4 w-4 mr-1" />
                  All
                </Button>
                <Button variant="ghost" size="sm" onClick={deselectAll}>
                  <Square className="h-4 w-4 mr-1" />
                  None
                </Button>
              </div>
            </div>
            <div className="border rounded-lg max-h-[40vh] overflow-y-auto">
              {discoveredFiles.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                  onClick={() => toggleFile(file.path)}
                >
                  <div className="flex-shrink-0">
                    {selectedFiles.has(file.path) ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <code className="text-sm font-mono truncate block">{file.path}</code>
                  </div>
                  {file.size !== undefined && (
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setStep('input')}>
                Back
              </Button>
              <Button onClick={handleExtractFromGitHub} disabled={selectedFiles.size === 0}>
                <Sparkles className="h-4 w-4 mr-2" />
                Extract User Stories
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Extracting */}
        {step === 'extracting' && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Extracting User Stories & Acceptance Criteria...</p>
            <p className="text-xs text-muted-foreground mt-2">
              AI is analyzing the specification document
            </p>
          </div>
        )}

        {/* Step 4: Review US/AC */}
        {step === 'review' && (
          <div className="flex-1 min-h-0 space-y-4 overflow-hidden flex flex-col">
            {/* Branch context info */}
            {changedFiles.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm">
                <GitBranch className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="text-muted-foreground">
                  Branch <code className="font-mono text-xs px-1 py-0.5 bg-muted rounded">{branch}</code> has{' '}
                  <strong>{changedFiles.length}</strong> changed files
                </span>
              </div>
            )}

            {/* Generation options */}
            <div className="grid grid-cols-2 gap-3 px-1">
              <div className="space-y-2">
                <Label htmlFor="target-url" className="text-xs">Target URL (optional)</Label>
                <Input
                  id="target-url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex items-end gap-2 pb-0.5">
                <Switch
                  id="use-branch-context"
                  checked={useBranchContext}
                  onCheckedChange={setUseBranchContext}
                />
                <Label htmlFor="use-branch-context" className="text-xs cursor-pointer">
                  Use branch code changes as context
                </Label>
              </div>
            </div>

            {/* Stories list */}
            <div className="flex-1 min-h-0 overflow-y-auto border rounded-lg">
              <div className="divide-y">
                {stories.map((story) => (
                  <div key={story.id} className="p-3">
                    {/* Story header */}
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => toggleStory(story.id)}
                        className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        {expandedStories.has(story.id) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <FolderTree className="h-4 w-4 text-primary flex-shrink-0" />
                          <span className="font-medium text-sm">{story.title}</span>
                          <Badge variant="outline" className="text-xs flex-shrink-0">
                            {story.acceptanceCriteria.length} AC
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 ml-6">{story.description}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 flex-shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeStory(story.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Acceptance Criteria */}
                    {expandedStories.has(story.id) && (
                      <div className="ml-6 mt-2 space-y-1.5">
                        {story.acceptanceCriteria.map((ac) => (
                          <div
                            key={ac.id}
                            className="flex items-start gap-2 pl-3 py-1.5 rounded bg-muted/30 text-sm group"
                          >
                            <FileCode className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              {editingAC === ac.id ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    className="h-6 text-xs"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveEditAC(story.id, ac.id);
                                      if (e.key === 'Escape') setEditingAC(null);
                                    }}
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-1"
                                    onClick={() => saveEditAC(story.id, ac.id)}
                                  >
                                    <Check className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-xs text-primary">
                                      {ac.testName || ac.id}
                                    </span>
                                    {ac.groupedWith && (
                                      <Badge variant="secondary" className="text-[10px] h-4">
                                        grouped
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">{ac.description}</p>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <button
                                className="p-0.5 text-muted-foreground hover:text-foreground"
                                onClick={() => startEditAC(ac.id, ac.testName || '')}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                className="p-0.5 text-muted-foreground hover:text-destructive"
                                onClick={() => removeAC(story.id, ac.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                        <button
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-3 py-1"
                          onClick={() => addACToStory(story.id)}
                        >
                          <Plus className="h-3 w-3" />
                          Add criterion
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Generating */}
        {step === 'generating' && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {isCreatingPlaceholders ? 'Creating placeholder tests...' : 'Generating test scripts...'}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {isCreatingPlaceholders
                ? 'Creating areas and placeholder tests from Acceptance Criteria'
                : <>Creating areas from User Stories and tests from Acceptance Criteria
                    {useBranchContext && changedFiles.length > 0 && (
                      <span> (with branch code context)</span>
                    )}
                  </>
              }
            </p>
          </div>
        )}

        {/* Step 6: Results */}
        {step === 'results' && results && (
          <div className="flex-1 min-h-0 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <FolderTree className="h-8 w-8 mx-auto mb-2 text-primary" />
                <div className="text-2xl font-bold">{results.areasCreated}</div>
                <div className="text-sm text-muted-foreground">Areas Created</div>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <FileCode className="h-8 w-8 mx-auto mb-2 text-primary" />
                <div className="text-2xl font-bold">{results.testsCreated}</div>
                <div className="text-sm text-muted-foreground">
                  {results.usedPlaceholders ? 'Placeholders Created' : 'Tests Generated'}
                </div>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <GitBranch className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <div className="text-2xl font-bold">{changedFiles.length}</div>
                <div className="text-sm text-muted-foreground">Branch Files Used</div>
              </div>
            </div>

            {results.errors.length > 0 && (
              <div className="border border-destructive/50 rounded-lg p-3 space-y-1">
                <p className="text-sm font-medium text-destructive">
                  {results.errors.length} error(s) during generation:
                </p>
                <div className="max-h-24 overflow-y-auto">
                  {results.errors.map((err, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{err}</p>
                  ))}
                </div>
              </div>
            )}

            {/* MCP Validation option */}
            {isLocalhostTarget && results.testsCreated > 0 && (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">MCP Validation</span>
                  <Badge variant="secondary" className="text-xs">Optional</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Validate generated tests against your running localhost server using MCP tools.
                  This will check selectors and fix any issues.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleMCPValidation}
                  disabled={isValidating}
                >
                  {isValidating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  {isValidating ? 'Validating...' : 'Validate with MCP'}
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {step === 'results' ? 'Done' : 'Cancel'}
          </Button>
          {step === 'review' && (
            <>
              <Button
                variant="outline"
                onClick={handleCreatePlaceholders}
                disabled={stories.length === 0 || isGenerating || isCreatingPlaceholders}
              >
                {isCreatingPlaceholders ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileCode className="h-4 w-4 mr-2" />
                )}
                Create as Placeholders
              </Button>
              <Button onClick={handleGenerate} disabled={stories.length === 0 || isGenerating || isCreatingPlaceholders}>
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-2" />
                )}
                Generate {totalAC} Test{totalAC !== 1 ? 's' : ''}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
