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

	it("omits null placeholders and empty children for root comments", () => {
		const [comment] = presentComments([baseComment], new Map(), {
			commentVotes: { enabled: false },
		});

		expect(comment).toMatchObject({
			id: "c_1",
			replyCount: 0,
		});
		expect(comment).not.toHaveProperty("parentId");
		expect(comment).not.toHaveProperty("children");
		expect(comment).not.toHaveProperty("vote");
		expect(comment).not.toHaveProperty("voteUp");
		expect(comment).not.toHaveProperty("voteDown");
		expect(comment).not.toHaveProperty("viewerVote");
	});

	it("emits parentId and children only when replies exist", () => {
		const comments = presentComments(
			[
				{
					...baseComment,
					id: "c_parent",
					replyCount: 1,
				},
				{
					...baseComment,
					id: "c_child",
					parentId: "c_parent",
					authorName: "Reply",
				},
			],
			new Map(),
			{ commentVotes: { enabled: false } },
		);

		expect(comments[0]).toMatchObject({
			id: "c_parent",
			children: [
				{
					id: "c_child",
					parentId: "c_parent",
				},
			],
		});
	});

	it("emits nested vote only when comment voting is enabled", () => {
		const [comment] = presentComments(
			[
				{
					...baseComment,
					voteUpCount: 2,
					voteDownCount: 1,
				},
			],
			new Map(),
			{ commentVotes: { enabled: true } },
		);

		expect(comment?.vote).toEqual({
			up: 2,
			down: 1,
		});
		expect(comment?.vote).not.toHaveProperty("viewer");
	});

	it("emits viewer vote only when the current visitor has voted", () => {
		const [comment] = presentComments(
			[
				{
					...baseComment,
					voteUpCount: 2,
					voteDownCount: 1,
				},
			],
			new Map([["c_1", "up"]]),
			{ commentVotes: { enabled: true } },
		);

		expect(comment?.vote).toEqual({
			up: 2,
			down: 1,
			viewer: "up",
		});
	});
});
