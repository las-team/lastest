"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentExperience } from "@/lib/db/schema";
import { Brain } from "lucide-react";

/** Read-only view of what the explorer has learned per page state. */
export function ExperienceViewer({ rows }: { rows: AgentExperience[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4" />
          Experience
          <span className="text-xs font-normal text-muted-foreground">
            what the explorer learned by doing — reused on every run
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing learned yet. After a run, per-page notes (what worked, what
            failed) accumulate here and make the next run smarter.
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="rounded-md border p-3 space-y-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">
                  {row.normalizedUrl}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  visited {row.timesVisited}×
                </Badge>
              </div>
              {row.headingsDigest && (
                <p className="text-[11px] text-muted-foreground/70 truncate">
                  {row.headingsDigest}
                </p>
              )}
              {row.notes.length > 0 && (
                <ul className="space-y-0.5">
                  {row.notes.slice(-6).map((note, i) => (
                    <li key={i} className="text-xs flex items-start gap-1.5">
                      <Badge
                        variant="outline"
                        className="text-[9px] shrink-0 mt-0.5"
                      >
                        {note.kind}
                      </Badge>
                      <span className="text-muted-foreground break-words">
                        {note.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
