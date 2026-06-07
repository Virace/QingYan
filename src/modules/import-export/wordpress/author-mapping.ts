import type { WxrAuthor, WxrComment } from "./wxr-types";

export type WordPressAuthorMatchKind =
	| "staff_strong"
	| "staff_existing_user"
	| "staff_email_candidate"
	| "registered_unknown"
	| "visitor";

export interface WordPressAdminUserAuthorCandidate {
	id: number;
	email: string;
	displayName: string;
	username?: string;
	status?: string;
}

export interface WordPressAuthorMatch {
	kind: WordPressAuthorMatchKind;
	wpAuthorId?: string;
	email?: string;
	adminUser?: {
		id: number;
		displayName: string;
		username?: string;
		status?: string;
	};
}

export interface WordPressAuthorMatchSummary {
	totalAuthors: number;
	staffStrong: number;
	staffExistingUser: number;
	staffEmailCandidate: number;
	registeredUnknown: number;
	visitor: number;
}

function normalizeEmail(email?: string | null): string {
	return email?.trim().toLowerCase() ?? "";
}

export function classifyWordPressAuthorMatch(
	comment: Pick<WxrComment, "authorEmail" | "commentUserId">,
	authors: WxrAuthor[],
	adminUsers: WordPressAdminUserAuthorCandidate[] = [],
): WordPressAuthorMatch {
	const userId = comment.commentUserId?.trim() ?? "";
	const authorsById = new Map(authors.map((author) => [author.id, author]));
	const adminUsersByEmail = new Map(
		adminUsers.map((user) => [normalizeEmail(user.email), user]),
	);
	const commentEmail = normalizeEmail(comment.authorEmail);
	const matchedAdminUser = commentEmail
		? adminUsersByEmail.get(commentEmail)
		: undefined;
	if (matchedAdminUser) {
		return {
			kind: "staff_existing_user",
			email: commentEmail,
			adminUser: {
				id: matchedAdminUser.id,
				displayName: matchedAdminUser.displayName,
				username: matchedAdminUser.username,
				status: matchedAdminUser.status,
			},
		};
	}
	if (userId && userId !== "0") {
		const author = authorsById.get(userId);
		if (author) {
			return {
				kind: "staff_strong",
				wpAuthorId: author.id,
				email: normalizeEmail(author.email),
			};
		}
		return {
			kind: "registered_unknown",
			wpAuthorId: undefined,
			email: undefined,
		};
	}

	if (commentEmail) {
		const author = authors.find(
			(candidate) => normalizeEmail(candidate.email) === commentEmail,
		);
		if (author) {
			return {
				kind: "staff_email_candidate",
				wpAuthorId: author.id,
				email: normalizeEmail(author.email),
			};
		}
	}

	return {
		kind: "visitor",
		wpAuthorId: undefined,
		email: undefined,
	};
}

export function summarizeWordPressAuthorMatches(
	comments: Array<Pick<WxrComment, "authorEmail" | "commentUserId">>,
	authors: WxrAuthor[],
	adminUsers: WordPressAdminUserAuthorCandidate[] = [],
): WordPressAuthorMatchSummary {
	const summary: WordPressAuthorMatchSummary = {
		totalAuthors: authors.length,
		staffStrong: 0,
		staffExistingUser: 0,
		staffEmailCandidate: 0,
		registeredUnknown: 0,
		visitor: 0,
	};

	for (const comment of comments) {
		const match = classifyWordPressAuthorMatch(comment, authors, adminUsers);
		if (match.kind === "staff_strong") {
			summary.staffStrong += 1;
		} else if (match.kind === "staff_existing_user") {
			summary.staffExistingUser += 1;
		} else if (match.kind === "staff_email_candidate") {
			summary.staffEmailCandidate += 1;
		} else if (match.kind === "registered_unknown") {
			summary.registeredUnknown += 1;
		} else {
			summary.visitor += 1;
		}
	}

	return summary;
}
