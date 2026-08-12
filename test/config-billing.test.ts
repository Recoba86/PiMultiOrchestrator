import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConfigStore, ConfigV2Store, createDefaultConfig, migrateConfigV1ToV2, validateConfigV2 } from "../src/core/config/index.js";

test("ConfigV2Store migrates legacy config and persists bounded billing profiles", async () => {
	const root = await mkdtemp(join(tmpdir(), "pmo-billing-"));
	try {
		const legacy = createDefaultConfig();
		await writeFile(join(root, "config.json"), JSON.stringify({ storageVersion: 1, generation: 4, savedAt: "2026-08-12T00:00:00.000Z", config: legacy }));
		const store = new ConfigV2Store({ root });
		const loaded = await store.load();
		assert.equal(loaded.status, "migrated");
		assert.equal(loaded.snapshot?.config.billing.profiles["metered-fixture"], undefined);
		const migrated = migrateConfigV1ToV2(legacy);
		migrated.billing.profiles["metered-fixture"] = {
			id: "metered-fixture" as never,
			displayName: "Fixture metered",
			billingMode: "metered_api",
			provenance: "configured",
			currency: "USD",
			inputMicrosPerMillion: 125,
			outputMicrosPerMillion: 400,
			label: "operator reference",
		};
		await store.save(migrated);
		const reopened = new ConfigV2Store({ root });
		const persisted = await reopened.load();
		assert.equal(persisted.status, "valid");
		assert.equal(persisted.snapshot?.config.billing.profiles["metered-fixture"]?.outputMicrosPerMillion, 400);
		assert.equal((await new ConfigStore({ root }).load()).status, "valid");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("unknown billing remains unknown and V2 history restores the prior profile", async () => {
	const root = await mkdtemp(join(tmpdir(), "pmo-billing-"));
	try {
		const store = new ConfigV2Store({ root });
		const config = migrateConfigV1ToV2(createDefaultConfig());
		config.billing.profiles.unknown = { id: "unknown" as never, displayName: "Unknown", billingMode: "unknown", provenance: "unknown" };
		config.billing.activeProfileId = "unknown" as never;
		assert.deepEqual(validateConfigV2(config).billing.profiles.unknown, config.billing.profiles.unknown);
		await store.initialize(config);
		await store.update((draft) => { draft.billing.profiles.unknown!.label = "still unknown"; });
		await store.restore(1);
		const restored = await store.load();
		assert.equal(restored.snapshot?.config.billing.profiles.unknown?.label, undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
