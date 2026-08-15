import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatBossProfileOverview } from "../src/core/mission/boss-profile-view.js";

describe("RC28 Boss profile presentation", () => {
	it("does not show Unconfigured Boss after routes are configured", () => {
		const view = formatBossProfileOverview({
			displayName: "Unconfigured Boss",
			enabled: true,
			profileId: "default-boss",
			routes: [
				{ routeId: "cursor", label: "cu/cursor-grok-4.6-high", thinkingLabel: "Thinking Auto", enabled: true, available: true, weight: 0 },
				{ routeId: "tabi", label: "Tabi/claude-opus-5-thinking", thinkingLabel: "Thinking Auto", enabled: true, available: true, weight: 1 },
			],
			editorRouteId: "cursor",
		});
		assert.equal(view.lines[0], "profile: Default Boss");
		assert.doesNotMatch(view.summary, /Unconfigured Boss/u);
		assert.match(view.summary, /scheduled Boss: Tabi\/claude-opus-5-thinking \(weight 1, share 100%\)/u);
		assert.match(view.summary, /editor selection: cu\/cursor-grok-4\.6-high \(not the scheduled Boss\)/u);
		assert.doesNotMatch(view.summary, /^model:/mu);
		assert.match(view.summary, /cu\/cursor-grok-4\.6-high .* fallback-eligible/u);
		assert.match(view.summary, /Tabi\/claude-opus-5-thinking .* scheduling-eligible — fallback-eligible/u);
		assert.doesNotMatch(view.summary, /cu\/cursor-grok-4\.6-high .* scheduling-eligible/u);
	});
});
