import Link from 'next/link';
import { FileQuestion, Home } from 'lucide-react';

export default function TestNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
      <div className="text-center space-y-4">
        <FileQuestion className="w-16 h-16 text-gray-400 mx-auto" />
        <h1 className="text-2xl font-bold">Test not found</h1>
        <p className="text-gray-500 max-w-md">
          This test may have been deleted or the URL might be incorrect.
        </p>
        <div className="pt-4">
          <Link
            href="/tests"
            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Home className="w-4 h-4" />
            View All Tests
          </Link>
        </div>
      </div>
    </div>
  );
}
