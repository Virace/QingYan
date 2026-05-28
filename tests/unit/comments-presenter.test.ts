import { describe, expect, it } from "vitest";

import { presentComments } from "../../src/modules/comments/presenter";

const baseComment = {
	id: "c_1",
	parentId: null,
	authorName: "Visitor",
	authorEmail: null,
	authorEmailHash: null,
	authorWebsite: null,
	contentRaw: "hello",
	contentHtml: null,
	status: "approved",
	isPinned: false,
	isFolded: false,
	replyCount: 0,
	voteUpCount: 0,
	voteDownCount: 0,
	createdAt: "2026-05-28T10:00:00.000Z",
	updatedAt: "2026-05-28T10:00:00.000Z",
};

describe("comment presenter", () => {
	it("uses the current staff profile name for verified comments by default", () => {
		const [comment] = presentComments(
			[
				{
					...baseComment,
					authorIdentity: "verified",
					authorName: "管理员",
				},
			],
			new Map(),
			{
				verifiedAuthor: {
					enabled: true,
					displayName: "Virace",
					badgeLabel: "楼主",
				},
			},
		);

		expect(comment?.author).toMatchObject({
			name: "Virace",
			badge: { label: "楼主" },
		});
	});

	it("can keep the stored snapshot name for verified comments", () => {
		const [comment] = presentComments(
			[
				{
					...baseComment,
					authorIdentity: "verified",
					authorName: "管理员",
				},
			],
			new Map(),
			{
				staffDisplay: {
					nameMode: "snapshot",
				},
				verifiedAuthor: {
					enabled: true,
					displayName: "Virace",
					badgeLabel: "楼主",
				},
			},
		);

		expect(comment?.author).toMatchObject({
			name: "管理员",
			badge: { label: "楼主" },
		});
	});

	it("keeps visitor comment names as stored snapshots", () => {
		const [comment] = presentComments(
			[
				{
					...baseComment,
					authorIdentity: "visitor",
					authorName: "Alice",
				},
			],
			new Map(),
			{
				verifiedAuthor: {
					enabled: true,
					displayName: "Virace",
					badgeLabel: "楼主",
				},
			},
		);

		expect(comment?.author).toMatchObject({
			name: "Alice",
		});
	});
});
