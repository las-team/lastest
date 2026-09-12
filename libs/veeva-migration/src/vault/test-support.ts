/**
 * Shared scaffolding for the vault tests: a client wired to `mockFetch`, a
 * recorded `sleep`, a controllable clock and a silent logger.
 */
import pino from "pino";
import {
  createVaultClient,
  type VaultClientConfig,
  type VaultClientImpl,
} from "./client";
import {
  authBody,
  meBody,
  mockFetch,
  type MockFetch,
  type MockRoute,
} from "./fetch-mock";

export const DNS = "acme-crm.veevavault.com";
export const API = "/api/v26.2";

export interface TestClock {
  now: () => number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function makeClock(start = Date.UTC(2026, 8, 7, 12, 0, 0)): TestClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}

export interface TestClient {
  client: VaultClientImpl;
  fetch: MockFetch;
  /** Every `sleep(ms)` the client requested, in order. */
  sleeps: number[];
  clock: TestClock;
}

export const silentLogger = pino({ level: "silent" }).child({ scope: "Vault" });

/** Build a client against `routes`. Sleeps are recorded and advance the clock instead of waiting. */
export function makeTestClient(
  routes: MockRoute[] = [],
  overrides: Partial<VaultClientConfig> = {},
): TestClient {
  const fetch = mockFetch(routes);
  const sleeps: number[] = [];
  const clock = makeClock();
  const client = createVaultClient({
    vaultDns: DNS,
    auth: { kind: "password", username: "migration@acme.com", password: "pw" },
    clientId: "acme-crm-veeva-migration-client-test",
    fetch: fetch.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
    random: () => 0.5,
    now: clock.now,
    logger: silentLogger,
    ...overrides,
  });
  return { client, fetch, sleeps, clock };
}

/** The routes every authenticated test needs: `POST /auth` (persistent). */
export function authRoutes(dns = DNS): MockRoute[] {
  return [
    { method: "POST", path: `${API}/auth`, body: authBody(dns), persist: true },
    {
      method: "GET",
      path: `${API}/objects/users/me`,
      body: meBody(),
      persist: true,
    },
  ];
}

export function failureBody(type: string, message = `${type} happened`) {
  return { responseStatus: "FAILURE", errors: [{ type, message }] };
}
