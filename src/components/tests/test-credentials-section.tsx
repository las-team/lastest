"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KeyRound, ExternalLink } from "lucide-react";
import { CopyReference } from "@/components/credentials/copy-reference";
import { timeAgo } from "@/lib/utils";
import type { MaskedCredential } from "@/lib/db/queries/credentials";

/**
 * The credentials this repo holds, rendered read-only beside a test's
 * variables.
 *
 * A second *view*, never a second *store*: no `TestVariable` rows are created,
 * nothing is mirrored or synced, and there is no add/edit/delete here. One
 * table, two readers — the other is Setup → Credentials, which this links to.
 *
 * It sits on the Variables tab because that is where a user goes looking for
 * "what values can this test use", and a credential is one of those values —
 * it just reaches the test down a different channel than the variables above
 * it (see docs/credentials-plan.md §1).
 */
export function TestCredentialsSection({
  credentials,
}: {
  credentials: MaskedCredential[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Credentials
          </CardTitle>
          <CardDescription>
            Repo logins, injected into this test as{" "}
            <code className="font-mono text-xs">credentials.*</code>. Values
            never appear in test source or in run history.
          </CardDescription>
        </div>
        <Link
          href="/setup"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
        >
          Manage in Setup
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>
        {credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No credentials for this repo yet. Add one in Setup → Credentials to
            give this test a login it can use.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="text-left py-2 pr-3">Name</th>
                  <th className="text-left py-2 pr-3">Fields</th>
                  <th className="text-left py-2 pr-3">Reference</th>
                  <th className="text-left py-2 pr-3">Last used</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((cred) => (
                  <tr
                    key={cred.id}
                    className="border-b last:border-0 align-top"
                  >
                    <td className="py-2 pr-3">
                      <div className="font-mono">{cred.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {cred.label}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {cred.fields.map((f) => (
                          <Badge
                            key={f.key}
                            variant="secondary"
                            className="font-mono text-xs font-normal"
                          >
                            {f.key}
                            {f.secret && (
                              <span className="ml-1 tracking-widest">••••</span>
                            )}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="space-y-0.5">
                        {cred.fields.map((f) => (
                          <div
                            key={f.key}
                            className="flex items-center gap-1 font-mono text-xs"
                          >
                            <span className="text-muted-foreground">
                              credentials.{cred.name}.{f.key}
                            </span>
                            <CopyReference
                              className="h-6 w-6"
                              reference={`credentials.${cred.name}.${f.key}`}
                            />
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                      {cred.lastUsedAt ? timeAgo(cred.lastUsedAt) : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
