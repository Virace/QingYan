import { describe, expect, it } from "vitest";

import {
	commentInputLimitHardCaps,
	buildDefaultSiteSettings,
	defaultCommentInputLimits,
	mergeCommentInputLimits,
	mergeEngagementSettings,
	serializeCommentInputLimits,
	serializeEngagementSettings,
} from "../../src/modules/shared/site-settings-defaults";

describe("site settings defaults", () => {
	it("keeps commenter reply email default unchecked", () => {
		expect(buildDefaultSiteSettings(1)).toMatchObject({
			commenterReplyEmailEnabled: false,
			commenterReplyEmailDefaultChecked: false,
			backendNotificationsEnabled: false,
		});
	});

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

	it("uses default comment input limits when persisted value is missing", () => {
		expect(mergeCommentInputLimits()).toEqual(defaultCommentInputLimits);
		expect(mergeCommentInputLimits("not json")).toEqual(
			defaultCommentInputLimits,
		);
	});

	it("uses persisted comment input limits", () => {
		expect(
			mergeCommentInputLimits({
				authorNameMaxLength: 32,
				authorWebsiteMaxLength: 1024,
				pageTitleMaxLength: 180,
				pageKeyMaxLength: 256,
				contentMaxLength: 1500,
			}),
		).toEqual({
			authorNameMaxLength: 32,
			authorWebsiteMaxLength: 1024,
			pageTitleMaxLength: 180,
			pageKeyMaxLength: 256,
			contentMaxLength: 1500,
		});
	});

	it("clamps too-large comment input limits to hard caps", () => {
		expect(
			mergeCommentInputLimits({
				authorNameMaxLength: 999,
				authorWebsiteMaxLength: 9999,
				pageTitleMaxLength: 999,
				pageKeyMaxLength: 9999,
				contentMaxLength: 99999,
			}),
		).toEqual(commentInputLimitHardCaps);
	});

	it("falls back to defaults for non-positive and non-number comment limits", () => {
		expect(
			mergeCommentInputLimits({
				authorNameMaxLength: 0,
				authorWebsiteMaxLength: -1,
				pageTitleMaxLength: Number.NaN,
				pageKeyMaxLength: "128",
				contentMaxLength: null,
			}),
		).toEqual(defaultCommentInputLimits);
	});

	it("serializes canonical comment input limits", () => {
		const serialized = serializeCommentInputLimits({
			authorNameMaxLength: 30,
			contentMaxLength: 1200,
		});

		expect(JSON.parse(serialized)).toEqual({
			...defaultCommentInputLimits,
			authorNameMaxLength: 30,
			contentMaxLength: 1200,
		});
	});
});
