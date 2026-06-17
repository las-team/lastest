import { describe, it, expect } from "vitest";
import { networkRequestToApiTest } from "./from-network";
import type { NetworkRequest } from "@/lib/db/schema";

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    url: "https://api.example.com/v1/users/42",
    method: "GET",
    status: 200,
    duration: 12,
    resourceType: "fetch",
    ...over,
  };
}

describe("networkRequestToApiTest", () => {
  it("maps a basic GET and derives the name from the path", () => {
    const { name, definition } = networkRequestToApiTest(req());
    expect(definition.method).toBe("GET");
    expect(definition.url).toBe("https://api.example.com/v1/users/42");
    expect(name).toBe("GET /v1/users/42");
    expect(definition.body).toBeUndefined();
    expect(definition.assertions).toEqual([{ kind: "status", equals: 200 }]);
  });

  it("parses a JSON post body for non-GET requests", () => {
    const { definition } = networkRequestToApiTest(
      req({
        method: "POST",
        status: 201,
        postData: '{"name":"Ada","age":36}',
      }),
    );
    expect(definition.method).toBe("POST");
    expect(definition.body).toEqual({ name: "Ada", age: 36 });
    expect(definition.assertions).toEqual([{ kind: "status", equals: 201 }]);
  });

  it("keeps a non-JSON post body as a raw string", () => {
    const { definition } = networkRequestToApiTest(
      req({ method: "POST", postData: "name=Ada&age=36" }),
    );
    expect(definition.body).toBe("name=Ada&age=36");
  });

  it("does not attach a body to GET requests", () => {
    const { definition } = networkRequestToApiTest(
      req({ method: "GET", postData: "ignored" }),
    );
    expect(definition.body).toBeUndefined();
  });

  it("promotes a Bearer Authorization header to typed auth and drops the header", () => {
    const { definition } = networkRequestToApiTest(
      req({ requestHeaders: { Authorization: "Bearer abc.def.ghi" } }),
    );
    expect(definition.auth).toEqual({ type: "bearer", token: "abc.def.ghi" });
    expect(definition.headers).toBeUndefined();
  });

  it("decodes a Basic Authorization header into username/password", () => {
    // base64("ada:secret")
    const b64 = Buffer.from("ada:secret").toString("base64");
    const { definition } = networkRequestToApiTest(
      req({ requestHeaders: { authorization: `Basic ${b64}` } }),
    );
    expect(definition.auth).toEqual({
      type: "basic",
      username: "ada",
      password: "secret",
    });
  });

  it("keeps an unrecognised Authorization scheme as a plain header", () => {
    const { definition } = networkRequestToApiTest(
      req({ requestHeaders: { Authorization: "Negotiate xyz" } }),
    );
    expect(definition.auth).toBeUndefined();
    expect(definition.headers).toEqual({ Authorization: "Negotiate xyz" });
  });

  it("skips pseudo + volatile headers but retains cookie and api-key", () => {
    const { definition } = networkRequestToApiTest(
      req({
        requestHeaders: {
          ":method": "GET",
          ":path": "/v1/users/42",
          host: "api.example.com",
          "content-length": "0",
          "accept-encoding": "gzip",
          cookie: "session=xyz",
          "x-api-key": "k_123",
          accept: "application/json",
        },
      }),
    );
    expect(definition.headers).toEqual({
      cookie: "session=xyz",
      "x-api-key": "k_123",
      accept: "application/json",
    });
  });

  it("falls back to in:[200] for failed requests", () => {
    const { definition } = networkRequestToApiTest(
      req({ failed: true, status: 0 }),
    );
    expect(definition.assertions).toEqual([{ kind: "status", in: [200] }]);
  });

  it("falls back to in:[200] for 4xx/5xx responses", () => {
    const { definition } = networkRequestToApiTest(req({ status: 500 }));
    expect(definition.assertions).toEqual([{ kind: "status", in: [200] }]);
  });

  it("seeds jsonPath assertions from a JSON object response body", () => {
    const { definition } = networkRequestToApiTest(
      req({
        status: 200,
        responseBody: '{"success":true,"token":"abc","userId":42}',
      }),
    );
    expect(definition.assertions).toEqual([
      { kind: "status", equals: 200 },
      // booleans get a pinned value; everything else is a presence check.
      { kind: "jsonPath", path: "success", value: true },
      { kind: "jsonPath", path: "token" },
      { kind: "jsonPath", path: "userId" },
    ]);
  });

  it("derives no body assertions for a non-JSON response body", () => {
    const { definition } = networkRequestToApiTest(
      req({ status: 200, responseBody: "<html>ok</html>" }),
    );
    expect(definition.assertions).toEqual([{ kind: "status", equals: 200 }]);
  });

  it("derives no body assertions for an array-root response body", () => {
    const { definition } = networkRequestToApiTest(
      req({ status: 200, responseBody: "[1,2,3]" }),
    );
    expect(definition.assertions).toEqual([{ kind: "status", equals: 200 }]);
  });

  it("caps body assertions at 6 fields", () => {
    const big = JSON.stringify(
      Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, i])),
    );
    const { definition } = networkRequestToApiTest(
      req({ status: 200, responseBody: big }),
    );
    // 1 status + 6 jsonPath
    expect(definition.assertions).toHaveLength(7);
  });

  it("coerces an unsupported method to GET", () => {
    const { definition } = networkRequestToApiTest(req({ method: "HEAD" }));
    expect(definition.method).toBe("GET");
  });

  it("uppercases lowercase methods", () => {
    const { definition } = networkRequestToApiTest(req({ method: "post" }));
    expect(definition.method).toBe("POST");
  });
});
