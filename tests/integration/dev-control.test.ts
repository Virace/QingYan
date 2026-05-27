import { afterEach, describe, expect, it } from "vitest";

import {
	comments,
	pageFeedbackRecords,
	pageThreads,
	siteSettings,
	sites,
} from "../../src/db/schema";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

async function createDevAdminCookie() {
	const fixture = await createTestApp({
		devMode: true,
		devAdminToken: "dev-token",
	});
	cleanups.push(fixture.cleanup);

	const session = await fixture.app.inject({
		method: "POST",
		url: "/qingyan/api/dev/session",
		payload: {
			token: "dev-token",
		},
	});
	const adminCookie = session.cookies.find(
		(cookie) => cookie.name === "qingyan_admin",
	);

	return {
		fixture,
		adminCookie: adminCookie?.value ?? "",
	};
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("dev control routes", () => {
	it("requires an admin session for /qingyan/api/dev/state", async () => {
		const fixture = await createTestApp({
			devMode: true,
			devAdminToken: "dev-token",
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/dev/state?siteKey=default&pageKey=post:dev-state",
		});

		expect(response.statusCode).toBe(401);
	});

	it("returns current page state and reset clears captcha session", async () => {
		const { fixture, adminCookie } = await createDevAdminCookie();

		const stateBeforeReset = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/dev/state?siteKey=default&pageKey=post:dev-state",
			cookies: {
				qingyan_admin: adminCookie,
			},
		});
		expect(stateBeforeReset.statusCode).toBe(200);
		expect(stateBeforeReset.json()).toMatchObject({
			siteKey: "default",
			pageKey: "post:dev-state",
			captcha: {
				required: false,
				verified: false,
			},
		});

		const reset = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/dev/reset",
			cookies: {
				qingyan_admin: adminCookie,
			},
			payload: {
				siteKey: "default",
				pageKey: "post:dev-state",
			},
		});
		expect(reset.statusCode).toBe(200);

		const stateAfterReset = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/dev/state?siteKey=default&pageKey=post:dev-state",
			cookies: {
				qingyan_admin: adminCookie,
			},
		});
		expect(stateAfterReset.statusCode).toBe(200);
		expect(stateAfterReset.json()).toMatchObject({
			captcha: {
				required: false,
				verified: false,
			},
		});
	});

	it("forces always captcha and returns a challenge through bootstrap", async () => {
		const { fixture, adminCookie } = await createDevAdminCookie();

		const scenario = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/dev/scenario",
			cookies: {
				qingyan_admin: adminCookie,
			},
			payload: {
				siteKey: "default",
				pageKey: "post:always",
				scenario: "comments-captcha-always",
				pageTitle: "Always Captcha",
				pageUrl: "https://example.test/posts/always",
			},
		});
		expect(scenario.statusCode).toBe(200);

		const bootstrap = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=default&pageKey=post:always&pageTitle=Always%20Captcha&pageUrl=https://example.test/posts/always",
		});
		expect(bootstrap.statusCode).toBe(200);
		expect(bootstrap.json()).toMatchObject({
			captcha: {
				required: true,
				verified: false,
			},
			commentDisplay: {
				avatar: {
					gravatar: {
						enabled: false,
					},
					display: {
						shape: "circle",
						sizePx: 40,
					},
				},
			},
			viewer: {},
		});

		expect(await fixture.app.db.select().from(sites)).toEqual([
			expect.objectContaining({
				siteKey: "default",
				name: "Default",
			}),
		]);
		expect(await fixture.app.db.select().from(siteSettings)).toEqual([
			expect.objectContaining({
				siteId: 1,
			}),
		]);
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
	});

	it("forces the next write in threshold mode to require captcha", async () => {
		const { fixture, adminCookie } = await createDevAdminCookie();

		await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/dev/scenario",
			cookies: {
				qingyan_admin: adminCookie,
			},
			payload: {
				siteKey: "default",
				pageKey: "post:threshold",
				scenario: "comments-threshold-next-write",
			},
		});

		const bootstrap = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=default&pageKey=post:threshold&pageTitle=Threshold%20Page&pageUrl=https://example.test/posts/threshold",
		});
		expect(bootstrap.statusCode).toBe(200);
		const visitorCookie = bootstrap.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);

		const createComment = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "default",
				pageKey: "post:threshold",
				pageTitle: "Threshold Page",
				pageUrl: "https://example.test/posts/threshold",
				parentCommentId: null,
				author: {
					name: "Tester",
					email: "tester@example.com",
				},
				content: {
					raw: "trigger threshold captcha",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(createComment.statusCode).toBe(400);
		expect(createComment.json()).toMatchObject({
			error: {
				code: "COMMENT_CAPTCHA_REQUIRED",
			},
		});

		const devState = await fixture.app.inject({
			method: "GET",
			url:
				"/qingyan/api/dev/state?siteKey=default&pageKey=post:threshold&visitorKey=" +
				(visitorCookie?.value ?? ""),
			cookies: {
				qingyan_admin: adminCookie,
			},
		});
		expect(devState.statusCode).toBe(200);
		expect(devState.json()).toMatchObject({
			siteKey: "default",
			pageKey: "post:threshold",
			visitorKey: visitorCookie?.value ?? "",
			captcha: {
				required: true,
				verified: false,
			},
		});

		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
		expect(await fixture.app.db.select().from(comments)).toEqual([]);
	});

	it("seeds a basic thread visible from bootstrap", async () => {
		const { fixture, adminCookie } = await createDevAdminCookie();

		await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/dev/scenario",
			cookies: {
				qingyan_admin: adminCookie,
			},
			payload: {
				siteKey: "default",
				pageKey: "post:seeded",
				scenario: "comments-seeded-thread",
				pageTitle: "Seeded Thread",
				pageUrl: "https://example.test/posts/seeded",
			},
		});

		const bootstrap = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=default&pageKey=post:seeded&pageTitle=Seeded%20Thread&pageUrl=https://example.test/posts/seeded",
		});

		expect(bootstrap.statusCode).toBe(200);
		expect(bootstrap.json()).toMatchObject({
			thread: {
				siteKey: "default",
				pageKey: "post:seeded",
			},
			pagination: {
				totalCount: 2,
				rootCount: 1,
			},
			pageFeedback: {
				likeCount: 1,
			},
			commentDisplay: {
				avatar: {
					gravatar: {
						enabled: false,
					},
					display: {
						shape: "circle",
						sizePx: 40,
					},
				},
			},
			viewer: {},
		});

		const thread = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/thread?siteKey=default&pageKey=post:seeded",
		});
		expect(thread.statusCode).toBe(200);
		expect(thread.json()).toMatchObject({
			commentDisplay: {
				avatar: {
					gravatar: {
						enabled: false,
					},
					display: {
						shape: "circle",
						sizePx: 40,
					},
				},
			},
		});

		const commentRows = await fixture.app.db.select().from(comments);
		expect(commentRows).toHaveLength(0);
		expect(await fixture.app.db.select().from(pageThreads)).toEqual([]);
		expect(await fixture.app.db.select().from(pageFeedbackRecords)).toEqual([]);
	});
});
