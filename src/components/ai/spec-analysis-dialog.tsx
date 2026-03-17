'use client';

import { useState, useRef } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { discoverRepoSpecs, analyzeSelectedSpecs, analyzeUploadedSpecs, saveSpecAnalysisResult, saveAndBuildTests } from '@/server/actions/spec-analysis';
import type { SpecAnalysisResponse, DiscoveredSpecFile } from '@/server/actions/spec-analysis';
import { Loader2, FileText, Upload, Save, FolderSearch, Route, Sparkles, Check, Square, CheckSquare } from 'lucide-react';
import { toast } from 'sonner';

interface SpecAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryId: string;
  branch: string;
}

export function SpecAnalysisDialog({
  open,
  onOpenChange,
  repositoryId,
  branch,
}: SpecAnalysisDialogProps) {
  const [step, setStep] = useState<'input' | 'file-selection' | 'analyzing' | 'preview'>('input');
  const [_isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<SpecAnalysisResponse['result']>(undefined);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [discoveredFiles, setDiscoveredFiles] = useState<DiscoveredSpecFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGitHubScan = async () => {
    setIsDiscovering(true);
    try {
      const response = await discoverRepoSpecs(repositoryId, branch);
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

  const handleAnalyzeSelected = async () => {
    if (selectedFiles.size === 0) {
      toast.error('Please select at least one file');
      return;
    }

    setIsAnalyzing(true);
    setStep('analyzing');
    try {
      const response = await analyzeSelectedSpecs(repositoryId, branch, Array.from(selectedFiles));
      if (response.success && response.result) {
        setAnalysisResult(response.result);
        setStep('preview');
        const areaCount = response.result.functionalAreas.length;
        const routeCount = response.result.functionalAreas.reduce((sum, a) => sum + a.routes.length, 0);
        toast.success(`Found ${areaCount} areas, ${routeCount} routes`);
      } else {
        toast.error(response.error || 'Failed to analyze specs');
        setStep('file-selection');
      }
    } catch {
      toast.error('Failed to analyze selected specs');
      setStep('file-selection');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleFile = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectAll = () => setSelectedFiles(new Set(discoveredFiles.map(f => f.path)));
  const deselectAll = () => setSelectedFiles(new Set());

  const handleFileUpload = async () => {
    if (uploadedFiles.length === 0) {
      toast.error('Please select files first');
      return;
    }

    setIsAnalyzing(true);
    setStep('analyzing');
    try {
      const formData = new FormData();
      for (const file of uploadedFiles) {
        formData.append('files', file);
      }

      const response = await analyzeUploadedSpecs(formData, repositoryId);
      if (response.success && response.result) {
        setAnalysisResult(response.result);
        setStep('preview');
        const areaCount = response.result.functionalAreas.length;
        const routeCount = response.result.functionalAreas.reduce((sum, a) => sum + a.routes.length, 0);
        toast.success(`Found ${areaCount} areas, ${routeCount} routes`);
      } else {
        toast.error(response.error || 'Failed to analyze files');
        setStep('input');
      }
    } catch {
      toast.error('Failed to analyze uploaded files');
      setStep('input');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!analysisResult) return;

    setIsSaving(true);
    try {
      const result = await saveSpecAnalysisResult(repositoryId, analysisResult);
      if (result.success) {
        toast.success('Saved functional areas and routes');
        handleClose();
      } else {
        toast.error(result.error || 'Failed to save results');
      }
    } catch {
      toast.error('Failed to save results');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndBuild = async () => {
    if (!analysisResult) return;

    setIsBuilding(true);
    try {
      const result = await saveAndBuildTests(repositoryId, analysisResult);
      if (result.success) {
        toast.success(`Saved areas/routes and created ${result.testsCreated} tests`);
        handleClose();
      } else {
        toast.error(result.error || 'Failed to build tests');
      }
    } catch {
      toast.error('Failed to build tests');
    } finally {
      setIsBuilding(false);
    }
  };

  const handleClose = () => {
    setStep('input');
    setAnalysisResult(undefined);
    setUploadedFiles([]);
    setDiscoveredFiles([]);
    setSelectedFiles(new Set());
    onOpenChange(false);
  };

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setUploadedFiles(Array.from(e.target.files));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => v ? onOpenChange(true) : handleClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Analyze Specifications
          </DialogTitle>
          <DialogDescription>
            {step === 'input' && 'Extract functional areas, routes, and test scenarios from spec documents.'}
            {step === 'file-selection' && 'Select which spec files to analyze.'}
            {step === 'analyzing' && 'Analyzing specification content...'}
            {step === 'preview' && 'Review extracted areas and routes before saving.'}
          </DialogDescription>
        </DialogHeader>

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
                  for spec files in <code className="text-xs">docs/</code>, <code className="text-xs">specs/</code>,
                  and common spec filenames.
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
                  Upload specification files (.md, .txt, .pdf)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md,.txt,.pdf"
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
                    <Button onClick={handleFileUpload} className="w-full mt-2">
                      <FileText className="h-4 w-4 mr-2" />
                      Analyze Files
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {step === 'file-selection' && (
          <div className="flex-1 min-h-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {selectedFiles.size} of {discoveredFiles.length} file(s) selected
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  <CheckSquare className="h-4 w-4 mr-1" />
                  Select All
                </Button>
                <Button variant="ghost" size="sm" onClick={deselectAll}>
                  <Square className="h-4 w-4 mr-1" />
                  Deselect All
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
              <Button onClick={handleAnalyzeSelected} disabled={selectedFiles.size === 0}>
                <Sparkles className="h-4 w-4 mr-2" />
                Analyze Selected
              </Button>
            </div>
          </div>
        )}

        {step === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Analyzing specifications...</p>
            <p className="text-xs text-muted-foreground mt-2">
              Extracting functional areas, routes, and test scenarios
            </p>
          </div>
        )}

        {step === 'preview' && analysisResult && (
          <div className="flex-1 min-h-0 max-h-[55vh] overflow-y-auto border rounded-lg">
            <div className="space-y-4 p-3">
              {analysisResult.functionalAreas.map((area, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{area.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {area.routes.length} route{area.routes.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  {area.description && (
                    <p className="text-xs text-muted-foreground">{area.description}</p>
                  )}
                  <div className="space-y-1 ml-2">
                    {area.routes.map((route, j) => {
                      const scenarios = analysisResult.testScenarios.find(s => s.route === route.path);
                      return (
                        <div key={j} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Route className="h-3 w-3 text-muted-foreground" />
                            <code className="text-xs font-mono">{route.path}</code>
                            <Badge variant={route.type === 'static' ? 'default' : 'secondary'} className="text-xs">
                              {route.type}
                            </Badge>
                          </div>
                          {scenarios && scenarios.suggestions.length > 0 && (
                            <div className="flex flex-wrap gap-1 ml-5">
                              {scenarios.suggestions.slice(0, 3).map((s, k) => (
                                <span key={k} className="text-xs bg-muted px-2 py-0.5 rounded">{s}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={handleSave} disabled={isSaving || isBuilding}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Only
              </Button>
              <Button onClick={handleSaveAndBuild} disabled={isSaving || isBuilding}>
                {isBuilding ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {isBuilding ? 'Building Tests...' : 'Save & Build Tests'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
