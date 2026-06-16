"use client";

import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Webhook } from "lucide-react";
import type { FunctionalArea } from "@/lib/db/schema";
import { ApiTestForm } from "@/components/api-tests/api-test-form";

interface ApiTestPanelProps {
  repositoryId: string | undefined;
  areas: FunctionalArea[];
}

export function ApiTestPanel({ repositoryId, areas }: ApiTestPanelProps) {
  const router = useRouter();

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              New API test
            </CardTitle>
            <CardDescription>
              A headless HTTP request graded against response assertions — no
              browser. Runs in the same build pipeline as browser tests.
              Optionally turn it into a load test with concurrency and latency /
              error thresholds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {repositoryId ? (
              <ApiTestForm
                repositoryId={repositoryId}
                areas={areas}
                onSaved={(id) => router.push(`/tests?test=${id}`)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a repository first to create an API test.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
