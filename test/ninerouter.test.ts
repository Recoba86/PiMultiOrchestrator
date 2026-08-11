import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  CatalogCacheStore,
  EnvSecretResolver,
  NINEROUTER_GATEWAY_ID,
  NineRouterClient,
  NineRouterError,
  normalizeNineRouterBaseUrl,
  stableRouteId,
} from "../src/core/ninerouter/index.js";

const model = (id: string): Record<string, unknown> => ({ id, name: id, capabilities: ["chat"] });

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("9Router domain primitives", () => {
  it("[U][fixture-v1] normalizes local gateway URLs and emits schema-safe deterministic route IDs", () => {
    assert.equal(normalizeNineRouterBaseUrl("http://127.0.0.1:3000/v1///"), "http://127.0.0.1:3000/v1");
    assert.equal(normalizeNineRouterBaseUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000/v1");
    assert.throws(() => normalizeNineRouterBaseUrl("http://127.0.0.1:3000/api"), /\/v1/u);
    assert.throws(() => normalizeNineRouterBaseUrl("http://example.test/v1"), /HTTPS/u);
    const first = stableRouteId(NINEROUTER_GATEWAY_ID, "provider/model-a");
    assert.equal(first, stableRouteId(NINEROUTER_GATEWAY_ID, "provider/model-a"));
    assert.notEqual(first, stableRouteId(NINEROUTER_GATEWAY_ID, "provider/model-b"));
    assert.match(first, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
    assert.ok(first.length <= 64);
  });

  it("[U][fixture-v1] keeps env-only secret failures typed and free of secret material", async () => {
    const resolver = new EnvSecretResolver({ NINEROUTER_TEST_SENTINEL: "synthetic-value" });
    assert.equal(await resolver.resolve("env:NINEROUTER_TEST_SENTINEL"), "synthetic-value");
    await assert.rejects(() => resolver.resolve("env:MISSING_SENTINEL"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, "missing");
      assert.doesNotMatch(error.message, /synthetic-value|MISSING_SENTINEL/u);
      return true;
    });
    await assert.rejects(() => resolver.resolve({ store: "keychain", key: "x" }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "unsupported-store");
      return true;
    });
  });

  it("[U][fixture-v1] classifies malformed, duplicate, auth, cancellation, and timeout responses", async () => {
    const malformed = new NineRouterClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: async () => jsonResponse({ nope: true }) });
    await assert.rejects(() => malformed.listModels(), (error: unknown) => error instanceof NineRouterError && error.kind === "malformed");

    const duplicate = new NineRouterClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: async () => jsonResponse({ data: [model("same"), model("same")] }) });
    await assert.rejects(() => duplicate.listModels(), (error: unknown) => error instanceof NineRouterError && error.kind === "duplicate");

    const auth = new NineRouterClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: async () => jsonResponse({}, 401) });
    await assert.rejects(() => auth.listModels(), (error: unknown) => error instanceof NineRouterError && error.kind === "auth");

    const http = new NineRouterClient({ baseUrl: "http://127.0.0.1:3000", fetchImpl: async () => jsonResponse({}, 500) });
    await assert.rejects(() => http.listModels(), (error: unknown) => error instanceof NineRouterError && error.kind === "http" && error.status === 500);

    const conservative = new NineRouterClient({
      baseUrl: "http://127.0.0.1:3000",
      fetchImpl: async () => jsonResponse({ data: [{ id: "embedding-only", type: "embedding" }] }),
    });
    const [entry] = await conservative.listModels();
    assert.equal(entry?.capability, "non-chat");
    assert.equal(entry?.provenance.displayName, "conservative-default");
    assert.equal(entry?.provenance.resourceClass, "conservative-default");

    const pending = new NineRouterClient({
      baseUrl: "http://127.0.0.1:3000",
      fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    const caller = new AbortController();
    const cancelled = pending.listModels({ signal: caller.signal });
    caller.abort();
    await assert.rejects(cancelled, (error: unknown) => error instanceof NineRouterError && error.kind === "cancelled");

    let delayedTimer: ReturnType<typeof setTimeout> | undefined;
    const delayedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        delayedTimer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ data: [model("late")] })));
          controller.close();
        }, 100);
      },
      cancel() {
        if (delayedTimer !== undefined) clearTimeout(delayedTimer);
      },
    });
    const timed = new NineRouterClient({ baseUrl: "http://127.0.0.1:3000", timeoutMs: 10, fetchImpl: async () => new Response(delayedBody) });
    await assert.rejects(() => timed.listModels(), (error: unknown) => error instanceof NineRouterError && error.kind === "timeout");
  });

  it("[I][fixture-v1] treats corrupt cache as nonfatal and strips unknown entry fields on re-save", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-m2-ninerouter-"));
    try {
      const path = join(root, "catalog.json");
      await writeFile(path, "not-json", { mode: 0o600 });
      const store = new CatalogCacheStore(root);
      assert.equal((await store.load()).status, "corrupt");
      await assert.rejects(
        () => store.recordFailure(undefined, NINEROUTER_GATEWAY_ID, new NineRouterError("transport", "request", "ignored"), new Date().toISOString()),
        /last-good catalog/u,
      );
      const now = new Date().toISOString();
      await store.save({
        cacheVersion: 1,
        gatewayId: NINEROUTER_GATEWAY_ID,
        baseUrl: "http://127.0.0.1:3000/v1",
        generation: 1,
        fetchedAt: now,
        lastSuccessAt: now,
        entries: [{
          ...model("safe"),
          remoteId: "safe",
          displayName: "Safe",
          resourceClass: "unknown",
          capabilities: ["chat"],
          input: ["text"],
          capability: "chat",
          provenance: { remoteId: "remote" },
          tampered: "discard-me",
        } as never],
      });
      const serialized = await (await import("node:fs/promises")).readFile(path, "utf8");
      assert.doesNotMatch(serialized, /discard-me/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
