import { describe, expect, it } from "vitest";

import { commentActionsForStatus } from "../../apps/admin/src/components/admin/content/comment-actions";

describe("commentActionsForStatus", () => {
	it("does not show duplicate pending action for approved comments", () => {
		const actions = commentActionsForStatus("approved").map(
			(action) => action.id,
		);

		expect(actions).toContain("pending");
		expect(actions).not.toContain("approve");
		expect(actions.filter((id) => id === "pending")).toHaveLength(1);
	});

	it("does not show pending action for pending comments", () => {
		const actions = commentActionsForStatus("pending").map(
			(action) => action.id,
		);

		expect(actions).toContain("approve");
		expect(actions).not.toContain("pending");
	});

	it("does not show spam action for spam comments", () => {
		const actions = commentActionsForStatus("spam").map((action) => action.id);

		expect(actions).toContain("approve");
		expect(actions).not.toContain("spam");
	});

	it("shows restore and permanent delete for trash comments", () => {
		const actions = commentActionsForStatus("trash").map((action) => action.id);

		expect(actions).toEqual(expect.arrayContaining(["restore", "delete"]));
		expect(actions).not.toContain("trash");
	});
});
