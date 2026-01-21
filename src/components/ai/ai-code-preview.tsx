'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, Check, Code } from 'lucide-react';

interface AICodePreviewProps {
  code: string;
  onChange?: (code: string) => void;
  readOnly?: boolean;
  maxHeight?: string;
  showLineNumbers?: boolean;
}

export function AICodePreview({
  code,
  onChange,
  readOnly = false,
  maxHeight = '400px',
  showLineNumbers = true,
}: AICodePreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split('\n');

  return (
    <div className="relative border rounded-lg bg-muted/30">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Code className="h-4 w-4" />
          TypeScript
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 px-2"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
      <ScrollArea style={{ maxHeight }} className="p-0">
        {readOnly ? (
          <div className="flex">
            {showLineNumbers && (
              <div className="flex-shrink-0 py-3 px-3 text-right text-xs text-muted-foreground select-none border-r bg-muted/20">
                {lines.map((_, i) => (
                  <div key={i} className="leading-5">
                    {i + 1}
                  </div>
                ))}
              </div>
            )}
            <pre className="flex-1 py-3 px-4 text-sm overflow-x-auto">
              <code className="font-mono">{code}</code>
            </pre>
          </div>
        ) : (
          <textarea
            value={code}
            onChange={(e) => onChange?.(e.target.value)}
            className="w-full h-full min-h-[200px] p-4 font-mono text-sm bg-transparent resize-none focus:outline-none"
            style={{ minHeight: maxHeight }}
            spellCheck={false}
          />
        )}
      </ScrollArea>
    </div>
  );
}
