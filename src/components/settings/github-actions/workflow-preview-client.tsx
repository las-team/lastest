'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateWorkflowYaml, type WorkflowConfig } from '@/lib/github/workflow-yaml';

interface WorkflowPreviewProps {
  config: WorkflowConfig;
}

export function WorkflowPreview({ config }: WorkflowPreviewProps) {
  const [copied, setCopied] = useState(false);
  const yaml = generateWorkflowYaml(config);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10">
        <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 px-2">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="bg-muted rounded-md p-4 text-xs overflow-auto h-full max-h-[60vh]">
        <code>{yaml}</code>
      </pre>
    </div>
  );
}
