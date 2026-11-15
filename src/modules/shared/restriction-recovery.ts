import { joinPublicPath } from "../../config/public-path";
import type { AppError } from "./errors";

export type RestrictionReason =
	| "rate_limited"
	| "blocked"
	| "login_required"
	| "email_not_allowed";

export function restrictionRecovery(
	error: AppError,
	publicPath: string,
	now = Date.now(),
) {
	const reason: RestrictionReason | null =
		error.statusCode === 429
			? "rate_limited"
			: error.code.includes("BLACKLISTED")
				? "blocked"
				: [
							"COMMENT_EMAIL_LOGIN_REQUIRED",
							"VERIFIED_AUTHOR_EMAIL_RESERVED",
						].includes(error.code)
					? "login_required"
					: error.code === "COMMENT_EMAIL_NOT_ALLOWED"
						? "email_not_allowed"
						: null;
	if (!reason) return undefined;
	const storedResetAt =
		typeof error.details?.resetAt === "number"
			? error.details.resetAt
			: typeof error.details?.expiresAt === "string"
				? Date.parse(error.details.expiresAt)
				: undefined;
	const suppliedRetry =
		typeof error.details?.retryAfterSec === "number" &&
		Number.isFinite(error.details.retryAfterSec)
			? Math.max(0, Math.ceil(error.details.retryAfterSec))
			: undefined;
	const resetAt =
		storedResetAt !== undefined && Number.isFinite(storedResetAt)
			? storedResetAt
			: suppliedRetry !== undefined
				? now + suppliedRetry * 1000
				: undefined;
	const remaining =
		resetAt !== undefined
			? Math.max(0, Math.ceil((resetAt - now) / 1000))
			: undefined;
	const retryAfterSec = remaining ?? suppliedRetry;
	const query = new URLSearchParams({ reason });
	if (
		remaining !== undefined &&
		resetAt !== undefined &&
		Math.abs(resetAt) <= 8.64e15
	)
		query.set("resetAt", String(Math.ceil(resetAt)));
	return {
		reason,
		retryAfterSec,
		helpUrl: `${joinPublicPath(publicPath, "/restricted")}?${query}`,
	};
}
