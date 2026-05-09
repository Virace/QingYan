import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { buildApp } from "../../src/app";
import { createDatabaseClients } from "../../src/db/client";
import { comments, siteSettings, sites } from "../../src/db/schema";
import { serializeVerifiedAuthorSettings } from "../../src/modules/comments/verified-author";
import { loginAsAdmin } from "../support/admin-login";
import {
	applyInitialMigration,
	createTestConfig,
	defaultTestSite,
} from "../support/test-fixtures";
import { createSiteRegistry } from "../../src/modules/shared/site-registry";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function createCustomTestApp(options?: {
	require?: Array<"nickname" | "email" | "website">;
	allowWebsite?: boolean;
}) {
	const directory = mkdtempSync(
		path.join(tmpdir(), "qingyan-comments-create-"),
	);
	const databaseFile = path.join(directory, "qingyan.db");
	applyInitialMigration(databaseFile);

	const config = createTestConfig(databaseFile);
	const { db, sqlite } = createDatabaseClients(databaseFile);
	try {
		await createSiteRegistry().seedSiteFromTemplate(db, defaultTestSite);
		const [site] = await db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, defaultTestSite.siteKey))
			.limit(1);
		if (!site) {
			throw new Error("Expected test site config");
		}
		await db
			.update(siteSettings)
			.set({
				commentRequireJson: JSON.stringify(
					options?.require ?? ["nickname", "email"],
				),
				allowWebsite: options?.allowWebsite ?? true,
			})
			.where(eq(siteSettings.siteId, site.id));
	} finally {
		sqlite.close();
	}

	const app = await buildApp(config);

	return {
		app,
		async cleanup() {
			await app.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("POST /api/comments", () => {
	it("rejects requests missing configured required identity fields", async () => {
		const fixture = await createCustomTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:required-email",
				pageTitle: "Required Email",
				pageUrl: "https://fangyuan.example.com/posts/required-email/",
				parentCommentId: null,
				author: {
					name: "Alice",
				},
				content: {
					raw: "hello",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "COMMENT_VALIDATION_FAILED",
			},
		});
	});

	it("accepts fully anonymous comments when no identity field is required", async () => {
		const fixture = await createCustomTestApp({
			require: [],
			allowWebsite: false,
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:anonymous",
				pageTitle: "Anonymous",
				pageUrl: "https://fangyuan.example.com/posts/anonymous/",
				parentCommentId: null,
				author: {},
				content: {
					raw: "anonymous comment",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			comment: {
				status: "pending",
			},
		});

		const [createdComment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "anonymous comment"))
			.limit(1);
		expect(createdComment?.authorName).toBe("");
		expect(createdComment?.authorEmail).toBeNull();
		expect(createdComment?.authorWebsite).toBeNull();
	});

	it("creates a verified author comment when admin session is present", async () => {
		const fixture = await createCustomTestApp();
		cleanups.push(fixture.cleanup);

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}
		await fixture.app.db
			.update(siteSettings)
			.set({
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Virace",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:verified-create",
				pageTitle: "Verified Create",
				pageUrl: "https://fangyuan.example.com/posts/verified-create/",
				parentCommentId: null,
				author: {},
				content: {
					raw: "verified comment",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			comment: {
				status: "approved",
			},
		});

		const [createdComment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "verified comment"))
			.limit(1);
		expect(createdComment).toMatchObject({
			authorIdentity: "verified",
			authorName: "Virace",
			authorEmail: "owner@example.com",
			authorWebsite: "https://fangyuan.example.com/about",
			status: "approved",
		});
	});

	it("rejects reserved verified author email for visitor comments", async () => {
		const fixture = await createCustomTestApp();
		cleanups.push(fixture.cleanup);

		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}
		await fixture.app.db
			.update(siteSettings)
			.set({
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Virace",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:reserved-email",
				pageTitle: "Reserved Email",
				pageUrl: "https://fangyuan.example.com/posts/reserved-email/",
				parentCommentId: null,
				author: {
					name: "Visitor",
					email: "owner@example.com",
				},
				content: {
					raw: "reserved email",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "VERIFIED_AUTHOR_EMAIL_RESERVED",
			},
		});
	});
});
