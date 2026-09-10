/**
 * Who can see and run a migration.
 *
 * Two gates, and they are different things:
 *
 *  - **Early Adopter mode** (`teams.earlyAdopterMode`) decides whether the
 *    feature EXISTS for a team. It is merchandising plus a blast radius: this
 *    surface writes to a customer's production Vault, and it ships to the
 *    teams that opted into unfinished things first. Same switch the Compose /
 *    Compare / Impact nav items use (`components/layout/sidebar.tsx`).
 *  - **`repos:settings`** decides whether a MEMBER may operate it. A migration
 *    reads the same connectors and credentials the Integrations tab owns, so
 *    it carries that tab's capability rather than inventing one — anyone who
 *    could not be trusted with the Vault password should not be able to start
 *    an upsert into that Vault.
 *
 * Unlike the sidebar's nav filtering, this one IS access control: the page and
 * every action call it, so an early-adopter-off team cannot reach the console
 * by typing the URL.
 */

import type { Team } from "@/lib/db/schema";

export function hasMigrationAccess(team: Team | null | undefined): boolean {
  return Boolean(team?.earlyAdopterMode);
}

export const MIGRATION_LOCKED_MESSAGE =
  "Migrations are an Early Adopter feature. Switch on Early Adopter mode under Settings to enable it for your team.";
