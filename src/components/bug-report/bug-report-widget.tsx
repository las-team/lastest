'use client';

import { useState, useTransition, useEffect } from 'react';
import { Bug } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useContextCollector } from '@/components/bug-report/context-collector';
import { submitBugReport } from '@/server/actions/bug-reports';
import type { BugReportSeverity } from '@/lib/db/schema';

export function BugReportWidget() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<BugReportSeverity>('medium');
  const [includeScreenshot, setIncludeScreenshot] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { getSnapshot } = useContextCollector();

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const handleSubmit = () => {
    if (description.trim().length < 10) {
      toast.error('Description must be at least 10 characters.');
      return;
    }

    startTransition(async () => {
      try {
        let screenshotBase64: string | null = null;

        if (includeScreenshot) {
          try {
            const html2canvas = (await import('html2canvas')).default;
            const canvas = await html2canvas(document.body, {
              logging: false,
              useCORS: true,
              scale: 1,
            });
            screenshotBase64 = canvas.toDataURL('image/png').split(',')[1];
          } catch {
            // Screenshot capture failed, continue without it
          }
        }

        const context = getSnapshot();
        const result = await submitBugReport({
          description: description.trim(),
          severity,
          context,
          screenshotBase64,
        });

        if (result.success) {
          toast.success('Bug report submitted. Thank you!');
          setDescription('');
          setSeverity('medium');
          setIncludeScreenshot(false);
          setOpen(false);
        } else {
          toast.error(result.error ?? 'Failed to submit bug report.');
        }
      } catch {
        toast.error('Failed to submit bug report. Please try again.');
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="fixed bottom-4 right-4 z-50 h-10 w-10 rounded-full shadow-lg"
          aria-label="Report a bug"
        >
          <Bug className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[400px] sm:w-[440px] px-6">
        <SheetHeader>
          <SheetTitle>Report a Bug</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bug-description">Description</Label>
            <Textarea
              id="bug-description"
              placeholder="Describe what went wrong... (min 10 characters)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label>Severity</Label>
            <Select
              value={severity}
              onValueChange={(v) => setSeverity(v as BugReportSeverity)}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="include-screenshot"
              checked={includeScreenshot}
              onCheckedChange={(checked) => setIncludeScreenshot(checked === true)}
              disabled={isPending}
            />
            <Label htmlFor="include-screenshot" className="cursor-pointer">
              Include screenshot
            </Label>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={isPending || description.trim().length < 10}
            className="w-full"
          >
            {isPending ? 'Submitting...' : 'Submit Bug Report'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
