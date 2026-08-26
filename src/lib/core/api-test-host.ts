import "server-only";

import type {
  ApiTestHost,
  ApiTestRef,
  CreateApiTestInput,
  GuardedRequest,
  GuardedResponse,
  UpdateApiTestInput,
} from "@lastest/plugin-api-test/host";
import { renderApiDefinitionForCode } from "@lastest/plugin-api-test/redact";

import { gatherCodebaseIntelligence } from "@/lib/ai";
import { requireRepoCapability } from "@/lib/auth";
import { requireTestOwnership } from "@/lib/auth/ownership";
import * as queries from "@/lib/db/queries";
import {
  assertSafeOutboundUrl,
  createSsrfSafeDispatcher,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";

/**
 * The app's fill for `ApiTestHost`.
 *
 * Five methods; `plugins/api-test/src/host.ts` explains why each one exists and
 * what would retire it. What is worth reading *here* is the two places this
 * file does more than pass a call through, because both are the boundary
 * working rather than paperwork:
 *
 * **1. `fetchGuarded` is where the SSRF guard became unskippable.** The
 * pre-plugin `src/lib/api-test/runner.ts` called `assertSafeOutboundUrl`
 * itself, behind a `skipSsrfCheck` flag, and separately attached the
 * connect-time dispatcher. Feature code owning both halves of a security
 * control is exactly what `core-scope.md` §2 says core is for. Now the plugin
 * hands over a URL and gets a response; it has no dispatcher, no guard and no
 * `fetch`.
 *
 * (The `skipSsrfCheck` opt-out is gone. It had no callers — its doc comment
 * pointed at a "load runner" that does not exist — so removing it changes no
 * behaviour, and keeping an unused way to disable an SSRF check while moving
 * that check into core would have been a strange thing to preserve.)
 *
 * **2. `createTest` / `updateTest` carry the authorization *and* the
 * redaction.** `requireRepoCapability(…, "tests:write")` and
 * `requireTestOwnership` ran in the old server actions; they run here now,
 * immediately before the write, where the plugin cannot forget them. And the
 * `code` column — human-visible, snapshotted into `test_versions` — is rendered
 * *by this file* from the definition, rather than accepted as a string from the
 * caller. The plugin owns the redaction logic (it is knowledge about `ApiAuth`,
 * its own type); core owns the decision to apply it. A plugin that could choose
 * what lands in `tests.code` could choose to put a live bearer token there.
 */

/** Lowercase a `Headers` into the plain map the plugin's evaluator reads. */
function toHeaderMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

export const appApiTestHost: ApiTestHost = {
  async fetchGuarded(
    url: string,
    req: GuardedRequest,
  ): Promise<GuardedResponse> {
    try {
      await assertSafeOutboundUrl(url);
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof SsrfBlockedError
            ? `Blocked by SSRF guard: ${e.message}`
            : String(e),
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const response = await fetch(url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
        // Re-validate the resolved IP at connect time to defend against
        // DNS-rebinding between the pre-flight check above and the fetch.
        dispatcher: await createSsrfSafeDispatcher(),
      } as RequestInit & { dispatcher: unknown });
      return {
        ok: true,
        status: response.status,
        headers: toHeaderMap(response.headers),
        text: await response.text(),
      };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return {
        ok: false,
        error: aborted
          ? `Request timed out after ${req.timeoutMs}ms`
          : e instanceof Error
            ? e.message
            : String(e),
      };
    } finally {
      clearTimeout(timer);
    }
  },

  async createTest(input: CreateApiTestInput): Promise<ApiTestRef> {
    await requireRepoCapability(input.repositoryId, "tests:write");
    const created = await queries.createTest({
      repositoryId: input.repositoryId,
      name: input.name,
      code: renderApiDefinitionForCode(input.definition),
      testType: "api",
      apiDefinition: input.definition,
      targetUrl: input.definition.url,
      functionalAreaId: input.functionalAreaId ?? null,
    });
    return { id: created.id };
  },

  async updateTest(id: string, input: UpdateApiTestInput): Promise<void> {
    await requireTestOwnership(id);
    await queries.updateTestWithVersion(
      id,
      {
        ...(input.name ? { name: input.name.trim() } : {}),
        code: renderApiDefinitionForCode(input.definition),
        testType: "api",
        apiDefinition: input.definition,
        targetUrl: input.definition.url,
      },
      "manual_edit",
    );
  },

  async aiSupportsJson(repositoryId: string): Promise<boolean> {
    const settings = await queries.getAISettings(repositoryId);
    return settings.provider !== "claude-cli";
  },

  async apiLayerHint(repositoryId: string): Promise<string | null> {
    try {
      const repo = await queries.getRepository(repositoryId);
      if (repo?.provider !== "github" || !repo.teamId) return null;
      const account = await queries.getGithubAccountByTeam(repo.teamId);
      if (!account?.accessToken) return null;
      const intel = await gatherCodebaseIntelligence(
        account.accessToken,
        repo.owner,
        repo.name,
        repo.defaultBranch || "main",
      );
      return `Detected API layer: ${intel.apiLayer}.`;
    } catch {
      // Non-critical: a missing hint degrades the prompt, it does not fail the
      // request. Same swallow the pre-plugin generator had inline.
      return null;
    }
  },
};
