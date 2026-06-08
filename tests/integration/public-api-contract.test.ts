import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { sitePageRegistry, siteSettings, sites } from "../../src/db/schema";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { deriveCanonicalPageKeyFromPathname } from "../../src/modules/shared/canonical-page-key";
import { serializeEngagementSettings } from "../../src/modules/shared/site-settings-defaults";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

type TestFixture = Awaited<ReturnType<typeof createTestApp>>;

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function getFangyuanSite(fixture: TestFixture) {
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, "fangyuan"));
	if (!site) {
		throw new Error("Expected fangyuan site to exist");
	}
	return site;
}

async function seedPage(
	fixture: TestFixture,
	siteId: number,
	pageKey: string,
	status: "active" | "trash" = "active",
) {
	const canonicalPageKey = deriveCanonicalPageKeyFromPathname(pageKey);
	await fixture.app.db.insert(sitePageRegistry).values({
		siteId,
		pageKey: canonicalPageKey,
		pageUrl: canonicalPageKey,
		status,
	});
}

async function enableUsableSystemMail(fixture: TestFixture) {
	const repository = new AdminSystemSettingsRepository(fixture.app.db);
	await repository.upsert("mail", "enabled", true);
	await repository.upsert("mail", "smtp.host", "smtp.example.test");
	await repository.upsert("mail", "smtp.from", "notify@example.test");
}

describe("public API contract", () => {
	it("returns features and data without old bootstrap fields", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await getFangyuanSite(fixture);
		await seedPage(fixture, site.id, "posts/public-contract/");
		await enableUsableSystemMail(fixture);
		await fixture.app.db
			.update(siteSettings)
			.set({
				commenterReplyEmailEnabled: true,
				engagementJson: serializeEngagementSettings({
					visitors: { enabled: true },
					pageViews: { enabled: true },
					pageLikes: { enabled: true },
					commentVotes: { enabled: false },
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Public%20Contract",
			headers: {
				referer: "http://localhost:4321/posts/public-contract/",
				"user-agent": "public-contract-test",
			},
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body).toMatchObject({
			schemaVersion: "2026-05-31",
			site: { siteKey: "fangyuan" },
			page: {
				pageKey: "/posts/public-contract/",
				status: "active",
			},
			features: {
				comments: { enabled: true },
				commentReplies: { enabled: true, maxDepth: 3 },
				commentVotes: {
					enabled: false,
					reason: "feature_disabled",
				},
				commentCaptcha: { enabled: true, mode: "threshold" },
				pageViews: { enabled: true },
				pageLikes: { enabled: true },
				visitors: { enabled: true },
				replyEmailNotification: { enabled: true },
			},
			data: {
				comments: {
					form: {
						allow: ["nickname", "email", "website"],
						require: ["nickname", "email"],
						limits: {
							authorNameMaxLength: 40,
							authorWebsiteMaxLength: 2048,
							pageTitleMaxLength: 200,
							pageKeyMaxLength: 512,
							contentMaxLength: 2000,
						},
					},
				},
				pageViews: { count: 1 },
				pageLikes: { count: 0, liked: false },
			},
		});
		expect(body).not.toHaveProperty("capability");
		expect(body).not.toHaveProperty("commentForm");
		expect(body).not.toHaveProperty("pagination");
		expect(body).not.toHaveProperty("comments");
		expect(body).not.toHaveProperty("commentDisplay");
		expect(body).not.toHaveProperty("pageMetrics");
		expect(body).not.toHaveProperty("pageFeedback");
		expect(body).not.toHaveProperty("captcha");
		expect(body).not.toHaveProperty("adminNotifications");
		expect(body.features).not.toHaveProperty("adminNotifications");
		expect(body.features).not.toHaveProperty("smtp");
		expect(JSON.stringify(body)).not.toContain("trustMode");
		expect(JSON.stringify(body.features)).not.toContain('"reason":null');
		expect(JSON.stringify(body)).not.toContain('"viewer":{}');
	});

	it("returns reply email notification as false when public capability is unavailable", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await getFangyuanSite(fixture);
		await seedPage(fixture, site.id, "posts/reply-email-disabled/");
		await fixture.app.db
			.update(siteSettings)
			.set({
				commenterReplyEmailEnabled: true,
			})
			.where(eq(siteSettings.siteId, site.id));

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Reply%20Email%20Disabled",
			headers: {
				referer: "http://localhost:4321/posts/reply-email-disabled/",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().features.replyEmailNotification).toEqual({
			enabled: false,
			reason: "feature_disabled",
		});
	});

	it("omits comments data when comments are disabled", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await getFangyuanSite(fixture);
		await seedPage(fixture, site.id, "posts/comments-disabled/");
		await fixture.app.db
			.update(siteSettings)
			.set({
				commentsEnabled: false,
				engagementJson: serializeEngagementSettings({
					visitors: { enabled: true },
					pageViews: { enabled: false },
					pageLikes: { enabled: true },
					commentVotes: { enabled: true },
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Disabled",
			headers: {
				referer: "http://localhost:4321/posts/comments-disabled/",
			},
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.features.comments).toEqual({
			enabled: false,
			reason: "site_disabled",
		});
		expect(body.features.commentReplies).toEqual({
			enabled: false,
			reason: "comments_disabled",
		});
		expect(body.features.replyEmailNotification).toEqual({
			enabled: false,
			reason: "comments_disabled",
		});
		expect(body.features.commentVotes).toEqual({
			enabled: false,
			reason: "comments_disabled",
		});
		expect(body.data).toEqual({
			pageLikes: {
				count: 0,
				liked: false,
			},
		});
		expect(body.data).not.toHaveProperty("comments");
		expect(body).not.toHaveProperty("commentForm");
		expect(body).not.toHaveProperty("comments");
		expect(body).not.toHaveProperty("captcha");
	});

	it("omits disabled page view and page like data blocks", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await getFangyuanSite(fixture);
		await seedPage(fixture, site.id, "posts/disabled-metrics/");
		await fixture.app.db
			.update(siteSettings)
			.set({
				engagementJson: serializeEngagementSettings({
					visitors: { enabled: true },
					pageViews: { enabled: false },
					pageLikes: { enabled: false },
					commentVotes: { enabled: false },
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Metrics",
			headers: {
				referer: "http://localhost:4321/posts/disabled-metrics/",
			},
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.features.pageViews).toEqual({
			enabled: false,
			reason: "feature_disabled",
		});
		expect(body.features.pageLikes).toEqual({
			enabled: false,
			reason: "feature_disabled",
		});
		expect(body.data).not.toHaveProperty("pageViews");
		expect(body.data).not.toHaveProperty("pageLikes");
	});

	it("returns only disabled feature state for inactive pages", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const site = await getFangyuanSite(fixture);
		await seedPage(fixture, site.id, "posts/trashed-contract/", "trash");

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageTitle=Trash",
			headers: {
				referer: "http://localhost:4321/posts/trashed-contract/",
			},
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.features.comments.reason).toBe("page_inactive");
		expect(body.features.pageViews.reason).toBe("page_inactive");
		expect(body.features.pageLikes.reason).toBe("page_inactive");
		expect(body.features.replyEmailNotification).toEqual({
			enabled: false,
			reason: "page_inactive",
		});
		expect(body.data).toEqual({});
	});
});
