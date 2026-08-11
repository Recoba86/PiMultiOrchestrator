import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultConfig } from "../src/core/config/defaults.js";
import { ConfigImportError } from "../src/core/config/errors.js";
import { exportConfig, parseConfigImport, previewConfigImport } from "../src/core/config/transfer.js";
import type { ConfigV1 } from "../src/core/config/types.js";

function config(): ConfigV1 {
  return createDefaultConfig();
}

describe("configuration transfer", () => {
  it("[U][fixture-v1] export is deterministic and omits storage state", () => {
    const value = exportConfig(config());
    assert.match(value, /"schemaVersion": 1/);
    assert.doesNotMatch(value, /storageVersion|generation|savedAt|health|mission|analyticsEvents/);
    assert.equal(value, exportConfig(config()));
  });

  it("[U][fixture-v1] import round-trip previews normalized changes", () => {
    const original = config();
    const parsed = parseConfigImport(exportConfig(original));
    assert.deepEqual(parsed, original);
    const changed = config();
    changed.routing.maxAttempts = 2;
    const preview = previewConfigImport(exportConfig(changed), original);
    assert.equal(preview.changed, true);
    assert.match(preview.after, /"maxAttempts": 2/);
    assert.match(preview.before ?? "", /"maxAttempts": 1/);
  });

  it("[U][fixture-v1] import rejects storage envelopes and unsupported versions", () => {
    const semantic = config();
    const stored = { storageVersion: 1, generation: 99, savedAt: "2026-01-01T00:00:00.000Z", config: semantic };
    assert.throws(() => parseConfigImport(JSON.stringify(stored)), ConfigImportError);
    assert.throws(() => parseConfigImport(JSON.stringify({ ...stored, storageVersion: 999 })), ConfigImportError);
  });

  it("[U][fixture-v1] import rejects malformed oversized and secret-shaped input", () => {
    assert.throws(() => parseConfigImport("not-json"), ConfigImportError);
    assert.throws(() => parseConfigImport("{}"), ConfigImportError);
    assert.throws(() => parseConfigImport(JSON.stringify({ ...config(), apiKey: "sentinel" })), ConfigImportError);
    assert.throws(() => parseConfigImport(JSON.stringify({ ...config(), secretResolver: { command: "echo bad" } })), ConfigImportError);
    assert.throws(() => parseConfigImport("{}", { maxBytes: 1 }), ConfigImportError);
  });

  it("[U][fixture-v1] import validation does not mutate caller values", () => {
    const value = config();
    const before = structuredClone(value);
    parseConfigImport(value);
    assert.deepEqual(value, before);
    assert.throws(() => parseConfigImport({ ...value, routes: "bad" }), ConfigImportError);
  });
});
