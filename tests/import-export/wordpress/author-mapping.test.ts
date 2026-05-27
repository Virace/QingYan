import { describe, expect, it } from "vitest";

import {
	classifyWordPressAuthorMatch,
	summarizeWordPressAuthorMatches,
} from "../../../src/modules/import-export/wordpress/author-mapping";
import type {
	WxrAuthor,
	WxrComment,
} from "../../../src/modules/import-export/wordpress/wxr-types";

const authors: WxrAuthor[] = [
	{
		id: "1",
		login: "Virace",
		email: "Virace@aliyun.com",
		displayName: "管理员",
		firstName: "管理员",
		lastName: "",
	},
];

function comment(input: Partial<WxrComment>): WxrComment {
	return {
		commentId: input.commentId ?? "1",
		parentId: null,
		approved: "1",
		type: "",
		authorName: input.authorName ?? "Alice",
		authorEmail: input.authorEmail,
		commentUserId: input.commentUserId,
		content: input.content ?? "hello",
	};
}

describe("classifyWordPressAuthorMatch", () => {
	it("treats comment_user_id matching a WXR author as a strong staff match", () => {
		expect(
			classifyWordPressAuthorMatch(
				comment({ commentUserId: "1", authorEmail: "someone@example.com" }),
				authors,
			),
		).toEqual({
			kind: "staff_strong",
			wpAuthorId: "1",
			email: "virace@aliyun.com",
		});
	});

	it("treats anonymous comments with matching author email as staff candidates", () => {
		expect(
			classifyWordPressAuthorMatch(
				comment({ commentUserId: "0", authorEmail: " virace@ALIYUN.com " }),
				authors,
			),
		).toEqual({
			kind: "staff_email_candidate",
			wpAuthorId: "1",
			email: "virace@aliyun.com",
		});
	});

	it("marks non-zero unknown user ids as registered unknown", () => {
		expect(
			classifyWordPressAuthorMatch(
				comment({ commentUserId: "9", authorEmail: "visitor@example.com" }),
				authors,
			),
		).toEqual({
			kind: "registered_unknown",
			wpAuthorId: undefined,
			email: undefined,
		});
	});

	it("marks comments without user id or author email match as visitors", () => {
		expect(
			classifyWordPressAuthorMatch(
				comment({ commentUserId: "0", authorEmail: "visitor@example.com" }),
				authors,
			),
		).toEqual({
			kind: "visitor",
			wpAuthorId: undefined,
			email: undefined,
		});
	});
});

describe("summarizeWordPressAuthorMatches", () => {
	it("counts match classes across comments", () => {
		expect(
			summarizeWordPressAuthorMatches(
				[
					comment({ commentUserId: "1", authorEmail: "Virace@aliyun.com" }),
					comment({ commentUserId: "0", authorEmail: "virace@aliyun.com" }),
					comment({ commentUserId: "9", authorEmail: "other@example.com" }),
					comment({ commentUserId: "0", authorEmail: "visitor@example.com" }),
				],
				authors,
			),
		).toMatchObject({
			totalAuthors: 1,
			staffStrong: 1,
			staffEmailCandidate: 1,
			registeredUnknown: 1,
			visitor: 1,
		});
	});
});
