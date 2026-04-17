import type { SiteConfig } from "../../config/types";

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
	fallback: CommentIdentityField[],
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

export function buildCommentForm(
	site: SiteConfig,
	settings?: {
		allowWebsite?: boolean;
		commentRequireJson?: string | null;
	},
) {
	const allowWebsite =
		settings?.allowWebsite ?? site.defaults.comments.allowWebsite;
	const allow = allowWebsite
		? [...commentIdentityFields]
		: commentIdentityFields.filter((field) => field !== "website");

	return {
		allow,
		require: sanitizeRequireFields(
			parseRequireFields(settings?.commentRequireJson),
			allowWebsite,
			site.defaults.comments.identity.require,
		),
	};
}
