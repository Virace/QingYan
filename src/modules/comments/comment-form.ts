import {
	defaultCommentRequire,
	mergeCommentInputLimits,
} from "../shared/site-settings-defaults";

export const commentIdentityFields = ["nickname", "email", "website"] as const;

export type CommentIdentityField = (typeof commentIdentityFields)[number];

function parseRequireFields(payload?: string | null): unknown {
	if (!payload) {
		return undefined;
	}

	try {
		return JSON.parse(payload) as unknown;
	} catch {
		return undefined;
	}
}

function sanitizeRequireFields(
	value: unknown,
	allowWebsite: boolean,
	fallback: readonly CommentIdentityField[],
): CommentIdentityField[] {
	const source = Array.isArray(value) ? value : fallback;
	const normalized: CommentIdentityField[] = [];

	for (const item of source) {
		if (
			typeof item !== "string" ||
			!commentIdentityFields.includes(item as CommentIdentityField)
		) {
			continue;
		}

		if (item === "website" && !allowWebsite) {
			continue;
		}

		if (!normalized.includes(item as CommentIdentityField)) {
			normalized.push(item as CommentIdentityField);
		}
	}

	return normalized;
}

export function buildCommentForm(settings?: {
	allowWebsite?: boolean;
	commentRequireJson?: string | null;
	commentInputLimitsJson?: string | null;
}) {
	const allowWebsite = settings?.allowWebsite ?? true;
	const allow = allowWebsite
		? [...commentIdentityFields]
		: commentIdentityFields.filter((field) => field !== "website");

	return {
		allow,
		require: sanitizeRequireFields(
			parseRequireFields(settings?.commentRequireJson),
			allowWebsite,
			defaultCommentRequire,
		),
		limits: mergeCommentInputLimits(settings?.commentInputLimitsJson),
	};
}
