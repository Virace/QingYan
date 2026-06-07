import { requestJson } from "./client";
import type { TaskRunProjection } from "./tasks";

export interface Page<T> {
	items: T[];
	pagination: {
		limit: number;
		offset: number;
		totalCount: number;
	};
}

export type CommentStatus = "pending" | "approved" | "spam" | "trash";
export type PageRegistryStatus =
	| "active"
	| "stale"
	| "unreachable"
	| "not_found"
	| "trash"
	| "deleted"
	| "ignored";
export type PendingPageStatus = "pending" | "approved" | "rejected" | "ignored";
export type AdminPageSortBy =
	| "updatedAt"
	| "createdAt"
	| "commentCount"
	| "visitorCount"
	| "commenterCount"
	| "pageLikeCount"
	| "title"
	| "pageKey";
export type AdminPageSortOrder = "asc" | "desc";
export type ModerationMode =
	| "none"
	| "akismet_auto"
	| "manual_with_akismet"
	| "manual";

export interface SiteModerationSettings {
	mode: ModerationMode;
	provider: "none" | "akismet";
	akismet: {
		failPolicy: "pending";
		discardBlatantSpam: boolean;
	};
}

export interface AdminRequestMetaDisplay {
	ip: {
		raw: string | null;
		location: {
			label: string;
			country: string | null;
			region: string | null;
			city: string | null;
			isp: string | null;
			source: string | null;
			updatedAt: string | null;
			error: string | null;
		} | null;
	};
	userAgent: {
		raw: string | null;
		device: {
			label: string;
			browser: string;
			browserVersion: string | null;
			os: string;
			osVersion: string | null;
			type: string;
			icon: string | null;
			source: string | null;
			updatedAt: string | null;
			error: string | null;
		} | null;
	};
}

export interface AdminRequestMetaAggregate {
	key: string;
	label: string;
	count: number;
	distinctIpCount?: number;
}

export interface AdminComment {
	id: string;
	parentId: string | null;
	status: CommentStatus;
	authorName: string;
	authorEmail: string | null;
	authorAvatarUrl: string | null;
	authorIp: string | null;
	authorUserAgent: string | null;
	requestMeta: AdminRequestMetaDisplay;
	authorIpLocation: {
		country: string | null;
		region: string | null;
		city: string | null;
		isp: string | null;
		raw: string | null;
		source: string | null;
		dbHash: string | null;
		updatedAt: string | null;
		error: string | null;
	};
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
	siteKey: string;
	pageKey: string;
	pageTitle: string | null;
	pageUrl: string | null;
}

export interface AdminPage {
	siteKey: string;
	pageKey: string;
	status: PageRegistryStatus;
	pageTitle: string | null;
	pageUrl: string | null;
	commentCount: number;
	rootCommentCount: number;
	pageLikeCount: number;
	updatedAt: string;
	createdAt: string;
	trashedAt: string | null;
	deletedAt: string | null;
	titleRefreshAttemptedAt?: string | null;
	titleRefreshedAt?: string | null;
	titleRefreshStatusCode?: number | null;
	titleRefreshError?: string | null;
	visitorCount: number;
	commenterCount: number;
	engagement?: AdminEngagementSummary;
}

export interface AdminEngagementSummary {
	trustMode: "trusted" | "lightweight";
	visitorsEnabled: boolean;
	pageViewsEnabled: boolean;
	pageLikesEnabled: boolean;
	commentVotesEnabled: boolean;
}

export interface PendingPageCandidate {
	id: number;
	siteKey: string;
	pageKey: string;
	pageUrl: string;
	firstSeenAt: string;
	lastSeenAt: string;
	hitCount: number;
	status: PendingPageStatus;
	lastRejectReason: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AdminCommenter {
	email: string;
	emailVariants: string[];
	names: string[];
	commentCount: number;
	pendingCount: number;
	approvedCount: number;
	lastCommentAt: string | null;
	pageCount: number;
	siteCount: number;
	ips: string[];
	userAgents: string[];
	ipLocations: AdminRequestMetaAggregate[];
	devices: AdminRequestMetaAggregate[];
	blacklist: {
		email: boolean;
	};
	isBlacklisted: boolean;
	notifications?: {
		notifyOnReply?: boolean | null;
		unsubscribedAt?: string | null;
		suppressedUntil?: string | null;
		reputationScore?: number | null;
		lastSuccessAt?: string | null;
		lastFailureAt?: string | null;
	};
}

export type NotificationChannel = "email" | "webhook" | "wxpusher";
export type NotificationTemplateFormat = "html" | "text" | "json";
export type SiteNotificationEvent =
	| "admin_comment_pending"
	| "admin_comment_approved";
export type NotificationContentPolicy = "none" | "summary" | "full";

export interface NotificationChannelConfig {
	id: string;
	type: NotificationChannel;
	name: string;
	description: string | null;
	enabled: boolean;
	config: Record<string, unknown>;
	secretConfig?: Record<string, unknown>;
	secretConfigured?: boolean;
	createdAt?: string | null;
	updatedAt?: string | null;
}

export interface SiteNotificationRoute {
	id?: string;
	eventType: SiteNotificationEvent;
	channelConfigId: string;
	channelType?: NotificationChannel;
	channelName?: string;
	enabled: boolean;
}

export interface SiteNotificationRecipient {
	id?: string;
	userId: number;
	username: string;
	email: string;
	displayName: string;
	channels: NotificationChannel[];
	events: SiteNotificationEvent[];
	routes: SiteNotificationRoute[];
	includeCommentContent: NotificationContentPolicy;
	rateLimitProfile: string | null;
	enabled: boolean;
}

export interface NotificationTemplate {
	key: string;
	name: string;
	description: string;
	channel: NotificationChannel;
	channelLabel: string;
	channelDescription: string;
	eventType: string;
	eventLabel: string;
	eventDescription: string;
	triggerDescription: string;
	recipientType: string;
	placeholders: NotificationTemplatePlaceholder[];
	format: NotificationTemplateFormat;
	formatLabel: string;
	supportsSubject: boolean;
	subjectTemplate: string | null;
	bodyTemplate: string;
	isCustomized: boolean;
	updatedAt: string | null;
	updatedByUserId: number | null;
}

export interface NotificationTemplatePlaceholder {
	path: string;
	label: string;
	description: string;
	jsonSupported: boolean;
}

export interface RenderedNotificationTemplate {
	subject?: string;
	body: string;
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
	lastIp: string | null;
	lastUserAgent: string | null;
	lastRequestMeta: AdminRequestMetaDisplay;
	ipLocations: AdminRequestMetaAggregate[];
	devices: AdminRequestMetaAggregate[];
	lastSeenPageKey: string | null;
	lastSeenPageUrl: string | null;
	blacklist: {
		ip: boolean;
		visitor: boolean;
	};
}

export type AdminVisitorsPage = Page<AdminVisitor> & {
	enabled: boolean;
	trustMode: "trusted" | "lightweight";
	message?: string;
};

export interface AdminEngagementSettings {
	visitors: {
		enabled: boolean;
	};
	pageViews: {
		enabled: boolean;
	};
	pageLikes: {
		enabled: boolean;
	};
	commentVotes: {
		enabled: boolean;
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
	engagement: AdminEngagementSettings & AdminEngagementSummary;
	notifications: {
		commenter: {
			replyEmailEnabled: boolean;
		};
		backend: {
			enabled: boolean;
			recipients?: SiteNotificationRecipient[];
		};
		channelConfigs: NotificationChannelConfig[];
	};
	pageCount: number;
	commentCount: number;
	commenterCount: number;
	visitorCount: number;
}

export type AdminGroupKey = "admin" | "site_admin" | "site_moderator";

export interface AdminUser {
	id: number;
	username: string;
	email: string;
	displayName: string;
	status: "active" | "disabled" | "deleted";
	groupKey: AdminGroupKey;
	groupName: string;
	siteKeys: string[];
	isInitialAdmin: boolean;
	passwordChangeRequired: boolean;
	loginBlockedUntil: string | null;
	activeSessionCount: number;
	lastSessionSeenAt: string | null;
	lastLoginAt: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface AdminGroup {
	id: number;
	key: AdminGroupKey;
	name: string;
	description: string | null;
	kind: "system";
	permissions: string[];
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
		staffDisplay: {
			nameMode: "current_profile" | "snapshot";
		};
	};
	pageFeedback: {
		allowLike: boolean;
	};
	engagement: AdminEngagementSettings;
	pageRegistry: {
		mode: "discovery" | "authoritative";
		authoritativeSitemapUrls: string[];
		unknownPageResponse: "inactive_payload" | "forbidden";
		requireHealthySource: boolean;
		sourceFreshnessGraceSec: number;
		emergencyLockdown: boolean;
	};
	notifications: {
		commenter: {
			replyEmailEnabled: boolean;
		};
		backend: {
			enabled: boolean;
			recipients?: SiteNotificationRecipient[];
		};
		channelConfigs: NotificationChannelConfig[];
	};
}

export interface AdminSystemSettings {
	admin: {
		session: {
			ttlMinutes: number;
		};
		emailVerification: {
			selfServiceRequired: boolean;
		};
		deletion: {
			retentionDays: number;
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
	notifications: {
		delivery: {
			globalMaxPerMinute: number;
			perChannelMaxPerMinute: number;
			perSiteMaxPerHour: number;
			perRecipientMinIntervalSec: number;
			dailyChannelBudget: number;
			lowPriorityDelaySec: number;
			queueBackend: "database" | "bullmq";
		};
		webhook: {
			enabled: boolean;
			url: string;
			secret?: string;
			secretConfigured: boolean;
		};
		wxpusher: {
			enabled: boolean;
			appToken?: string;
			appTokenConfigured: boolean;
			apiUrl: string;
		};
		channelConfigs: NotificationChannelConfig[];
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
		external: {
			enabled: boolean;
			baseUrl: string;
			hashAlgorithm: "sha256" | "md5";
			query: string;
		};
		display: {
			shape: "circle" | "rounded" | "square";
			sizePx: number;
		};
	};
	publicApi: {
		advisoryFields: {
			enabled: boolean;
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

export function refreshCommentMetadata(commentId: string) {
	return requestJson<{ metadata: unknown }>(
		`/api/admin/comments/${encodeURIComponent(commentId)}/metadata/refresh`,
		{
			method: "POST",
		},
	);
}

export function bulkTrashComments(commentIds: string[]) {
	return requestJson<{ comments: AdminComment[]; updatedCount: number }>(
		"/api/admin/comments/bulk-trash",
		{
			method: "POST",
			body: JSON.stringify({ commentIds }),
		},
	);
}

export function bulkUpdateComments(input: {
	commentIds: string[];
	patch: Partial<Pick<AdminComment, "status" | "isPinned" | "isFolded">> & {
		contentRaw?: string;
	};
}) {
	return requestJson<{ comments: AdminComment[]; updatedCount: number }>(
		"/api/admin/comments/bulk-update",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function refreshSelectedCommentMetadata(commentIds: string[]) {
	return requestJson<{
		refreshedCount: number;
		failedCount: number;
		items: unknown[];
	}>("/api/admin/comments/metadata/refresh", {
		method: "POST",
		body: JSON.stringify({ commentIds }),
	});
}

export function clearTrash(input: { siteKey?: string }) {
	return requestJson<{ deletedCount: number }>(
		"/api/admin/comments/trash/clear",
		{
			method: "POST",
			body: JSON.stringify(input),
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
	status?: PageRegistryStatus;
	sortBy?: AdminPageSortBy;
	sortOrder?: AdminPageSortOrder;
	limit?: number;
	offset?: number;
}) {
	return requestJson<Page<AdminPage>>(`/api/admin/pages?${queryString(input)}`);
}

export function trashPage(input: { pageKey: string; siteKey?: string }) {
	return requestJson<{ page: AdminPage }>(
		`/api/admin/pages/${encodeURIComponent(input.pageKey)}/trash`,
		{
			method: "POST",
			body: JSON.stringify({ siteKey: input.siteKey }),
		},
	);
}

export function restorePage(input: { pageKey: string; siteKey?: string }) {
	return requestJson<{ page: AdminPage }>(
		`/api/admin/pages/${encodeURIComponent(input.pageKey)}/restore`,
		{
			method: "POST",
			body: JSON.stringify({ siteKey: input.siteKey }),
		},
	);
}

export function deletePage(input: { pageKey: string; siteKey?: string }) {
	return requestJson<{ page: AdminPage }>(
		`/api/admin/pages/${encodeURIComponent(input.pageKey)}/delete`,
		{
			method: "POST",
			body: JSON.stringify({ siteKey: input.siteKey }),
		},
	);
}

export function clearPageTrash(input: { siteKey?: string }) {
	return requestJson<{
		deletedCount: number;
		deletion: {
			mode: "delayed" | "immediate";
			resourceCount: number;
			hardDeleteAfter?: string;
		};
	}>("/api/admin/pages/trash/clear", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function refreshPageTitle(input: { pageKey: string; siteKey: string }) {
	return requestJson<{ run: TaskRunProjection }>(
		`/api/admin/pages/${encodeURIComponent(input.pageKey)}/title/refresh`,
		{
			method: "POST",
			body: JSON.stringify({ siteKey: input.siteKey }),
		},
	);
}

export function listPendingPages(input: {
	siteKey?: string;
	search?: string;
	status?: PendingPageStatus;
	limit?: number;
	offset?: number;
}) {
	return requestJson<Page<PendingPageCandidate>>(
		`/api/admin/page-registry/pending?${queryString(input)}`,
	);
}

export function approvePendingPage(input: {
	siteKey: string;
	pageKey: string;
}) {
	return requestJson<{ page: AdminPage }>(
		"/api/admin/page-registry/pending/approve",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function rejectPendingPage(input: {
	siteKey: string;
	pageKey: string;
	reason?: string;
}) {
	return requestJson<{ candidate: PendingPageCandidate }>(
		"/api/admin/page-registry/pending/reject",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function ignorePendingPage(input: {
	siteKey: string;
	pageKey: string;
	reason?: string;
}) {
	return requestJson<{
		candidate: PendingPageCandidate;
		page: AdminPage;
	}>("/api/admin/page-registry/pending/ignore", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function listCommenters(input: {
	siteKey?: string;
	search?: string;
	limit?: number;
	offset?: number;
}) {
	return requestJson<Page<AdminCommenter>>(
		`/api/admin/commenters?${queryString(input)}`,
	);
}

export function listVisitors(input: {
	siteKey?: string;
	search?: string;
	ip?: string;
	userAgent?: string;
	pageUrl?: string;
	device?: string;
	location?: string;
	blacklist?: "any" | "ip" | "visitor" | "none";
	limit?: number;
	offset?: number;
}) {
	return requestJson<AdminVisitorsPage>(
		`/api/admin/visitors?${queryString(input)}`,
	);
}

export function listBlacklist(input: {
	siteKey?: string;
	search?: string;
	limit?: number;
	offset?: number;
}) {
	return requestJson<Page<AdminBlacklistRule>>(
		`/api/admin/blacklist?${queryString(input)}`,
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

export type AdminSiteSettingsSection =
	| "comments"
	| "engagement"
	| "notifications"
	| "pageRegistry";

export function patchAdminSiteSettingsSection(
	siteKey: string,
	section: AdminSiteSettingsSection,
	input: unknown,
) {
	return requestJson<AdminSettings>(
		`/api/admin/settings/${encodeURIComponent(siteKey)}/sections/${encodeURIComponent(section)}`,
		{
			method: "PATCH",
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

export type AdminSystemSettingsSection =
	| "security"
	| "rate-limit"
	| "mail"
	| "notifications"
	| "captcha"
	| "avatar"
	| "ip-region"
	| "anti-spam";

export function patchAdminSystemSettingsSection(
	section: AdminSystemSettingsSection,
	input: unknown,
) {
	return requestJson<AdminSystemSettings>(
		`/api/admin/system-settings/sections/${encodeURIComponent(section)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
	);
}

export function testNotificationChannel(input: {
	channel?: NotificationChannel;
	channelConfigId?: string;
	recipient?: string;
	siteKey?: string;
}) {
	return requestJson<{
		taskId: string;
		deliveryId: string;
		queueBackend: "database" | "bullmq";
		channelConfigId: string;
		channelType: NotificationChannel;
		channelName: string;
		channel: NotificationChannel;
		recipient: string;
	}>("/api/admin/system-settings/notifications/channel-test", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function testSystemMail(input: { recipient?: string } = {}) {
	return requestJson<{
		status: "sent";
		taskId: string;
		deliveryId: string;
		channel: "email";
		recipient: string;
		providerMessageId?: string;
		message: string;
	}>("/api/admin/system-settings/mail/test", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function listNotificationTemplates() {
	return requestJson<{ templates: NotificationTemplate[] }>(
		"/api/admin/notification-templates",
	);
}

export function updateNotificationTemplate(
	templateKey: string,
	input: {
		format: NotificationTemplateFormat;
		subjectTemplate?: string | null;
		bodyTemplate: string;
	},
) {
	return requestJson<{ template: NotificationTemplate }>(
		`/api/admin/notification-templates/${encodeURIComponent(templateKey)}`,
		{
			method: "PUT",
			body: JSON.stringify(input),
		},
	);
}

export function previewNotificationTemplate(
	templateKey: string,
	input: Partial<{
		format: NotificationTemplateFormat;
		subjectTemplate: string | null;
		bodyTemplate: string;
	}> = {},
) {
	return requestJson<{ rendered: RenderedNotificationTemplate }>(
		`/api/admin/notification-templates/${encodeURIComponent(
			templateKey,
		)}/preview`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function restoreNotificationTemplateDefault(templateKey: string) {
	return requestJson<{ template: NotificationTemplate }>(
		`/api/admin/notification-templates/${encodeURIComponent(
			templateKey,
		)}/restore-default`,
		{
			method: "POST",
			body: JSON.stringify({}),
		},
	);
}

export function testNotificationTemplate(
	templateKey: string,
	input: { recipient?: string } = {},
) {
	return requestJson<{
		taskId: string;
		deliveryId: string;
		queueBackend: "database" | "bullmq";
		channel: NotificationChannel;
		recipient: string;
		preview: RenderedNotificationTemplate;
	}>(
		`/api/admin/notification-templates/${encodeURIComponent(
			templateKey,
		)}/test-send`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function listAdminUsers(
	input: { search?: string; limit?: number; offset?: number } = {},
) {
	return requestJson<{ users: AdminUser[] }>(
		`/api/admin/users?${queryString(input)}`,
	);
}

export function createAdminUser(input: {
	username: string;
	email: string;
	displayName: string;
	password: string;
	groupKey: AdminGroupKey;
	siteKeys: string[];
	passwordChangeRequired: boolean;
}) {
	return requestJson<{ user: AdminUser }>("/api/admin/users", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function updateAdminUser(
	userId: number,
	input: Partial<{
		email: string;
		displayName: string;
		groupKey: AdminGroupKey;
		siteKeys: string[];
		status: "active" | "disabled" | "deleted";
		passwordChangeRequired: boolean;
	}>,
) {
	return requestJson<{ user: AdminUser; revokedSessions: number }>(
		`/api/admin/users/${userId}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
	);
}

export function resetAdminUserPassword(
	userId: number,
	input: {
		password: string;
		passwordChangeRequired: boolean;
	},
) {
	return requestJson<{ user: AdminUser; revokedSessions: number }>(
		`/api/admin/users/${userId}/reset-password`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function revokeAdminUserSessions(
	userId: number,
	input: {
		loginBlockPreset: "none" | "1h" | "1d" | "7d" | "custom";
		loginBlockedUntil?: string;
		reason?: string;
	},
) {
	return requestJson<{ user: AdminUser; revokedSessions: number }>(
		`/api/admin/users/${userId}/revoke-sessions`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function deleteAdminUser(userId: number) {
	return requestJson<{ user: AdminUser; revokedSessions: number }>(
		`/api/admin/users/${userId}`,
		{
			method: "DELETE",
		},
	);
}

export function listAdminGroups() {
	return requestJson<{ groups: AdminGroup[] }>("/api/admin/groups");
}
