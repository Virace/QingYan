import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import { resolveRuntimeOptions } from "../../src/config/runtime-options";
import {
	getForcedTestCaptchaAnswer,
	withForcedTestCaptchaAnswer,
} from "../support/captcha";
import { createTestConfig } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

function createMemoryModeFixture() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-memory-"));
	const databaseFile = path.join(directory, "must-not-exist.db");
	const logsDirectory = path.join(directory, "logs");
	const config = createTestConfig(databaseFile, logsDirectory);
	const resolved = resolveRuntimeOptions(config, {
		QINGYAN_DATABASE_MODE: "none",
		QINGYAN_DEV_ADMIN_TOKEN: "dev-token",
		QINGYAN_DEV_ALLOWED_ORIGIN: "http://localhost:4321",
	});

	return {
		databaseFile,
		resolved,
		async cleanup(app?: FastifyInstance) {
			await app?.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("dev memory mode", () => {
	it("starts without sqlite and keeps the full dev mock flow available", async () => {
		const fixture = createMemoryModeFixture();
		let app: FastifyInstance | undefined;
		cleanups.push(() => fixture.cleanup(app));

		app = await buildApp(
			fixture.resolved.config,
			fixture.resolved.runtimeOptions,
		);

		expect(fixture.resolved.runtimeOptions.devMode.enabled).toBe(true);
		expect(existsSync(fixture.databaseFile)).toBe(false);

		const session = await app.inject({
			method: "POST",
			url: "/qingyan/api/dev/session",
			payload: {
				token: "dev-token",
			},
		});
		expect(session.statusCode).toBe(200);
		const adminCookie = session.cookies.find(
			(cookie) => cookie.name === "qingyan_admin",
		);
		expect(adminCookie?.value).toBeTruthy();

		const me = await app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(me.statusCode).toBe(200);
		expect(me.json()).toMatchObject({
			authenticated: true,
			sites: [{ siteKey: "default", name: "Default" }],
		});

		const scenario = await app.inject({
			method: "POST",
			url: "/qingyan/api/dev/scenario",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
			payload: {
				siteKey: "default",
				pageKey: "post:memory",
				scenario: "comments-seeded-thread",
				pageTitle: "Memory Mode",
				pageUrl: "http://localhost:4321/posts/memory",
			},
		});
		expect(scenario.statusCode).toBe(200);

		const bootstrap = await app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=default&pageKey=post:memory&pageTitle=Memory%20Mode&pageUrl=http://localhost:4321/posts/memory",
		});
		expect(bootstrap.statusCode).toBe(200);
		expect(bootstrap.json()).toMatchObject({
			schemaVersion: "2026-05-31",
			data: {
				comments: {
					pagination: {
						totalCount: 2,
						rootCount: 1,
					},
				},
				pageLikes: {
					count: 1,
				},
			},
		});

		const visitorCookie = bootstrap.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const like = await app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "default",
				pageKey: "post:memory",
				pageTitle: "Memory Mode",
				pageUrl: "http://localhost:4321/posts/memory",
			},
		});
		expect(like.statusCode).toBe(200);
		expect(like.json()).toMatchObject({
			pageLikes: {
				count: 2,
				liked: true,
			},
		});

		const state = await app.inject({
			method: "GET",
			url: "/qingyan/api/dev/state?siteKey=default&pageKey=post:memory",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(state.statusCode).toBe(200);
		expect(state.json()).toMatchObject({
			siteKey: "default",
			pageKey: "post:memory",
			thread: {
				commentCount: 2,
				rootCommentCount: 1,
				pageLikeCount: 2,
			},
		});

		expect(existsSync(fixture.databaseFile)).toBe(false);
	});

	it("seeds default comments for every new page with vote fixtures", async () =>
		withForcedTestCaptchaAnswer(async () => {
			const fixture = createMemoryModeFixture();
			let app: FastifyInstance | undefined;
			cleanups.push(() => fixture.cleanup(app));

			app = await buildApp(
				fixture.resolved.config,
				fixture.resolved.runtimeOptions,
			);

			const pageKey = "post:default-seeded";
			const bootstrap = await app.inject({
				method: "GET",
				url: `/qingyan/api/comments/bootstrap?siteKey=default&pageKey=${encodeURIComponent(pageKey)}&pageTitle=Default%20Seeded&pageUrl=http://localhost:4321/posts/default-seeded&limit=5`,
			});
			expect(bootstrap.statusCode).toBe(200);
			const bootstrapBody = bootstrap.json();
			expect(bootstrapBody).toMatchObject({
				schemaVersion: "2026-05-31",
				data: {
					comments: {
						pagination: {
							totalCount: 9,
							rootCount: 6,
							limit: 5,
							offset: 0,
						},
					},
				},
			});
			expect(bootstrapBody.data.comments.items).toHaveLength(5);

			const visitorCookie = bootstrap.cookies.find(
				(cookie) => cookie.name === "qingyan_visitor",
			);
			const captchaCommentId = "dev_post_default-seeded_root_1";
			const blacklistCommentId = "dev_post_default-seeded_root_2";
			const nestedRoot = bootstrapBody.data.comments.items.find(
				(comment: { id: string }) => comment.id === captchaCommentId,
			);
			expect(nestedRoot).toMatchObject({
				children: [
					{
						id: "dev_post_default-seeded_reply_1",
						children: [{ id: "dev_post_default-seeded_reply_2" }],
					},
				],
			});

			const secondPage = await app.inject({
				method: "GET",
				url: `/qingyan/api/comments/thread?siteKey=default&pageKey=${encodeURIComponent(pageKey)}&limit=5&offset=5`,
				cookies: {
					qingyan_visitor: visitorCookie?.value ?? "",
				},
			});
			expect(secondPage.statusCode).toBe(200);
			expect(secondPage.json()).toMatchObject({
				pagination: {
					totalCount: 9,
					rootCount: 6,
					limit: 5,
					offset: 5,
				},
			});
			expect(secondPage.json().items).toHaveLength(1);

			const comments = JSON.stringify(bootstrapBody.data.comments.items);
			expect(comments).toContain(captchaCommentId);
			expect(comments).toContain(blacklistCommentId);

			const captchaBlockedVote = await app.inject({
				method: "POST",
				url: `/qingyan/api/comments/${captchaCommentId}/vote`,
				cookies: {
					qingyan_visitor: visitorCookie?.value ?? "",
				},
				payload: {
					siteKey: "default",
					pageKey,
					choice: "up",
				},
			});
			expect(captchaBlockedVote.statusCode).toBe(400);
			expect(captchaBlockedVote.json()).toMatchObject({
				error: {
					code: "VOTE_CAPTCHA_REQUIRED",
				},
			});

			const captchaState = await app.inject({
				method: "GET",
				url: `/qingyan/api/comments/captcha/state?siteKey=default&pageKey=${encodeURIComponent(pageKey)}`,
				cookies: {
					qingyan_visitor: visitorCookie?.value ?? "",
				},
			});
			expect(captchaState.statusCode).toBe(200);
			expect(captchaState.json()).toMatchObject({
				required: true,
				verified: false,
			});

			const challengeId = captchaState.json().challenge.challengeId as string;
			const verify = await app.inject({
				method: "POST",
				url: "/qingyan/api/comments/captcha/verify",
				cookies: {
					qingyan_visitor: visitorCookie?.value ?? "",
				},
				payload: {
					siteKey: "default",
					pageKey,
					challengeId,
					mode: "inline_value",
					value: getForcedTestCaptchaAnswer(),
				},
			});
			expect(verify.statusCode).toBe(200);

			const votedAfterCaptcha = await app.inject({
				method: "POST",
				url: `/qingyan/api/comments/${captchaCommentId}/vote`,
				cookies: {
					qingyan_visitor: visitorCookie?.value ?? "",
				},
				payload: {
					siteKey: "default",
					pageKey,
					choice: "up",
				},
			});
			expect(votedAfterCaptcha.statusCode).toBe(200);
			expect(votedAfterCaptcha.json()).toMatchObject({
				commentId: captchaCommentId,
				vote: {
					viewer: "up",
				},
			});

			const blacklistVote = await app.inject({
				method: "POST",
				url: `/qingyan/api/comments/${blacklistCommentId}/vote`,
				cookies: {
					qingyan_visitor: visitorCookie?.value ?? "",
				},
				payload: {
					siteKey: "default",
					pageKey,
					choice: "up",
				},
			});
			expect(blacklistVote.statusCode).toBe(403);
			expect(blacklistVote.json()).toMatchObject({
				error: {
					code: "COMMENT_BLACKLISTED",
				},
			});

			expect(existsSync(fixture.databaseFile)).toBe(false);
		}));
});
