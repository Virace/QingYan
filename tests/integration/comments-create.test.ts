import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { buildApp } from "../../src/app";
import { createDatabaseClients } from "../../src/db/client";
import {
	commentModeration,
	comments,
	pageThreads,
	siteSettings,
	sites,
	systemSettings,
} from "../../src/db/schema";
import { serializeVerifiedAuthorSettings } from "../../src/modules/comments/verified-author";
import { serializeSiteModerationSettings } from "../../src/modules/comments/moderation-types";
import type { AkismetReviewResult } from "../../src/modules/comments/akismet-client";
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
	moderation?: ReturnType<typeof serializeSiteModerationSettings>;
	akismetVerdict?: AkismetReviewResult["verdict"];
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
				moderationJson: options?.moderation,
			})
			.where(eq(siteSettings.siteId, site.id));
		if (options?.akismetVerdict) {
			await db.insert(systemSettings).values({
				category: "antiSpam",
				key: "akismet.apiKey",
				valueJson: JSON.stringify("akismet-test-key"),
			});
		}
	} finally {
		sqlite.close();
	}

	const app = await buildApp(config, undefined, {
		akismetClient: options?.akismetVerdict
			? {
					commentCheck: async () => ({
						verdict: options.akismetVerdict ?? "ham",
						checkedAt: "2026-05-26T10:00:00.000Z",
					}),
				}
			: undefined,
	});

	return {
		app,
		async cleanup() {
			await app.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("POST /qingyan/api/comments", () => {
	it("creates page threads from Referer when legacy comment payload identity is stale", async () => {
		const fixture = await createCustomTestApp({
			require: [],
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				referer: "http://localhost:4321/lol_voice_collation.html",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "lol_voice_collation",
				pageTitle: "HTML Comment Page",
				pageUrl: "https://x-item.com/lol_voice_collation.html",
				parentCommentId: null,
				author: {},
				content: {
					raw: "comment on html page",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);

		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "lol_voice_collation.html"))
			.limit(1);
		expect(thread).toMatchObject({
			pageKey: "lol_voice_collation.html",
			pageUrl: "/lol_voice_collation.html",
			pageTitle: "HTML Comment Page",
			commentCount: 1,
			rootCommentCount: 1,
		});

		const staleThreads = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "lol_voice_collation"));
		expect(staleThreads).toEqual([]);
	});

	it("rejects requests missing configured required identity fields", async () => {
		const fixture = await createCustomTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				referer: "http://localhost:4321/post:required-email",
			},
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

	it("applies moderation modes when creating visitor comments", async () => {
		const cases = [
			{
				name: "none",
				moderation: serializeSiteModerationSettings({
					mode: "none",
					provider: "none",
					akismet: {
						failPolicy: "pending",
						discardBlatantSpam: false,
					},
				}),
				expectedStoredStatus: "approved",
				expectedPublicStatus: "approved",
			},
			{
				name: "manual",
				moderation: serializeSiteModerationSettings({
					mode: "manual",
					provider: "none",
					akismet: {
						failPolicy: "pending",
						discardBlatantSpam: false,
					},
				}),
				expectedStoredStatus: "pending",
				expectedPublicStatus: "pending",
			},
			{
				name: "manual_with_akismet_spam",
				moderation: serializeSiteModerationSettings({
					mode: "manual_with_akismet",
					provider: "akismet",
					akismet: {
						failPolicy: "pending",
						discardBlatantSpam: false,
					},
				}),
				akismetVerdict: "spam" as const,
				expectedStoredStatus: "spam",
				expectedPublicStatus: "pending",
			},
			{
				name: "akismet_auto_ham",
				moderation: serializeSiteModerationSettings({
					mode: "akismet_auto",
					provider: "akismet",
					akismet: {
						failPolicy: "pending",
						discardBlatantSpam: false,
					},
				}),
				akismetVerdict: "ham" as const,
				expectedStoredStatus: "approved",
				expectedPublicStatus: "approved",
			},
		];

		for (const testCase of cases) {
			const fixture = await createCustomTestApp({
				moderation: testCase.moderation,
				akismetVerdict: testCase.akismetVerdict,
			});
			cleanups.push(fixture.cleanup);

			const response = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/comments",
				headers: {
					referer: `http://localhost:4321/post:${testCase.name}`,
					"x-forwarded-for": "203.0.113.10",
				},
				payload: {
					siteKey: "fangyuan",
					pageKey: `post:${testCase.name}`,
					pageTitle: testCase.name,
					pageUrl: `https://fangyuan.example.com/posts/${testCase.name}/`,
					parentCommentId: null,
					author: {
						name: "Alice",
						email: "alice@example.com",
					},
					content: {
						raw: `comment ${testCase.name}`,
					},
					options: {
						notifyOnReply: false,
					},
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				comment: {
					status: testCase.expectedPublicStatus,
				},
			});

			const [createdComment] = await fixture.app.db
				.select()
				.from(comments)
				.where(eq(comments.contentRaw, `comment ${testCase.name}`))
				.limit(1);
			expect(createdComment?.status).toBe(testCase.expectedStoredStatus);

			const [moderation] = await fixture.app.db
				.select()
				.from(commentModeration)
				.where(eq(commentModeration.commentId, createdComment?.id ?? ""))
				.limit(1);
			expect(moderation).toMatchObject({
				status: testCase.expectedStoredStatus,
			});
		}
	});

	it("accepts fully anonymous comments when no identity field is required", async () => {
		const fixture = await createCustomTestApp({
			require: [],
			allowWebsite: false,
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				referer: "http://localhost:4321/post:anonymous",
			},
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
			url: "/qingyan/api/comments",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			headers: {
				referer: "http://localhost:4321/post:verified-create",
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
			url: "/qingyan/api/comments",
			headers: {
				referer: "http://localhost:4321/post:reserved-email",
			},
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
