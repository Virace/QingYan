import type { SqliteClient } from "../../../db/client";
import { secretSystemSettingPaths } from "../../system-settings/definitions";
import {
	QINGYAN_EXPORT_FORMAT,
	QINGYAN_EXPORT_FORMAT_VERSION,
} from "./export-model";

export interface ExportInclude {
	siteSettings?: boolean;
	systemSettings?: boolean;
	pageThreads?: boolean;
	comments?: boolean;
	visitors?: boolean;
	voteRecords?: boolean;
	pageFeedbackRecords?: boolean;
	blacklistRules?: boolean;
}

interface SiteRow {
	id: number;
	site_key: string;
	name: string;
	allowed_origins_json: string;
}

function isSecretSystemSetting(row: { category: string; key: string }) {
	return secretSystemSettingPaths.has(`${row.category}.${row.key}`);
}

export class QingYanExportService {
	public constructor(private readonly sqlite: SqliteClient) {}

	public exportSite(input: { siteKey: string; include?: ExportInclude }) {
		const site = this.getSite(input.siteKey);
		const include = input.include ?? {};
		return {
			format: QINGYAN_EXPORT_FORMAT,
			formatVersion: QINGYAN_EXPORT_FORMAT_VERSION,
			createdAt: new Date().toISOString(),
			generator: {
				name: "QingYan",
				version: "0.1.0",
			},
			scope: {
				type: "site" as const,
				siteKey: site.site_key,
			},
			schema: {
				entitiesVersion: 1,
				sourceDatabase: "sqlite",
				sourceMigrations: [],
			},
			data: {
				site: {
					siteKey: site.site_key,
					name: site.name,
					allowedOrigins: JSON.parse(site.allowed_origins_json) as string[],
				},
				siteSettings: include.siteSettings
					? this.exportSiteSettings(site.id)
					: null,
				systemSettings: include.systemSettings
					? this.exportSystemSettings()
					: null,
				pageThreads: include.pageThreads ? this.exportPageThreads(site.id) : [],
				visitors: include.visitors ? this.exportVisitors(site.id) : [],
				comments: include.comments ? this.exportComments(site.id) : [],
				voteRecords: include.voteRecords ? this.exportVoteRecords(site.id) : [],
				pageFeedbackRecords: include.pageFeedbackRecords
					? this.exportPageFeedback(site.id)
					: [],
				blacklistRules: include.blacklistRules
					? this.exportBlacklistRules(site.id)
					: [],
			},
		};
	}

	private getSite(siteKey: string) {
		const site = this.sqlite
			.prepare(
				"SELECT id, site_key, name, allowed_origins_json FROM sites WHERE site_key = ?",
			)
			.get(siteKey) as SiteRow | undefined;
		if (!site) {
			throw new Error("SITE_NOT_FOUND");
		}
		return site;
	}

	private exportSiteSettings(siteId: number) {
		return (
			this.sqlite
				.prepare("SELECT * FROM site_settings WHERE site_id = ?")
				.get(siteId) ?? null
		);
	}

	private exportSystemSettings() {
		const rows = this.sqlite
			.prepare(
				`SELECT category, key, value_json, updated_at
				FROM system_settings
				ORDER BY category, key`,
			)
			.all() as Array<{
			category: string;
			key: string;
			value_json: string;
			updated_at: string;
		}>;
		return rows.filter((row) => !isSecretSystemSetting(row));
	}

	private exportPageThreads(siteId: number) {
		const rows = this.sqlite
			.prepare("SELECT * FROM page_threads WHERE site_id = ? ORDER BY id")
			.all(siteId) as Array<Record<string, unknown>>;
		return rows.map((row) => ({
			id: String(row.id),
			source: {
				type: "qingyan",
				id: String(row.id),
			},
			siteKey: this.getSiteKey(siteId),
			pageKey: row.page_key,
			pageTitle: row.page_title ?? null,
			pageUrl: row.page_url ?? null,
			stats: {
				commentCount: row.comment_count,
				rootCommentCount: row.root_comment_count,
				pageViewCount: row.page_view_count,
				pageLikeCount: row.page_like_count,
			},
			timestamps: {
				createdAt: row.created_at,
				updatedAt: row.updated_at,
			},
		}));
	}

	private exportVisitors(siteId: number) {
		const rows = this.sqlite
			.prepare("SELECT * FROM visitors WHERE site_id = ? ORDER BY id")
			.all(siteId) as Array<Record<string, unknown>>;
		return rows.map((row) => ({
			id: String(row.id),
			source: {
				type: "qingyan",
				id: String(row.id),
			},
			siteKey: this.getSiteKey(siteId),
			visitorKey: row.visitor_key,
			ipHash: row.ip_hash ?? null,
			userAgentHash: row.user_agent_hash ?? null,
			timestamps: {
				createdAt: row.created_at,
				lastSeenAt: row.last_seen_at,
			},
		}));
	}

	private exportComments(siteId: number) {
		const rows = this.sqlite
			.prepare(
				`SELECT comments.*, page_threads.page_key, visitors.visitor_key
				FROM comments
				INNER JOIN page_threads ON page_threads.id = comments.page_thread_id
				LEFT JOIN visitors ON visitors.id = comments.visitor_id
				WHERE comments.site_id = ?
				ORDER BY comments.created_at, comments.id`,
			)
			.all(siteId) as Array<Record<string, unknown>>;
		return rows.map((row) => ({
			id: row.id,
			source: {
				type: "qingyan",
				id: String(row.id),
			},
			siteKey: this.getSiteKey(siteId),
			pageKey: row.page_key,
			parentId: row.parent_id ?? null,
			visitorKey: row.visitor_key ?? null,
			status: row.status,
			author: {
				name: row.author_name,
				email: row.author_email ?? null,
				website: row.author_website ?? null,
			},
			request: {
				ip: row.author_ip ?? null,
				userAgent: row.author_user_agent ?? null,
			},
			metadata: {
				ipRegion: {
					country: row.author_ip_country ?? null,
					region: row.author_ip_region ?? null,
					city: row.author_ip_city ?? null,
					isp: row.author_ip_isp ?? null,
					raw: row.author_ip_location_raw ?? null,
					source: row.author_ip_location_source ?? null,
				},
				device: {
					browser: row.author_device_browser ?? null,
					os: row.author_device_os ?? null,
					type: row.author_device_type ?? null,
					icon: row.author_device_icon ?? null,
					source: row.author_device_source ?? null,
				},
			},
			content: {
				raw: row.content_raw,
				html: row.content_html ?? null,
			},
			stats: {
				replyCount: row.reply_count,
				voteUpCount: row.vote_up_count,
				voteDownCount: row.vote_down_count,
			},
			flags: {
				isPinned: Boolean(row.is_pinned),
				isFolded: Boolean(row.is_folded),
			},
			timestamps: {
				createdAt: row.created_at,
				updatedAt: row.updated_at,
				deletedAt: row.deleted_at ?? null,
			},
			extensions: {},
		}));
	}

	private exportVoteRecords(siteId: number) {
		return this.sqlite
			.prepare(
				`SELECT vote_records.id, comments.id AS comment_id, visitors.visitor_key,
					vote_records.choice, vote_records.created_at
				FROM vote_records
				INNER JOIN comments ON comments.id = vote_records.comment_id
				INNER JOIN visitors ON visitors.id = vote_records.visitor_id
				WHERE comments.site_id = ?
				ORDER BY vote_records.id`,
			)
			.all(siteId);
	}

	private exportPageFeedback(siteId: number) {
		return this.sqlite
			.prepare(
				`SELECT page_feedback_records.id, page_threads.page_key,
					visitors.visitor_key, page_feedback_records.created_at
				FROM page_feedback_records
				INNER JOIN page_threads ON page_threads.id = page_feedback_records.page_thread_id
				INNER JOIN visitors ON visitors.id = page_feedback_records.visitor_id
				WHERE page_threads.site_id = ?
				ORDER BY page_feedback_records.id`,
			)
			.all(siteId);
	}

	private exportBlacklistRules(siteId: number) {
		return this.sqlite
			.prepare(
				`SELECT scope, target_type, target_value, match_mode, reason, source,
					expires_at, created_at
				FROM blacklist_rules
				WHERE site_id = ? OR site_id IS NULL
				ORDER BY id`,
			)
			.all(siteId);
	}

	private getSiteKey(siteId: number) {
		const site = this.sqlite
			.prepare("SELECT site_key FROM sites WHERE id = ?")
			.get(siteId) as { site_key: string };
		return site.site_key;
	}
}
