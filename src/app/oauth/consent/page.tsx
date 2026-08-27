/**
 * OAuth consent screen for the remote MCP endpoint.
 *
 * Reached from `/api/auth/mcp/authorize` when a client asks for consent. The
 * authorization server has already established who the user is by this point;
 * this page's job is to name the client, spell out what the requested scopes
 * actually let it do in Lastest, and turn an approval into a POST to
 * `/api/auth/oauth2/consent`.
 *
 * The scope descriptions are written in terms of *consequences* rather than
 * scope strings, and they say plainly what stays out of reach: no deletes, no
 * revoking shares, no publishing anything publicly. That is the truth enforced
 * by the tool policy (`@lastest/mcp-server`'s `policy.ts`), not a reassurance —
 * those tools are never registered for an OAuth caller.
 */
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { getOAuthApplicationByClientId } from "@/lib/db/queries";
import { MCP_WRITE_SCOPE, parseScopes } from "@/lib/mcp/tool-policy";
import { ConsentClient } from "./consent-client";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function McpConsentPage({ searchParams }: Props) {
  const sp = await searchParams;
  const consentCode = first(sp.consent_code);
  const clientId = first(sp.client_id);
  const scope = first(sp.scope);

  const session = await getCurrentSession();
  if (!session?.user) {
    // Defensive only: the authorization endpoint bounces through /login before
    // it ever redirects here, so an unauthenticated visitor means someone
    // opened the link out of order.
    const back = new URLSearchParams({
      consent_code: consentCode,
      client_id: clientId,
      scope,
    });
    const target = `/oauth/consent?${back.toString()}`;
    redirect(`/login?returnTo=${encodeURIComponent(target)}`);
  }

  if (!consentCode || !clientId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <h1 className="text-lg font-semibold">Invalid authorization request</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This link is missing its authorization code. Start the connection
          again from the app you were connecting.
        </p>
      </main>
    );
  }

  const app = await getOAuthApplicationByClientId(clientId);
  const scopes = parseScopes(scope);
  const canWrite = scopes.includes(MCP_WRITE_SCOPE);

  return (
    <ConsentClient
      consentCode={consentCode}
      clientName={app?.name || "An unnamed application"}
      // Dynamic client registration means anyone can pick a name. Showing the
      // client id alongside it is the only thing that distinguishes a genuine
      // "Salesforce Agentforce" from something that typed the same name in.
      clientId={clientId}
      registered={Boolean(app)}
      canWrite={canWrite}
      userEmail={session.user.email}
      teamName={session.team?.name ?? null}
    />
  );
}
