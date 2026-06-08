import { describe, expect, it } from "vitest";

import {
	commentStatusSchema,
	mapDefaultStatusToModerationMode,
	moderationModeSchema,
} from "../../src/modules/comments/moderation-types";

describe("comment moderation types", () => {
	it("accepts pending, approved, spam and trash as comment statuses", () => {
		expect(commentStatusSchema.parse("pending")).toBe("pending");
		expect(commentStatusSchema.parse("approved")).toBe("approved");
		expect(commentStatusSchema.parse("spam")).toBe("spam");
		expect(commentStatusSchema.parse("trash")).toBe("trash");
		expect(commentStatusSchema.safeParse("deleted").success).toBe(false);
	});

	it("accepts the supported moderation modes", () => {
		expect(moderationModeSchema.parse("none")).toBe("none");
		expect(moderationModeSchema.parse("manual")).toBe("manual");
		expect(moderationModeSchema.parse("manual_with_akismet")).toBe(
			"manual_with_akismet",
		);
		expect(moderationModeSchema.parse("akismet_auto")).toBe("akismet_auto");
		expect(moderationModeSchema.safeParse("captcha").success).toBe(false);
	});

	it("maps old defaultStatus values to moderation modes", () => {
		expect(mapDefaultStatusToModerationMode("approved")).toBe("none");
		expect(mapDefaultStatusToModerationMode("pending")).toBe("manual");
	});
});
