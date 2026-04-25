'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { extractUserStoriesFromUpload } from '@/server/actions/spec-import';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

interface SpecPanelProps {
  repositoryId: string | undefined;
  defaultBranch?: string;
}

const ACCEPTED_TYPES = ['.md', '.txt', '.pdf', '.docx'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function SpecPanel({ repositoryId, defaultBranch = 'main' }: SpecPanelProps) {
  const router = useRouter();
  const [pastedText, setPastedText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    const lower = file.name.toLowerCase();
    if (!ACCEPTED_TYPES.some((ext) => lower.endsWith(ext))) {
      return `Unsupported file type: ${file.name}. Use .md, .txt, .pdf, or .docx.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `${file.name} exceeds 10MB limit.`;
    }
    return null;
  };

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const next: File[] = [];
    for (const file of Array.from(incoming)) {
      const err = validateFile(file);
      if (err) {
        toast.error(err);
        continue;
      }
      next.push(file);
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

  const fileToBase64 = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  const handleSubmit = async () => {
    if (!repositoryId) {
      toast.error('Select a repository first');
      return;
    }

    const hasPaste = pastedText.trim().length > 0;
    if (!hasPaste && files.length === 0) {
      toast.error('Paste a spec or drop a file');
      return;
    }

    setIsSubmitting(true);
    try {
      const encoded = await Promise.all(
        files.map(async (file) => ({ name: file.name, content: await fileToBase64(file) })),
      );

      if (hasPaste) {
        encoded.push({
          name: 'pasted-spec.md',
          content: btoa(unescape(encodeURIComponent(pastedText))),
        });
      }

      const response = await extractUserStoriesFromUpload(encoded, repositoryId, defaultBranch);
      if (response.success) {
        toast.success('Spec import started — extraction runs in the background');
        router.push('/home');
      } else {
        toast.error(response.error || 'Failed to start spec import');
      }
    } catch {
      toast.error('Failed to start spec import');
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
              <FileText className="h-5 w-5" />
              Spec-driven Agent
            </CardTitle>
            <CardDescription>
              Paste user stories / acceptance criteria, or drop spec documents. The agent extracts
              US/AC and generates one test per acceptance criterion in the background.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="spec-paste">Paste spec text</Label>
              <Textarea
                id="spec-paste"
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={'## User Story\nAs a user, I want to...\n\n### Acceptance Criteria\n- [ ] AC-1: ...'}
                rows={8}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label>Or upload files</Label>
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
                  .md, .txt, .pdf, .docx — up to 10MB each
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".md,.txt,.pdf,.docx"
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
                      <span className="truncate">
                        {file.name}{' '}
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
                  (pastedText.trim().length === 0 && files.length === 0)
                }
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                Generate tests from spec
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
