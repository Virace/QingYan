import type { EngagementSettings } from "../shared/site-settings-defaults";
import type { SystemSettings } from "../system-settings/definitions";

export type FeatureDisabledReason =
	| "site_disabled"
	| "page_inactive"
	| "comments_disabled"
	| "feature_disabled"
	| "unsupported";

export type FeatureFlag = {
	enabled: boolean;
	reason?: FeatureDisabledReason;
};

export type PublicFeatures = {
	comments: FeatureFlag;
	commentReplies: FeatureFlag & {
		maxDepth?: number;
	};
	commentVotes: FeatureFlag;
	commentCaptcha: FeatureFlag & {
		mode?: "never" | "always" | "threshold";
	};
	pageViews: FeatureFlag;
	pageLikes: FeatureFlag;
	visitors: FeatureFlag;
	replyEmailNotification: boolean;
};

export function enabledFeature(): FeatureFlag {
	return { enabled: true };
}

export function disabledFeature(reason: FeatureDisabledReason): FeatureFlag {
	return { enabled: false, reason };
}

export function omitEmptyObject<T extends Record<string, unknown>>(
	value: T,
): T | undefined {
	return Object.keys(value).length > 0 ? value : undefined;
}

export function isSystemMailUsable(mail: SystemSettings["mail"]): boolean {
	return (
		mail.enabled &&
		mail.smtp.host.trim().length > 0 &&
		mail.smtp.from.trim().length > 0
	);
}

export function buildPublicFeatures(input: {
	pageInteractive: boolean;
	commentsEnabled: boolean;
	maxDepth: number;
	captchaMode: "never" | "always" | "threshold";
	engagement: EngagementSettings;
	systemMailUsable: boolean;
	commenterReplyEmailEnabled: boolean;
}): PublicFeatures {
	if (!input.pageInteractive) {
		return {
			comments: disabledFeature("page_inactive"),
			commentReplies: disabledFeature("page_inactive"),
			commentVotes: disabledFeature("page_inactive"),
			commentCaptcha: disabledFeature("page_inactive"),
			pageViews: disabledFeature("page_inactive"),
			pageLikes: disabledFeature("page_inactive"),
			visitors: disabledFeature("page_inactive"),
			replyEmailNotification: false,
		};
	}

	const comments = input.commentsEnabled
		? enabledFeature()
		: disabledFeature("site_disabled");
	const commentReplies =
		input.commentsEnabled && input.maxDepth > 1
			? { enabled: true, maxDepth: input.maxDepth }
			: disabledFeature(
					input.commentsEnabled ? "feature_disabled" : "comments_disabled",
				);
	const commentVotes =
		input.commentsEnabled && input.engagement.commentVotes.enabled
			? enabledFeature()
			: disabledFeature(
					input.commentsEnabled ? "feature_disabled" : "comments_disabled",
				);
	const commentCaptcha =
		input.commentsEnabled && input.captchaMode !== "never"
			? { enabled: true, mode: input.captchaMode }
			: disabledFeature(
					input.commentsEnabled ? "feature_disabled" : "comments_disabled",
				);

	return {
		comments,
		commentReplies,
		commentVotes,
		commentCaptcha,
		pageViews: input.engagement.pageViews.enabled
			? enabledFeature()
			: disabledFeature("feature_disabled"),
		pageLikes: input.engagement.pageLikes.enabled
			? enabledFeature()
			: disabledFeature("feature_disabled"),
		visitors: input.engagement.visitors.enabled
			? enabledFeature()
			: disabledFeature("feature_disabled"),
		replyEmailNotification:
			input.pageInteractive &&
			input.commentsEnabled &&
			input.maxDepth > 1 &&
			input.systemMailUsable &&
			input.commenterReplyEmailEnabled,
	};
}
