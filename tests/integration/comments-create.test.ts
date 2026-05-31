import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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
	sitePageRegistry,
	siteSettings,
	sites,
	systemSettings,
} from "../../src/db/schema";
import {
	serializeStaffDisplaySettings,
	serializeVerifiedAuthorSettings,
} from "../../src/modules/comments/verified-author";
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

type CustomFixture = Awaited<ReturnType<typeof createCustomTestApp>>;

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
	externalAvatar?: boolean;
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
		if (options?.externalAvatar) {
			await db.insert(systemSettings).values([
				{
					category: "avatar",
					key: "external.enabled",
					valueJson: JSON.stringify(true),
				},
				{
					category: "avatar",
					key: "external.baseUrl",
					valueJson: JSON.stringify("https://cravatar.cn/avatar"),
				},
				{
					category: "avatar",
					key: "external.hashAlgorithm",
					valueJson: JSON.stringify("md5"),
				},
				{
					category: "avatar",
					key: "external.query",
					valueJson: JSON.stringify("s=160&d=identicon"),
				},
			]);
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

async function seedActivePage(fixture: CustomFixture, pageKey: string) {
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, "fangyuan"));
	if (!site) {
		throw new Error("Expected site to exist");
	}
	await fixture.app.db.insert(sitePageRegistry).values({
		siteId: site.id,
		pageKey,
		pageUrl: `/${pageKey}`,
		status: "active",
	});
}

describe("POST /qingyan/api/comments", () => {
	it("returns a full public comment when an approved visitor comment is created", async () => {
		const fixture = await createCustomTestApp({
			require: ["nickname", "email"],
			externalAvatar: true,
			moderation: serializeSiteModerationSettings({
				mode: "none",
				provider: "none",
				akismet: {
					failPolicy: "pending",
					discardBlatantSpam: false,
				},
			}),
		});
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "posts/create-full-response/");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				referer: "http://localhost:4321/posts/create-full-response/",
				"user-agent": "create-full-response-test",
			},
			payload: {
				siteKey: "fangyuan",
				pageTitle: "Create Full Response",
				parentCommentId: null,
				author: {
					name: "Visitor",
					email: "visitor@example.com",
					website: "https://visitor.example.com",
				},
				content: {
					raw: "hello <qingyan>",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		const visitorAvatarHash = createHash("md5")
			.update("visitor@example.com")
			.digest("hex");
		expect(response.json()).toMatchObject({
			comment: {
				author: {
					name: "Visitor",
					website: "https://visitor.example.com/",
					avatarUrl: `https://cravatar.cn/avatar/${visitorAvatarHash}?s=160&d=identicon`,
				},
				content: {
					raw: "hello <qingyan>",
					html: "<p>hello &lt;qingyan&gt;</p>",
				},
				status: "approved",
				isPinned: false,
				isFolded: false,
				replyCount: 0,
			},
			thread: {
				commentCount: 1,
				rootCommentCount: 1,
			},
		});
		expect(response.json().comment).not.toHaveProperty("parentId");
		expect(response.json().comment).not.toHaveProperty("voteUp");
		expect(response.json().comment).not.toHaveProperty("voteDown");
		expect(response.json().comment).not.toHaveProperty("viewerVote");
		expect(response.json().comment).not.toHaveProperty("children");
		expect(response.json().comment.id).toEqual(expect.any(String));
		expect(response.json().comment.createdAt).toEqual(expect.any(String));
		expect(response.json().comment.updatedAt).toEqual(expect.any(String));
	});

	it("accepts create payloads without unused options", async () => {
		const fixture = await createCustomTestApp({ require: [] });
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "posts/no-options/");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: {
				referer: "http://localhost:4321/posts/no-options/",
			},
			payload: {
				siteKey: "fangyuan",
				pageTitle: "No Options",
				parentCommentId: null,
				author: {},
				content: { raw: "no options" },
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().comment).toMatchObject({
			content: { raw: "no options" },
		});
	});

	it("creates page threads from Referer when explicit comment payload identity is stale", async () => {
		const fixture = await createCustomTestApp({
			require: [],
		});
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "lol_voice_collation.html");

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
		await seedActivePage(fixture, "post:required-email");

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
			await seedActivePage(fixture, `post:${testCase.name}`);

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
	}, 15_000);

	it("accepts fully anonymous comments when no identity field is required", async () => {
		const fixture = await createCustomTestApp({
			require: [],
			allowWebsite: false,
		});
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "post:anonymous");

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
		await seedActivePage(fixture, "post:verified-create");

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
				author: {
					name: "Virace",
					website: "https://fangyuan.example.com/about",
					badge: { label: "楼主" },
				},
				content: {
					raw: "verified comment",
					html: "<p>verified comment</p>",
				},
				status: "approved",
			},
		});
		expect(response.json().comment).not.toHaveProperty("parentId");
		expect(response.json().comment).not.toHaveProperty("viewerVote");
		expect(response.json().comment).not.toHaveProperty("children");

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

	it("renders verified comment names from current profile unless snapshot mode is selected", async () => {
		const fixture = await createCustomTestApp();
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "post:verified-display-mode");

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
		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			headers: {
				referer: "http://localhost:4321/post:verified-display-mode",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:verified-display-mode",
				pageTitle: "Verified Display Mode",
				pageUrl: "https://fangyuan.example.com/posts/verified-display-mode/",
				parentCommentId: null,
				author: {},
				content: {
					raw: "verified display mode",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});
		expect(createResponse.statusCode).toBe(200);

		await fixture.app.db
			.update(siteSettings)
			.set({
				verifiedAuthorJson: serializeVerifiedAuthorSettings({
					enabled: true,
					displayName: "Virace 当前资料",
					email: "owner@example.com",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				}),
				staffDisplayJson: serializeStaffDisplaySettings({
					nameMode: "current_profile",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const currentProfileThread = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/thread?siteKey=fangyuan&pageKey=post:verified-display-mode",
			headers: {
				referer: "http://localhost:4321/post:verified-display-mode",
			},
		});
		expect(currentProfileThread.statusCode).toBe(200);
		expect(currentProfileThread.json().items[0].author).toMatchObject({
			name: "Virace 当前资料",
			badge: { label: "楼主" },
		});

		await fixture.app.db
			.update(siteSettings)
			.set({
				staffDisplayJson: serializeStaffDisplaySettings({
					nameMode: "snapshot",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));

		const snapshotThread = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/thread?siteKey=fangyuan&pageKey=post:verified-display-mode",
			headers: {
				referer: "http://localhost:4321/post:verified-display-mode",
			},
		});
		expect(snapshotThread.statusCode).toBe(200);
		expect(snapshotThread.json().items[0].author).toMatchObject({
			name: "Virace",
			badge: { label: "楼主" },
		});
	});

	it("rejects reserved verified author email for visitor comments", async () => {
		const fixture = await createCustomTestApp();
		cleanups.push(fixture.cleanup);
		await seedActivePage(fixture, "post:reserved-email");

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
