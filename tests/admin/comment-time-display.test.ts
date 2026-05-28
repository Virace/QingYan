import { describe, expect, it } from "vitest";

import { formatAdminCommentTime } from "../../apps/admin/src/components/admin/time-format";

describe("formatAdminCommentTime", () => {
	it("formats comment creation timestamps for admin rows", () => {
		expect(formatAdminCommentTime("2026-05-29T04:05:06.000Z")).toBe(
			"2026-05-29 04:05",
		);
	});

	it("keeps invalid timestamps visible instead of hiding them", () => {
		expect(formatAdminCommentTime("not-a-date")).toBe("not-a-date");
	});
});
