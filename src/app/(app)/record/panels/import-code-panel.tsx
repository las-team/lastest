'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Code2, FileCode2, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import type { FunctionalArea } from '@/lib/db/schema';
import { createTestFromCode } from '@/server/actions/test-import';

interface ImportCodePanelProps {
  repositoryId: string | undefined;
  areas: FunctionalArea[];
  defaultBaseUrl: string;
}

const ACCEPTED_EXTS = ['.ts', '.spec.ts', '.test.ts', '.tsx', '.js', '.spec.js', '.test.js'];
const MAX_FILE_SIZE = 500 * 1024; // 500KB

interface PendingFile {
  name: string;
  code: string;
  size: number;
}

export function ImportCodePanel({ repositoryId, areas, defaultBaseUrl }: ImportCodePanelProps) {
  const router = useRouter();
  const [pastedCode, setPastedCode] = useState('');
  const [pastedName, setPastedName] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [functionalAreaId, setFunctionalAreaId] = useState<string>('');
  const [targetUrl, setTargetUrl] = useState(defaultBaseUrl || '');
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    const lower = file.name.toLowerCase();
    if (!ACCEPTED_EXTS.some((ext) => lower.endsWith(ext))) {
      return `Unsupported file: ${file.name}. Use .ts/.spec.ts/.tsx/.js.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `${file.name} exceeds 500KB limit.`;
    }
    return null;
  };

  const addFiles = useCallback(async (incoming: FileList | File[]) => {
    const next: PendingFile[] = [];
    for (const file of Array.from(incoming)) {
      const err = validateFile(file);
      if (err) {
        toast.error(err);
        continue;
      }
      const code = await file.text();
      next.push({ name: file.name, code, size: file.size });
    }
    if (next.length > 0) setFiles((prev) => [...prev, ...next]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const stripExt = (name: string): string => name.replace(/\.(spec|test)?\.?(ts|tsx|js)$/i, '');

  const handleSubmit = async () => {
    if (!repositoryId) {
      toast.error('Select a repository first');
      return;
    }

    const trimmedPaste = pastedCode.trim();
    const hasPaste = trimmedPaste.length > 0;
    if (!hasPaste && files.length === 0) {
      toast.error('Paste code or drop a file');
      return;
    }

    setIsSubmitting(true);
    let created = 0;
    let firstId: string | undefined;
    const errors: string[] = [];

    try {
      const areaArg =
        functionalAreaId && functionalAreaId !== '__none__' ? functionalAreaId : null;
      const urlArg = targetUrl.trim() || null;

      if (hasPaste) {
        const name = pastedName.trim() || 'Imported test';
        const result = await createTestFromCode({
          repositoryId,
          name,
          code: trimmedPaste,
          functionalAreaId: areaArg,
          targetUrl: urlArg,
        });
        if (result.success) {
          created++;
          firstId = firstId ?? result.testId;
        } else {
          errors.push(result.error || `Failed: ${name}`);
        }
      }

      for (const file of files) {
        const result = await createTestFromCode({
          repositoryId,
          name: stripExt(file.name) || file.name,
          code: file.code,
          functionalAreaId: areaArg,
          targetUrl: urlArg,
        });
        if (result.success) {
          created++;
          firstId = firstId ?? result.testId;
        } else {
          errors.push(result.error || `Failed: ${file.name}`);
        }
      }

      if (created > 0) {
        toast.success(`Imported ${created} test${created === 1 ? '' : 's'}`);
        if (errors.length > 0) toast.error(errors.join('\n'));
        if (firstId && created === 1) {
          router.push(`/tests/${firstId}`);
        } else {
          router.push('/tests');
        }
      } else {
        toast.error(errors[0] || 'No tests were imported');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code2 className="h-5 w-5" />
              Import code
            </CardTitle>
            <CardDescription>
              Paste a Playwright test or drop existing <code>.spec.ts</code> files. Each file
              becomes one test. Expected signature:{' '}
              <code>test(page, baseUrl, screenshotPath, stepLogger)</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {areas.length > 0 && (
                <div className="space-y-2">
                  <Label>Functional area</Label>
                  <Select value={functionalAreaId} onValueChange={setFunctionalAreaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select area (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {areas.map((area) => (
                        <SelectItem key={area.id} value={area.id}>
                          {area.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="import-url">Target URL (optional)</Label>
                <Input
                  id="import-url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://app.example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="paste-name">Test name (for pasted code)</Label>
              <Input
                id="paste-name"
                value={pastedName}
                onChange={(e) => setPastedName(e.target.value)}
                placeholder="e.g., Login flow"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="paste-code">Paste code</Label>
              <Textarea
                id="paste-code"
                value={pastedCode}
                onChange={(e) => setPastedCode(e.target.value)}
                placeholder="export async function test(page, baseUrl, screenshotPath, stepLogger) { ... }"
                rows={10}
                className="font-mono text-xs"
              />
              {pastedCode.trim().length > 0 && !/page\./.test(pastedCode) && (
                <p className="text-xs text-amber-600">
                  Heads up: pasted code doesn&apos;t reference <code>page.</code> — verify it&apos;s
                  a valid Playwright test before running.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Or drop / browse files</Label>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
                }`}
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drag and drop, or click to browse
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  .ts, .spec.ts, .tsx, .js — up to 500KB each
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".ts,.spec.ts,.test.ts,.tsx,.js,.spec.js,.test.js"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </div>

              {files.length > 0 && (
                <ul className="space-y-1">
                  {files.map((file, idx) => (
                    <li
                      key={`${file.name}-${idx}`}
                      className="flex items-center justify-between text-sm bg-muted/30 rounded px-3 py-1.5"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <FileCode2 className="w-4 h-4 text-muted-foreground" />
                        <span className="truncate">{file.name}</span>
                        <span className="text-muted-foreground text-xs">
                          ({(file.size / 1024).toFixed(1)} KB)
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(idx);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSubmit}
                disabled={
                  isSubmitting ||
                  !repositoryId ||
                  (pastedCode.trim().length === 0 && files.length === 0)
                }
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Code2 className="h-4 w-4 mr-2" />
                )}
                Import test{files.length + (pastedCode.trim() ? 1 : 0) > 1 ? 's' : ''}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
