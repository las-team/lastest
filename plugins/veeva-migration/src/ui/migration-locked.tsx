import Link from "next/link";
import { FlaskConical, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@lastest/ui";
import { MIGRATION_LOCKED_MESSAGE } from "../index";

/**
 * What a team without Early Adopter mode sees at `/migrations`.
 *
 * A locked screen, not a 404: the destination is real and the switch that
 * opens it is one click away, so hiding its existence would just make the
 * feature undiscoverable for the people it is aimed at.
 */
export function MigrationLocked() {
  return (
    <div className="p-6 max-w-2xl">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FlaskConical className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Migrations
              </h1>
              <p className="text-xs text-muted-foreground">
                Veeva CRM → Vault CRM · Early Adopter
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {MIGRATION_LOCKED_MESSAGE}
          </p>
          <Link
            href="/settings#features"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Open Settings
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
