import { describe, expect, it } from "vitest";

import { comments, siteSettings } from "../../src/db/schema";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

function qingyanExportPayload() {
	return {
		format: "qingyan.export.v1",
		formatVersion: 2,
		createdAt: "2026-05-05T00:00:00.000Z",
		generator: {
			name: "QingYan",
			version: "0.1.0",
		},
		scope: {
			type: "site",
			siteKey: "fangyuan",
		},
		schema: {
			entitiesVersion: 1,
			sourceDatabase: "sqlite",
			sourceMigrations: [],
		},
		data: {
			site: {
				siteKey: "fangyuan",
				name: "FangYuan",
				allowedOrigins: ["http://localhost:4321"],
			},
			siteSettings: {
				comments_enabled: 0,
				default_status: "approved",
				max_depth: 2,
				root_limit: 10,
				comment_require_json: '["nickname"]',
				allow_website: 0,
				allow_page_like: 0,
				captcha_mode: "never",
				captcha_threshold_window_sec: 60,
				captcha_threshold_max_actions: 3,
				abuse_guard_enabled: 1,
				abuse_guard_window_sec: 600,
				abuse_guard_max_write_actions: 100,
				auto_blacklist_enabled: 1,
				auto_blacklist_scope: "post",
				auto_blacklist_ttl_sec: 1800,
				comment_metadata_json: null,
				email_notifications_enabled: 1,
			},
			systemSettings: [],
			pageThreads: [
				{
					id: "thread_1",
					source: {
						type: "qingyan",
						id: "1",
					},
					siteKey: "fangyuan",
					pageKey: "post/imported",
					pageTitle: "Imported",
					pageUrl: "/post/imported",
					stats: {
						commentCount: 1,
						rootCommentCount: 1,
						pageViewCount: 0,
						pageLikeCount: 0,
					},
					timestamps: {
						createdAt: "2026-05-05T00:00:00.000Z",
						updatedAt: "2026-05-05T00:00:00.000Z",
					},
				},
			],
			visitors: [
				{
					id: "visitor_1",
					source: {
						type: "qingyan",
						id: "1",
					},
					siteKey: "fangyuan",
					visitorKey: "visitor_exported",
					ipHash: "ip_hash",
					userAgentHash: "ua_hash",
					timestamps: {
						createdAt: "2026-05-05T00:00:00.000Z",
						lastSeenAt: "2026-05-05T00:00:00.000Z",
					},
				},
			],
			comments: [
				{
					id: "comment_1",
					source: {
						type: "qingyan",
						id: "c_source",
					},
					siteKey: "fangyuan",
					pageKey: "post/imported",
					parentId: null,
					visitorKey: "visitor_exported",
					status: "approved",
					author: {
						name: "Alice",
						email: "alice@example.com",
						website: "https://example.com",
					},
					request: {
						ip: "127.0.0.1",
						userAgent: "Vitest",
					},
					metadata: {},
					content: {
						raw: "hello from export",
						html: "<p>hello from export</p>",
					},
					stats: {
						replyCount: 0,
						voteUpCount: 0,
						voteDownCount: 0,
					},
					flags: {
						isPinned: false,
						isFolded: false,
					},
					timestamps: {
						createdAt: "2026-05-05T00:00:00.000Z",
						updatedAt: "2026-05-05T00:00:00.000Z",
						deletedAt: null,
					},
					extensions: {},
				},
			],
			voteRecords: [],
			pageFeedbackRecords: [
				{
					id: "feedback_1",
					source: {
						type: "qingyan",
						id: "1",
					},
					siteKey: "fangyuan",
					pageKey: "post/imported",
					visitorKey: "visitor_exported",
					timestamps: {
						createdAt: "2026-05-05T00:00:00.000Z",
					},
				},
			],
			blacklistRules: [
				{
					id: "blacklist_1",
					source: {
						type: "qingyan",
						id: "1",
					},
					siteKey: "fangyuan",
					scope: "site",
					targetType: "email",
					targetValue: "blocked@example.com",
					matchMode: "exact",
					reason: "imported",
					sourceName: "manual",
					expiresAt: null,
					createdAt: "2026-05-05T00:00:00.000Z",
				},
			],
		},
	};
}

describe("admin import/export QingYan routes", () => {
	it("rejects qingyan import when site allowedOrigins contains a path", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const payload = qingyanExportPayload();
		payload.data.site.allowedOrigins = ["https://admin.example.com/path"];

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/qingyan/dry-run",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				siteKey: "fangyuan",
				fileName: "bad-export.json",
				payload,
				existingStrategy: "fail_on_existing",
				importMode: "full_site",
				settingsStrategy: "replace_settings",
			},
		});

		expect(response.statusCode).toBe(400);
	});

	it("exports a site-scoped qingyan.export.v2 logical JSON without runtime session data", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		fixture.app.sqlite
			.prepare(
				`INSERT INTO page_threads (
					site_id, page_key, page_title, page_url, comment_count, root_comment_count
				) VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(1, "post/exported", "Exported", "/post/exported", 1, 1);
		const thread = fixture.app.sqlite
			.prepare("SELECT id FROM page_threads WHERE page_key = ?")
			.get("post/exported") as { id: number };
		fixture.app.sqlite
			.prepare(
				`INSERT INTO comments (
					id, site_id, page_thread_id, status, author_name, author_email, content_raw
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"c_exported",
				1,
				thread.id,
				"approved",
				"Alice",
				"alice@example.com",
				"hello",
			);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/export",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				siteKey: "fangyuan",
				format: "qingyan.export.v1",
				include: {
					siteSettings: true,
					systemSettings: true,
					pageThreads: true,
					comments: true,
					visitors: true,
					voteRecords: true,
					pageFeedbackRecords: true,
					blacklistRules: true,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("application/json");
		expect(response.headers["content-disposition"]).toContain(
			"qingyan-fangyuan-",
		);
		expect(response.json()).toMatchObject({
			format: "qingyan.export.v1",
			formatVersion: 2,
			scope: {
				type: "site",
				siteKey: "fangyuan",
			},
			data: {
				site: {
					siteKey: "fangyuan",
					name: "FangYuan",
				},
				siteSettings: {
					comments_enabled: 1,
					default_status: "pending",
				},
				systemSettings: [],
				pageThreads: [
					{
						pageKey: "post/exported",
						pageUrl: "/post/exported",
					},
				],
				comments: [
					{
						id: "c_exported",
						pageKey: "post/exported",
						author: {
							name: "Alice",
							email: "alice@example.com",
						},
						content: {
							raw: "hello",
						},
					},
				],
			},
		});
		expect(response.json().data.adminSessions).toBeUndefined();
		expect(response.json().data.captchaSessions).toBeUndefined();
		expect(response.json().data.adminBootstrapState).toBeUndefined();
	});

	it("dry-runs and applies a qingyan.export.v2 JSON data-only import", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const payload = qingyanExportPayload();

		const dryRunResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/qingyan/dry-run",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				siteKey: "fangyuan",
				fileName: "qingyan-export.json",
				payload,
				existingStrategy: "fail_on_existing",
				importMode: "data_only",
			},
		});

		expect(dryRunResponse.statusCode).toBe(200);
		expect(dryRunResponse.json()).toMatchObject({
			job: {
				status: "dry_run_passed",
			},
			dryRun: {
				summary: {
					willCreatePageThreads: 1,
					willCreateVisitors: 1,
					willCreateComments: 1,
					conflicts: 0,
				},
				settings: {
					status: "skipped",
				},
			},
		});

		const jobId = dryRunResponse.json().job.id as string;
		const applyResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/qingyan/jobs/${jobId}/apply`,
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				existingStrategy: "fail_on_existing",
				importMode: "data_only",
			},
		});

		expect(applyResponse.statusCode).toBe(200);
		expect(applyResponse.json()).toMatchObject({
			job: {
				id: jobId,
				status: "applied",
			},
			apply: {
				summary: {
					createdPageThreads: 1,
					createdVisitors: 1,
					createdComments: 1,
					createdPageFeedbackRecords: 1,
					createdBlacklistRules: 1,
					importRecordsCreated: 5,
					settingsUpdated: false,
				},
			},
			backup: {
				engine: "sqlite",
				strategy: "sqlite_backup_api",
			},
		});
		const backupJson = fixture.app.sqlite
			.prepare("SELECT backup_json FROM import_batches WHERE id = ?")
			.get(jobId) as { backup_json: string | null };
		expect(JSON.parse(backupJson.backup_json ?? "{}")).toMatchObject({
			engine: "sqlite",
			strategy: "sqlite_backup_api",
		});

		const comment = fixture.app.sqlite
			.prepare(
				`SELECT comments.id, comments.status, comments.author_name, comments.content_raw, page_threads.page_key
				FROM comments
				INNER JOIN page_threads ON page_threads.id = comments.page_thread_id
				WHERE page_threads.page_key = ?`,
			)
			.get("post/imported") as {
			id: string;
			status: string;
			author_name: string;
			content_raw: string;
			page_key: string;
		};
		expect(comment).toMatchObject({
			status: "approved",
			author_name: "Alice",
			content_raw: "hello from export",
			page_key: "post/imported",
		});
		const feedbackCount = fixture.app.sqlite
			.prepare("SELECT COUNT(*) AS value FROM page_feedback_records")
			.get() as { value: number };
		const blacklistCount = fixture.app.sqlite
			.prepare("SELECT COUNT(*) AS value FROM blacklist_rules")
			.get() as { value: number };
		expect(feedbackCount.value).toBe(1);
		expect(blacklistCount.value).toBe(1);
		const [settings] = await fixture.app.db.select().from(siteSettings);
		expect(settings).toMatchObject({
			defaultStatus: "pending",
			commentsEnabled: true,
		});
	});

	it("dry-runs and applies settings-only imports without comments", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const payload = qingyanExportPayload();

		const conflictResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/qingyan/dry-run",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				siteKey: "fangyuan",
				fileName: "settings.json",
				payload,
				existingStrategy: "fail_on_existing",
				importMode: "settings_only",
				settingsStrategy: "fail_on_existing",
			},
		});
		expect(conflictResponse.statusCode).toBe(200);
		expect(conflictResponse.json()).toMatchObject({
			job: {
				status: "dry_run_failed",
			},
			dryRun: {
				summary: {
					conflicts: 1,
					willCreateComments: 0,
				},
				settings: {
					status: "conflict",
					changes: expect.arrayContaining([
						expect.objectContaining({
							path: "siteSettings.default_status",
							action: "conflict",
						}),
					]),
				},
			},
		});

		const replaceResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/qingyan/dry-run",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				siteKey: "fangyuan",
				fileName: "settings.json",
				payload,
				existingStrategy: "fail_on_existing",
				importMode: "settings_only",
				settingsStrategy: "replace_settings",
			},
		});
		expect(replaceResponse.statusCode).toBe(200);
		expect(replaceResponse.json()).toMatchObject({
			job: {
				status: "dry_run_passed",
			},
			dryRun: {
				settings: {
					status: "replace",
				},
			},
		});

		const applyResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/qingyan/jobs/${replaceResponse.json().job.id}/apply`,
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				existingStrategy: "fail_on_existing",
				importMode: "settings_only",
				settingsStrategy: "replace_settings",
			},
		});
		expect(applyResponse.statusCode).toBe(200);
		expect(applyResponse.json()).toMatchObject({
			apply: {
				summary: {
					createdComments: 0,
					settingsUpdated: true,
				},
			},
		});
		expect(await fixture.app.db.select().from(comments)).toEqual([]);
		const [settings] = await fixture.app.db.select().from(siteSettings);
		expect(settings).toMatchObject({
			commentsEnabled: false,
			defaultStatus: "approved",
			maxDepth: 2,
			allowPageLike: false,
			emailNotificationsEnabled: true,
		});
	});

	it("uses import records to block or skip repeated QingYan comments", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const payload = qingyanExportPayload();

		fixture.app.sqlite
			.prepare(
				`INSERT INTO import_batches (
					id, site_id, source_type, source_file_name, source_hash, format,
					format_version, status, summary_json, options_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"previous_qingyan_batch",
				1,
				"qingyan-export",
				"previous.json",
				"hash",
				"qingyan.export.v1",
				1,
				"applied",
				"{}",
				"{}",
			);
		fixture.app.sqlite
			.prepare(
				`INSERT INTO import_records (
					batch_id, site_id, source_type, source_key, target_type, target_id, metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"previous_qingyan_batch",
				1,
				"qingyan-export",
				"qingyan:comment:c_source",
				"comment",
				"c_existing",
				"{}",
			);

		const conflictResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/qingyan/dry-run",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				siteKey: "fangyuan",
				fileName: "qingyan-export.json",
				payload,
				existingStrategy: "fail_on_existing",
				importMode: "data_only",
			},
		});

		expect(conflictResponse.statusCode).toBe(200);
		expect(conflictResponse.json()).toMatchObject({
			job: {
				status: "dry_run_failed",
			},
			dryRun: {
				summary: {
					conflicts: 1,
					willSkipExistingComments: 0,
				},
			},
		});

		const skipResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/qingyan/dry-run",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				siteKey: "fangyuan",
				fileName: "qingyan-export.json",
				payload,
				existingStrategy: "skip_existing",
				importMode: "data_only",
			},
		});

		expect(skipResponse.statusCode).toBe(200);
		expect(skipResponse.json()).toMatchObject({
			job: {
				status: "dry_run_passed",
			},
			dryRun: {
				summary: {
					conflicts: 0,
					willCreateComments: 0,
					willSkipExistingComments: 1,
				},
			},
		});
	});

	it("rejects unsupported future QingYan export versions", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/qingyan/dry-run",
			...withAdminWriteAuth({
				adminCookie,
				csrfToken,
			}),
			payload: {
				siteKey: "fangyuan",
				fileName: "future.json",
				payload: {
					...qingyanExportPayload(),
					formatVersion: 99,
				},
				existingStrategy: "fail_on_existing",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "INVALID_REQUEST",
			},
		});
		expect(response.json().error.details.message).toContain("formatVersion");
	});
});
