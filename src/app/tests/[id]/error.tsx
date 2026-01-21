'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

export default function TestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Test page error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
      <div className="text-center space-y-4">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto" />
        <h1 className="text-2xl font-bold">Failed to load test</h1>
        <p className="text-gray-500 max-w-md">
          There was an error loading this test. The test may have been deleted
          or there might be a temporary issue.
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-4 pt-4">
          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          <Link
            href="/tests"
            className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            <Home className="w-4 h-4" />
            All Tests
          </Link>
        </div>
      </div>
    </div>
  );
}
