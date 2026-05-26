import { requestJson } from "./client";

export interface Page<T> {
	items: T[];
	pagination: {
		limit: number;
		offset: number;
		totalCount: number;
	};
}

export type CommentStatus = "pending" | "approved" | "spam" | "trash";
export type ModerationMode =
	| "none"
	| "akismet_auto"
	| "manual_with_akismet"
	| "manual";

export interface SiteModerationSettings {
	mode: ModerationMode;
	provider: "none" | "akismet";
	akismet: {
		blogUrl?: string;
		failPolicy: "pending";
		discardBlatantSpam: boolean;
	};
}

export interface AdminComment {
	id: string;
	parentId: string | null;
	status: CommentStatus;
	authorName: string;
	authorEmail: string | null;
	authorIp: string | null;
	authorUserAgent: string | null;
	blacklist: {
		email: boolean;
		ip: boolean;
	};
	contentRaw: string;
	isPinned: boolean;
	isFolded: boolean;
	replyCount: number;
	voteUpCount: number;
	voteDownCount: number;
	createdAt: string;
	updatedAt: string;
	pageKey: string;
	pageTitle: string | null;
	pageUrl: string | null;
}

export interface AdminPage {
	siteKey: string;
	pageKey: string;
	pageTitle: string | null;
	pageUrl: string | null;
	commentCount: number;
	rootCommentCount: number;
	pageLikeCount: number;
	updatedAt: string;
	visitorCount: number;
	userCount: number;
}

export interface AdminUser {
	email: string;
	names: string[];
	commentCount: number;
	pendingCount: number;
	approvedCount: number;
	lastCommentAt: string | null;
	pageCount: number;
	siteCount: number;
	ips: string[];
	userAgents: string[];
	blacklist: {
		email: boolean;
	};
	isBlacklisted: boolean;
}

export interface AdminVisitor {
	siteKey: string;
	visitorKey: string;
	lastSeenAt: string;
	createdAt: string;
	commentCount: number;
	pageCount: number;
	emailCount: number;
	emails: string[];
	ips: string[];
	userAgents: string[];
	blacklist: {
		visitor: boolean;
	};
}

export interface AdminBlacklistRule {
	id: number;
	siteId: number | null;
	scope: "post" | "all";
	targetType: "ip" | "email" | "visitor";
	targetValue: string;
	matchMode: "exact" | "cidr" | "wildcard";
	reason: string | null;
	source: string;
	expiresAt: string | null;
	createdAt: string;
}

export interface AdminSite {
	siteKey: string;
	name: string;
	allowedOrigins: string[];
	comments: {
		enabled: boolean;
		defaultStatus: "pending" | "approved";
		moderation: SiteModerationSettings;
		identity: {
			allow: Array<"nickname" | "email" | "website">;
			require: Array<"nickname" | "email" | "website">;
		};
		allowWebsite: boolean;
		captcha: {
			mode: "never" | "always" | "threshold";
		};
	};
	pageFeedback: {
		allowLike: boolean;
	};
	notifications: {
		emailEnabled: boolean;
	};
	pageCount: number;
	commentCount: number;
	userCount: number;
	visitorCount: number;
}

export interface AdminSettings {
	siteKey: string;
	comments: {
		enabled: boolean;
		defaultStatus: "pending" | "approved";
		moderation: SiteModerationSettings;
		maxDepth: number;
		rootLimit: number;
		identity: {
			allow: Array<"nickname" | "email" | "website">;
			require: Array<"nickname" | "email" | "website">;
		};
		allowWebsite: boolean;
		captcha: {
			mode: "never" | "always" | "threshold";
			thresholdWindowSec: number;
			thresholdMaxActions: number;
		};
		abuseGuard: {
			enabled: boolean;
			windowSec: number;
			maxWriteActions: number;
			autoBlacklist: {
				enabled: boolean;
				scope: "post" | "all";
				ttlSec: number;
			};
		};
		metadata: {
			collectIp: boolean;
			collectUserAgent: boolean;
			ipRegion: {
				enabled: boolean;
				precision: "country" | "province" | "city";
			};
			device: {
				enabled: boolean;
				display: {
					enabled: boolean;
				};
			};
		};
		verifiedAuthor: {
			enabled: boolean;
			displayName: string;
			email: string;
			website: string;
			badgeLabel: string;
		};
	};
	pageFeedback: {
		allowLike: boolean;
	};
	notifications: {
		emailEnabled: boolean;
	};
}

export interface AdminSystemSettings {
	admin: {
		session: {
			ttlMinutes: number;
		};
	};
	security: {
		globalFloodGuard: {
			enabled: boolean;
			windowSec: number;
			maxRequests: number;
		};
		publicOriginGuard: {
			enabled: boolean;
			allowMissingOrigin: boolean;
		};
		adminOriginGuard: {
			enabled: boolean;
			allowMissingOrigin: boolean;
			allowedOrigins: string[];
		};
		rateLimit: {
			adminLogin: {
				windowSec: number;
				maxFailures: number;
				autoBlacklistSec: number;
			};
			commentCreate: {
				windowSec: number;
				maxRequests: number;
			};
			commentVote: {
				windowSec: number;
				maxRequests: number;
			};
			captchaVerify: {
				windowSec: number;
				maxFailures: number;
			};
			pageLike: {
				windowSec: number;
				maxRequests: number;
			};
		};
	};
	logging: {
		level: "error" | "warn" | "info" | "debug";
		retentionDays: number;
		directory: string;
	};
	mail: {
		enabled: boolean;
		smtp: {
			host: string;
			port: number;
			secure: boolean;
			username: string;
			password?: string;
			passwordConfigured: boolean;
			from: string;
		};
	};
	captcha: {
		provider: "image" | "turnstile" | "hcaptcha" | "recaptcha" | "geetest";
		image: {
			width: number;
			height: number;
			ttlSec: number;
		};
		turnstile: {
			siteKey: string;
			secretKey?: string;
			secretKeyConfigured: boolean;
			expectedAction: string;
			expectedHostname?: string;
		};
		hcaptcha: {
			siteKey: string;
			secretKey?: string;
			secretKeyConfigured: boolean;
			expectedHostname?: string;
		};
		recaptcha: {
			variant: "score_based" | "policy_based_challenge";
			projectId: string;
			siteKey: string;
			apiKey?: string;
			apiKeyConfigured: boolean;
			expectedAction: string;
			expectedHostname?: string;
			minScore: number;
		};
		geetest: {
			captchaId: string;
			captchaKey?: string;
			captchaKeyConfigured: boolean;
			apiServer: string;
		};
	};
	ipRegion: {
		enabled: boolean;
		cachePolicy: "file" | "vectorIndex" | "content";
		precision: "country" | "province" | "city";
		autoUpdate: {
			enabled: boolean;
			schedule: "monthly";
		};
		ipv4: {
			dbPath: string;
			sources: string[];
		};
		ipv6: {
			dbPath: string;
			sources: string[];
		};
	};
	avatar: {
		gravatar: {
			enabled: boolean;
			baseUrl: string;
		};
	};
	antiSpam: {
		akismet: {
			apiKey?: string;
			apiKeyConfigured: boolean;
		};
	};
}

function queryString(input: Record<string, string | number | undefined>) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(input)) {
		if (value !== undefined && value !== "") {
			params.set(key, String(value));
		}
	}

	return params.toString();
}

export function listComments(input: {
	siteKey?: string;
	pageKey?: string;
	status?: CommentStatus;
	statusGroup?: "hidden";
	search?: string;
	limit?: number;
	offset?: number;
}) {
	return requestJson<Page<AdminComment>>(
		`/api/admin/comments?${queryString(input)}`,
	);
}

export function updateComment(
	commentId: string,
	input: Partial<Pick<AdminComment, "status" | "isPinned" | "isFolded">> & {
		contentRaw?: string;
	},
) {
	return requestJson<{ comment: AdminComment }>(
		`/api/admin/comments/${encodeURIComponent(commentId)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
	);
}

export function deleteComment(commentId: string) {
	return requestJson<{ comment: AdminComment }>(
		`/api/admin/comments/${encodeURIComponent(commentId)}`,
		{
			method: "DELETE",
		},
	);
}

export function replyToComment(
	commentId: string,
	input: { content: { raw: string } },
) {
	return requestJson<{ comment: unknown }>(
		`/api/admin/comments/${encodeURIComponent(commentId)}/reply`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function listPages(input: {
	siteKey?: string;
	search?: string;
	limit?: number;
	offset?: number;
}) {
	return requestJson<Page<AdminPage>>(`/api/admin/pages?${queryString(input)}`);
}

export function listUsers(input: {
	siteKey?: string;
	search?: string;
	limit?: number;
	offset?: number;
}) {
	return requestJson<Page<AdminUser>>(`/api/admin/users?${queryString(input)}`);
}

export function listVisitors(input: {
	siteKey?: string;
	search?: string;
	limit?: number;
	offset?: number;
}) {
	return requestJson<Page<AdminVisitor>>(
		`/api/admin/visitors?${queryString(input)}`,
	);
}

export function listBlacklist(siteKey?: string) {
	const suffix = siteKey ? `?${queryString({ siteKey })}` : "";
	return requestJson<{ items: AdminBlacklistRule[] }>(
		`/api/admin/blacklist${suffix}`,
	);
}

export function createBlacklist(input: {
	siteKey?: string;
	targetType: "ip" | "email" | "visitor";
	matchMode: "exact" | "cidr" | "wildcard";
	targetValue: string;
	scope: "post" | "all";
	reason?: string;
	expiresAt?: string;
}) {
	return requestJson<{ rule: AdminBlacklistRule }>("/api/admin/blacklist", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function deleteBlacklist(ruleId: number) {
	return requestJson<{ rule: AdminBlacklistRule }>(
		`/api/admin/blacklist/${ruleId}`,
		{
			method: "DELETE",
		},
	);
}

export function deleteBlacklistTarget(input: {
	siteKey?: string;
	targetType: "ip" | "email" | "visitor";
	matchMode: "exact" | "cidr" | "wildcard";
	targetValue: string;
}) {
	return requestJson<{ rules: AdminBlacklistRule[] }>(
		"/api/admin/blacklist/target",
		{
			method: "DELETE",
			body: JSON.stringify(input),
		},
	);
}

export function listSites() {
	return requestJson<{ items: AdminSite[] }>("/api/admin/sites");
}

export function createSite(input: {
	siteKey: string;
	name: string;
	allowedOrigins: string[];
}) {
	return requestJson<{ items: AdminSite[] }>("/api/admin/sites", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function updateSite(
	siteKey: string,
	input: {
		name?: string;
		allowedOrigins?: string[];
	},
) {
	return requestJson<{ items: AdminSite[] }>(
		`/api/admin/sites/${encodeURIComponent(siteKey)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
	);
}

export function getSettings(siteKey: string) {
	return requestJson<AdminSettings>(
		`/api/admin/sites/${encodeURIComponent(siteKey)}/settings`,
	);
}

export function updateSettings(siteKey: string, input: Partial<AdminSettings>) {
	return requestJson<AdminSettings>(
		`/api/admin/sites/${encodeURIComponent(siteKey)}/settings`,
		{
			method: "PUT",
			body: JSON.stringify(input),
		},
	);
}

export function getSystemSettings() {
	return requestJson<AdminSystemSettings>("/api/admin/system-settings");
}

export function updateSystemSettings(input: AdminSystemSettings) {
	return requestJson<AdminSystemSettings>("/api/admin/system-settings", {
		method: "PUT",
		body: JSON.stringify(input),
	});
}
