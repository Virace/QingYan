import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { pageThreads, sites } from "../../src/db/schema";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

function wxrFixture() {
	return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>x-item</title>
    <link>https://x-item.com</link>
    <wp:wxr_version>1.2</wp:wxr_version>
    <wp:base_blog_url>https://x-item.com</wp:base_blog_url>
    <item>
      <title>Termux</title>
      <link>https://x-item.com/termux.html</link>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:post_name>termux</wp:post_name>
      <wp:comment>
        <wp:comment_id>100</wp:comment_id>
        <wp:comment_author>Alice</wp:comment_author>
        <wp:comment_author_email>alice@example.com</wp:comment_author_email>
        <wp:comment_content>hello</wp:comment_content>
        <wp:comment_approved>1</wp:comment_approved>
        <wp:comment_type></wp:comment_type>
        <wp:comment_parent>0</wp:comment_parent>
      </wp:comment>
    </item>
  </channel>
</rss>`;
}

function largeWxrFixture() {
	return wxrFixture().replace(
		"hello",
		`hello ${"large-content ".repeat(90_000)}`,
	);
}

async function analyzeResolvedWordPressJob(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
	adminCookie: { value: string },
	csrfToken: string,
) {
	const response = await fixture.app.inject({
		method: "POST",
		url: "/qingyan/api/admin/import-export/wordpress/analyze",
		...withAdminWriteAuth({ adminCookie, csrfToken }),
		payload: {
			siteKey: "fangyuan",
			fileName: "wordpress.xml",
			xml: wxrFixture(),
			sourceBasePath: "/",
			mapping: {
				items: [
					{
						wpPostId: "1",
						decision: "map",
						target: {
							pageKey: "termux.html",
							pageUrl: "/termux.html",
						},
					},
				],
			},
		},
	});
	expect(response.statusCode).toBe(200);
	return response.json().job.id as string;
}

describe("admin import/export WordPress routes", () => {
	it("requires an admin session before analyzing WordPress comments", async () => {
		const fixture = await createTestApp();

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/wordpress/analyze",
			payload: {
				siteKey: "fangyuan",
				fileName: "wordpress.xml",
				xml: wxrFixture(),
			},
		});

		expect(response.statusCode).toBe(401);
	});

	it("analyzes uploaded WordPress WXR XML for an authenticated admin", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/wordpress/analyze",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				fileName: "wordpress.xml",
				xml: wxrFixture(),
				sourceBasePath: "/",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			job: {
				status: "analyzed",
			},
			report: {
				siteKey: "fangyuan",
				source: {
					type: "wordpress-wxr",
					fileName: "wordpress.xml",
				},
				summary: {
					totalItems: 1,
					totalComments: 1,
				},
			},
			suggestedMapping: {
				siteKey: "fangyuan",
				sourceBasePath: "/",
			},
		});
		expect(response.json().job.id).toMatch(/^wp_/);
	});

	it("uses existing page threads from the target site as WordPress mapping candidates", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected fangyuan site");
		}
		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "posts/termux/",
			pageTitle: "Imported Title",
			pageUrl: "https://x-item.com/termux.html",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/wordpress/analyze",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				fileName: "wordpress.xml",
				xml: wxrFixture(),
				sourceBasePath: "/",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().report.items[0]).toMatchObject({
			state: "ready",
			target: {
				pageKey: "posts/termux/",
				pageUrl: "https://x-item.com/termux.html",
				confidence: 95,
				source: "metadata",
			},
		});
	});

	it("accepts large WXR XML as the request body without the JSON body limit", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/wordpress/analyze?siteKey=fangyuan&fileName=large.xml&sourceBasePath=/",
			headers: {
				"content-type": "application/xml",
				...withAdminWriteAuth({ adminCookie, csrfToken }).headers,
			},
			cookies: withAdminWriteAuth({ adminCookie, csrfToken }).cookies,
			payload: largeWxrFixture(),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			report: {
				source: {
					fileName: "large.xml",
				},
				summary: {
					totalItems: 1,
					totalComments: 1,
				},
			},
		});
	});

	it("returns a clear invalid request error for invalid WXR XML", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/import-export/wordpress/analyze",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				fileName: "broken.xml",
				xml: "<rss>",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "INVALID_REQUEST",
			},
		});
		expect(response.json().error.message).toContain("WordPress WXR");
	});

	it("converts an analyzed resolved report to a persisted import plan and dry-runs it", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const jobId = await analyzeResolvedWordPressJob(
			fixture,
			adminCookie,
			csrfToken,
		);

		const planResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/wordpress/jobs/${jobId}/plan`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});

		expect(planResponse.statusCode).toBe(200);
		expect(planResponse.json()).toMatchObject({
			job: {
				id: jobId,
				status: "planned",
			},
			plan: {
				summary: {
					itemCount: 1,
					commentCount: 1,
				},
			},
		});

		const dryRunResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/jobs/${jobId}/dry-run`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				existingStrategy: "fail_on_existing",
			},
		});

		expect(dryRunResponse.statusCode).toBe(200);
		expect(dryRunResponse.json()).toMatchObject({
			job: {
				id: jobId,
				status: "dry_run_passed",
			},
			dryRun: {
				summary: {
					willCreatePageThreads: 1,
					willCreateComments: 1,
					willSkipExistingComments: 0,
					conflicts: 0,
				},
			},
		});
	});

	it("uses import records to mark repeated WordPress comments as skipped during dry-run", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const jobId = await analyzeResolvedWordPressJob(
			fixture,
			adminCookie,
			csrfToken,
		);

		const planResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/wordpress/jobs/${jobId}/plan`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});
		expect(planResponse.statusCode).toBe(200);

		fixture.app.sqlite
			.prepare(
				`INSERT INTO import_batches (
					id,
					site_id,
					source_type,
					source_file_name,
					source_hash,
					format,
					format_version,
					status,
					summary_json,
					options_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"previous_batch",
				1,
				"wordpress-wxr",
				"previous.xml",
				"hash",
				"wordpress-wxr",
				1,
				"applied",
				"{}",
				"{}",
			);
		fixture.app.sqlite
			.prepare(
				`INSERT INTO import_records (
					batch_id,
					site_id,
					source_type,
					source_key,
					target_type,
					target_id,
					metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"previous_batch",
				1,
				"wordpress-wxr",
				"wordpress:post:1:comment:100",
				"comment",
				"c_existing",
				"{}",
			);

		const dryRunResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/jobs/${jobId}/dry-run`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				existingStrategy: "skip_existing",
			},
		});

		expect(dryRunResponse.statusCode).toBe(200);
		expect(dryRunResponse.json()).toMatchObject({
			dryRun: {
				summary: {
					willCreateComments: 0,
					willSkipExistingComments: 1,
					conflicts: 0,
				},
			},
		});
	});

	it("applies a dry-run-passed WordPress import plan in one transaction", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const jobId = await analyzeResolvedWordPressJob(
			fixture,
			adminCookie,
			csrfToken,
		);

		const planResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/wordpress/jobs/${jobId}/plan`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});
		expect(planResponse.statusCode).toBe(200);

		const dryRunResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/jobs/${jobId}/dry-run`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				existingStrategy: "fail_on_existing",
			},
		});
		expect(dryRunResponse.statusCode).toBe(200);

		const applyResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/jobs/${jobId}/apply`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
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
					reusedPageThreads: 0,
					createdComments: 1,
					skippedExistingComments: 0,
					importRecordsCreated: 1,
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

		const thread = fixture.app.sqlite
			.prepare(
				"SELECT id, page_key, page_url, comment_count, root_comment_count FROM page_threads WHERE page_key = ?",
			)
			.get("termux.html") as {
			id: number;
			page_key: string;
			page_url: string;
			comment_count: number;
			root_comment_count: number;
		};
		expect(thread).toMatchObject({
			page_key: "termux.html",
			page_url: "/termux.html",
			comment_count: 1,
			root_comment_count: 1,
		});

		const comment = fixture.app.sqlite
			.prepare(
				"SELECT id, page_thread_id, status, author_name, author_email, content_raw FROM comments WHERE page_thread_id = ?",
			)
			.get(thread.id) as {
			id: string;
			page_thread_id: number;
			status: string;
			author_name: string;
			author_email: string;
			content_raw: string;
		};
		expect(comment).toMatchObject({
			page_thread_id: thread.id,
			status: "approved",
			author_name: "Alice",
			author_email: "alice@example.com",
			content_raw: "hello",
		});

		const record = fixture.app.sqlite
			.prepare(
				"SELECT source_key, target_type, target_id FROM import_records WHERE batch_id = ?",
			)
			.get(jobId) as {
			source_key: string;
			target_type: string;
			target_id: string;
		};
		expect(record).toEqual({
			source_key: "wordpress:post:1:comment:100",
			target_type: "comment",
			target_id: comment.id,
		});

		const jobsResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/import-export/jobs?siteKey=fangyuan",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(jobsResponse.statusCode).toBe(200);
		expect(jobsResponse.json()).toMatchObject({
			items: [
				{
					id: jobId,
					status: "applied",
					sourceType: "wordpress-wxr",
					backup: {
						engine: "sqlite",
						strategy: "sqlite_backup_api",
					},
				},
			],
		});

		const detailResponse = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/import-export/jobs/${jobId}`,
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(detailResponse.statusCode).toBe(200);
		expect(detailResponse.json()).toMatchObject({
			job: {
				id: jobId,
				backup: {
					engine: "sqlite",
					strategy: "sqlite_backup_api",
				},
			},
		});
	});

	it("does not write comments when applying a plan with unresolved dry-run conflicts", async () => {
		const fixture = await createTestApp();
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const jobId = await analyzeResolvedWordPressJob(
			fixture,
			adminCookie,
			csrfToken,
		);

		const planResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/wordpress/jobs/${jobId}/plan`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});
		expect(planResponse.statusCode).toBe(200);

		fixture.app.sqlite
			.prepare(
				`INSERT INTO import_batches (
					id,
					site_id,
					source_type,
					source_file_name,
					source_hash,
					format,
					format_version,
					status,
					summary_json,
					options_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"conflict_batch",
				1,
				"wordpress-wxr",
				"previous.xml",
				"hash",
				"wordpress-wxr",
				1,
				"applied",
				"{}",
				"{}",
			);
		fixture.app.sqlite
			.prepare(
				`INSERT INTO import_records (
					batch_id,
					site_id,
					source_type,
					source_key,
					target_type,
					target_id,
					metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"conflict_batch",
				1,
				"wordpress-wxr",
				"wordpress:post:1:comment:100",
				"comment",
				"c_existing",
				"{}",
			);

		const applyResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/import-export/jobs/${jobId}/apply`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				existingStrategy: "fail_on_existing",
			},
		});

		expect(applyResponse.statusCode).toBe(400);
		expect(applyResponse.json()).toMatchObject({
			error: {
				code: "INVALID_REQUEST",
			},
		});

		const commentCount = fixture.app.sqlite
			.prepare("SELECT COUNT(*) AS value FROM comments")
			.get() as { value: number };
		const threadCount = fixture.app.sqlite
			.prepare("SELECT COUNT(*) AS value FROM page_threads")
			.get() as { value: number };
		expect(commentCount.value).toBe(0);
		expect(threadCount.value).toBe(0);
	});
});
