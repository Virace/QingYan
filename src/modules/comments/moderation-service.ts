import type { SystemSettings } from "../system-settings/definitions";
import type {
	AkismetClient,
	AkismetCommentCheckInput,
	AkismetReviewResult,
} from "./akismet-client";
import type {
	CommentStatus,
	ModerationDecision,
	ModerationProvider,
	SiteModerationSettings,
} from "./moderation-types";

export interface ModerationReviewInput {
	siteModeration: SiteModerationSettings;
	blog: string;
	userIp?: string;
	userAgent?: string;
	referrer?: string;
	permalink?: string;
	commentType: "comment" | "reply";
	commentAuthor?: string;
	commentAuthorEmail?: string;
	commentAuthorUrl?: string;
	commentContent: string;
	commentDateGmt?: string;
	isTest?: boolean;
}

export interface ModerationReviewResult {
	provider: ModerationProvider;
	mode: SiteModerationSettings["mode"];
	decision: ModerationDecision;
	status: CommentStatus;
	reason?: string;
	akismetVerdict?: AkismetReviewResult["verdict"];
	akismetProTip?: AkismetReviewResult["proTip"];
	akismetRecheckAfterSec?: number;
	akismetDebugHelp?: string;
	checkedAt?: string;
	requestSnapshot?: AkismetCommentCheckInput;
}

export interface ModerationServiceOptions {
	akismetClient?: Pick<AkismetClient, "commentCheck">;
	loadSystemSettings: () => Promise<SystemSettings>;
}

function result(input: {
	provider: ModerationProvider;
	mode: SiteModerationSettings["mode"];
	decision: ModerationDecision;
	status: CommentStatus;
	reason?: string;
}): ModerationReviewResult {
	return input;
}

function mapAkismetResult(
	mode: SiteModerationSettings["mode"],
	akismet: AkismetReviewResult,
	requestSnapshot: AkismetCommentCheckInput,
): ModerationReviewResult {
	if (akismet.verdict === "spam") {
		return {
			provider: "akismet",
			mode,
			decision: "spam",
			status: "spam",
			reason: akismet.proTip === "discard" ? "akismet_discard" : "akismet_spam",
			akismetVerdict: akismet.verdict,
			akismetProTip: akismet.proTip,
			akismetRecheckAfterSec: akismet.recheckAfterSec,
			akismetDebugHelp: akismet.debugHelp,
			checkedAt: akismet.checkedAt,
			requestSnapshot,
		};
	}

	if (akismet.verdict === "ham" && mode === "akismet_auto") {
		return {
			provider: "akismet",
			mode,
			decision: "approve",
			status: "approved",
			reason: "akismet_ham",
			akismetVerdict: akismet.verdict,
			akismetRecheckAfterSec: akismet.recheckAfterSec,
			akismetDebugHelp: akismet.debugHelp,
			checkedAt: akismet.checkedAt,
			requestSnapshot,
		};
	}

	return {
		provider: "akismet",
		mode,
		decision: "pending",
		status: "pending",
		reason:
			akismet.verdict === "ham" ? "akismet_ham_manual_review" : "akismet_error",
		akismetVerdict: akismet.verdict,
		akismetRecheckAfterSec: akismet.recheckAfterSec,
		akismetDebugHelp: akismet.debugHelp,
		checkedAt: akismet.checkedAt,
		requestSnapshot,
	};
}

export class ModerationService {
	public constructor(private readonly options: ModerationServiceOptions) {}

	public async reviewComment(
		input: ModerationReviewInput,
	): Promise<ModerationReviewResult> {
		const mode = input.siteModeration.mode;
		if (mode === "none") {
			return result({
				provider: "none",
				mode,
				decision: "approve",
				status: "approved",
				reason: "moderation_disabled",
			});
		}

		if (mode === "manual") {
			return result({
				provider: "none",
				mode,
				decision: "pending",
				status: "pending",
				reason: "manual_review",
			});
		}

		const systemSettings = await this.options.loadSystemSettings();
		const apiKey = systemSettings.antiSpam.akismet.apiKey;
		if (!apiKey || !input.userIp || !this.options.akismetClient) {
			return result({
				provider: "akismet",
				mode,
				decision: "pending",
				status: "pending",
				reason: !apiKey ? "akismet_api_key_missing" : "akismet_unavailable",
			});
		}

		const requestSnapshot: AkismetCommentCheckInput = {
			apiKey,
			blog: input.blog,
			userIp: input.userIp,
			userAgent: input.userAgent,
			referrer: input.referrer,
			permalink: input.permalink,
			commentType: input.commentType,
			commentAuthor: input.commentAuthor,
			commentAuthorEmail: input.commentAuthorEmail,
			commentAuthorUrl: input.commentAuthorUrl,
			commentContent: input.commentContent,
			commentDateGmt: input.commentDateGmt,
			isTest: input.isTest,
		};

		try {
			const akismet =
				await this.options.akismetClient.commentCheck(requestSnapshot);
			return mapAkismetResult(mode, akismet, requestSnapshot);
		} catch (error) {
			return {
				provider: "akismet",
				mode,
				decision: "pending",
				status: "pending",
				reason: "akismet_error",
				akismetVerdict: "error",
				akismetDebugHelp:
					error instanceof Error ? error.message : "Unknown Akismet error",
				checkedAt: new Date().toISOString(),
				requestSnapshot,
			};
		}
	}
}
