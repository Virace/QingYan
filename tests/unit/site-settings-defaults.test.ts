import { describe, expect, it } from "vitest";

import {
	mergeEngagementSettings,
	serializeEngagementSettings,
} from "../../src/modules/shared/site-settings-defaults";

describe("site settings defaults", () => {
	it("normalizes legacy numeric engagement booleans from persisted json", () => {
		const settings = mergeEngagementSettings(
			JSON.stringify({
				visitors: { enabled: 1 },
				pageViews: { enabled: 0 },
				pageLikes: { enabled: 1 },
				commentVotes: { enabled: 0 },
			}),
		);

		expect(settings).toEqual({
			visitors: { enabled: true },
			pageViews: { enabled: false },
			pageLikes: { enabled: true },
			commentVotes: { enabled: false },
		});
	});

	it("does not coerce string booleans from persisted engagement json", () => {
		const settings = mergeEngagementSettings({
			visitors: { enabled: "0" as unknown as boolean },
			pageViews: { enabled: "1" as unknown as boolean },
		});

		expect(settings.visitors.enabled).toBe(true);
		expect(settings.pageViews.enabled).toBe(true);
	});

	it("serializes canonical boolean engagement settings", () => {
		const serialized = serializeEngagementSettings({
			visitors: { enabled: false },
			pageViews: { enabled: true },
			pageLikes: { enabled: false },
			commentVotes: { enabled: true },
		});

		expect(JSON.parse(serialized)).toEqual({
			visitors: { enabled: false },
			pageViews: { enabled: true },
			pageLikes: { enabled: false },
			commentVotes: { enabled: true },
		});
	});
});
