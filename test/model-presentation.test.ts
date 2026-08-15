import assert from "node:assert/strict";
import { it } from "node:test";

import {
	canonicalModelOptions,
	canonicalModelName,
	formatCanonicalModelLabel,
} from "../src/core/ninerouter/index.js";

it("[U][fixture-v1] uses the remote model ID as the canonical label", () => {
	const input = {
		value: "r9-ninerouter-ag-claude-opus-4-6-think-XXXX",
		remoteModelId: "ag/claude-opus-4-6-thinking",
		displayName: "ag/claude-opus-4-6-thinking",
	};

	assert.equal(canonicalModelName(input), "ag/claude-opus-4-6-thinking");
	assert.equal(formatCanonicalModelLabel(input), "ag/claude-opus-4-6-thinking");
	assert.equal(canonicalModelOptions([input])[0]?.label, "ag/claude-opus-4-6-thinking");
	assert.doesNotMatch(canonicalModelOptions([input])[0]?.label ?? "", /r9-ninerouter/u);
});

it("[U][fixture-v1] removes duplicate names and keeps colliding route values distinct", () => {
	const options = canonicalModelOptions([
		{ value: "route-a", remoteModelId: "ag/foo", displayName: "ag/foo" },
		{ value: "route-b", remoteModelId: "ag/foo", displayName: "ag/foo" },
	]);

	assert.deepEqual(options.map((option) => option.label), ["ag/foo #1", "ag/foo #2"]);
	assert.deepEqual(options.map((option) => option.value), ["route-a", "route-b"]);
	assert.equal(options.some((option) => option.label.includes("ag/foo — ag/foo")), false);
});

it("[U][fixture-v1] does not invent pool status or thinking text in the canonical label", () => {
	const option = canonicalModelOptions([{
		value: "route-a",
		remoteModelId: "ag/foo",
		displayName: "Route A",
	}])[0]!;

	assert.equal(option.label, "ag/foo");
	assert.doesNotMatch(option.label, /ACTIVE|Thinking/iu);
});
