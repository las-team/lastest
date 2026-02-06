import Link from 'next/link';
import { FileQuestion, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function BuildNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
      <div className="text-center space-y-4">
        <FileQuestion className="w-16 h-16 text-muted-foreground/50 mx-auto" />
        <h1 className="text-2xl font-bold">Build not found</h1>
        <p className="text-muted-foreground max-w-md">
          This build may have been deleted or the URL might be incorrect.
        </p>
        <div className="pt-4">
          <Button asChild>
            <Link href="/builds">
              <Home className="w-4 h-4" />
              View All Builds
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
