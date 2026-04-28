import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';

export function StatusBadge({ status }: { status: string | null }) {
  if (status === 'passed') {
    return (
      <Badge className="bg-success/10 text-success border-success/20 hover:bg-success/20">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Passed
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge className="bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20">
        <XCircle className="h-3 w-3 mr-1" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Clock className="h-3 w-3 mr-1" />
      Not run
    </Badge>
  );
}
