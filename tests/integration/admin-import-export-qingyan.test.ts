import { describe, expect, it } from "vitest";

import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

function qingyanExportPayload() {
	return {
		format: "qingyan.export.v1",
		formatVersion: 1,
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
			runtimeSettings: null,
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
	it("exports a site-scoped qingyan.export.v1 logical JSON without runtime session data", async () => {
		const fixture = await createTestApp();
		const { adminCookie } = await loginAsAdmin(fixture.app);

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
			url: "/api/admin/import-export/export",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				siteKey: "fangyuan",
				format: "qingyan.export.v1",
				include: {
					runtimeSettings: true,
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
			formatVersion: 1,
			scope: {
				type: "site",
				siteKey: "fangyuan",
			},
			data: {
				site: {
					siteKey: "fangyuan",
					name: "FangYuan",
				},
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

	it("dry-runs and applies a qingyan.export.v1 JSON import", async () => {
		const fixture = await createTestApp();
		const { adminCookie } = await loginAsAdmin(fixture.app);
		const payload = qingyanExportPayload();

		const dryRunResponse = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/import-export/qingyan/dry-run",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				siteKey: "fangyuan",
				fileName: "qingyan-export.json",
				payload,
				existingStrategy: "fail_on_existing",
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
			},
		});

		const jobId = dryRunResponse.json().job.id as string;
		const applyResponse = await fixture.app.inject({
			method: "POST",
			url: `/api/admin/import-export/qingyan/jobs/${jobId}/apply`,
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				existingStrategy: "fail_on_existing",
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
				},
			},
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
	});

	it("uses import records to block or skip repeated QingYan comments", async () => {
		const fixture = await createTestApp();
		const { adminCookie } = await loginAsAdmin(fixture.app);
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
			url: "/api/admin/import-export/qingyan/dry-run",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				siteKey: "fangyuan",
				fileName: "qingyan-export.json",
				payload,
				existingStrategy: "fail_on_existing",
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
			url: "/api/admin/import-export/qingyan/dry-run",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				siteKey: "fangyuan",
				fileName: "qingyan-export.json",
				payload,
				existingStrategy: "skip_existing",
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
		const { adminCookie } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/import-export/qingyan/dry-run",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
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
