import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { captchaSessions, siteSettings } from "../../src/db/schema";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
		},
	});
}

afterEach(async () => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();

	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("comment captcha providers", () => {
	async function upsertSystemSettings(
		fixture: Awaited<ReturnType<typeof createTestApp>>,
		rows: Array<[string, string, unknown]>,
	) {
		const repository = new AdminSystemSettingsRepository(fixture.app.db);
		for (const [category, key, value] of rows) {
			await repository.upsert(category, key, value);
		}
	}

	it("serves an iframe challenge and completes turnstile verification", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await upsertSystemSettings(fixture, [
			["captcha", "provider", "turnstile"],
			["captcha", "turnstile.siteKey", "1x00000000000000000000AA"],
			["captcha", "turnstile.secretKey", "turnstile-secret"],
			["captcha", "turnstile.expectedAction", "COMMENT_SUBMIT"],
			["captcha", "turnstile.expectedHostname", "comments.example.com"],
		]);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});

		const state = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:turnstile",
		});

		expect(state.statusCode).toBe(200);
		expect(state.json()).toMatchObject({
			required: true,
			verified: false,
			mode: "iframe_widget",
			challenge: {
				mode: "iframe_widget",
			},
		});

		const visitorCookie = state.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const challenge = state.json().challenge as {
			challengeId: string;
			iframeSrc: string;
		};
		const [session] = await fixture.app.db
			.select()
			.from(captchaSessions)
			.where(eq(captchaSessions.id, challenge.challengeId));
		expect(session?.providerKind).toBe("turnstile");

		const widget = await fixture.app.inject({
			method: "GET",
			url: challenge.iframeSrc,
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
		});
		expect(widget.statusCode).toBe(200);
		expect(widget.body).toContain("Turnstile");
		expect(widget.body).toContain("challenges.cloudflare.com/turnstile");

		globalThis.fetch = vi.fn(async () =>
			jsonResponse({
				success: true,
				action: "COMMENT_SUBMIT",
				hostname: "comments.example.com",
			}),
		) as typeof fetch;

		const completed = await fixture.app.inject({
			method: "POST",
			url: "/api/comments/captcha/complete",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:turnstile",
				challengeId: challenge.challengeId,
				token: "turnstile-token",
			},
		});
		expect(completed.statusCode).toBe(200);
		expect(completed.json()).toEqual({
			required: true,
			verified: true,
		});
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
			expect.objectContaining({
				method: "POST",
			}),
		);

		const verifiedState = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:turnstile",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
		});
		expect(verifiedState.statusCode).toBe(200);
		expect(verifiedState.json()).toMatchObject({
			required: true,
			verified: true,
			mode: "iframe_widget",
			challenge: null,
		});
	});

	it("serves an iframe challenge and completes hcaptcha verification", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await upsertSystemSettings(fixture, [
			["captcha", "provider", "hcaptcha"],
			["captcha", "hcaptcha.siteKey", "10000000-ffff-ffff-ffff-000000000001"],
			["captcha", "hcaptcha.secretKey", "hcaptcha-secret"],
			["captcha", "hcaptcha.expectedHostname", "comments.example.com"],
		]);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});

		const state = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:hcaptcha",
		});
		const visitorCookie = state.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const challenge = state.json().challenge as {
			challengeId: string;
			iframeSrc: string;
		};

		const widget = await fixture.app.inject({
			method: "GET",
			url: challenge.iframeSrc,
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
		});
		expect(widget.statusCode).toBe(200);
		expect(widget.body).toContain("hCaptcha");
		expect(widget.body).toContain("js.hcaptcha.com");

		globalThis.fetch = vi.fn(async () =>
			jsonResponse({
				success: true,
				hostname: "comments.example.com",
			}),
		) as typeof fetch;

		const completed = await fixture.app.inject({
			method: "POST",
			url: "/api/comments/captcha/complete",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:hcaptcha",
				challengeId: challenge.challengeId,
				token: "hcaptcha-token",
			},
		});
		expect(completed.statusCode).toBe(200);
		expect(completed.json()).toEqual({
			required: true,
			verified: true,
		});
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://api.hcaptcha.com/siteverify",
			expect.objectContaining({
				method: "POST",
			}),
		);
	});

	it("uses Google Cloud recaptcha assessment flow for both score and policy variants", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await upsertSystemSettings(fixture, [
			["captcha", "provider", "recaptcha"],
			["captcha", "recaptcha.variant", "policy_based_challenge"],
			["captcha", "recaptcha.projectId", "qingyan-project"],
			["captcha", "recaptcha.siteKey", "6L-example"],
			["captcha", "recaptcha.apiKey", "AIza-example"],
			["captcha", "recaptcha.expectedAction", "COMMENT_SUBMIT"],
			["captcha", "recaptcha.expectedHostname", "comments.example.com"],
			["captcha", "recaptcha.minScore", 0.5],
		]);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});

		const state = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:recaptcha",
		});
		const visitorCookie = state.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const challenge = state.json().challenge as {
			challengeId: string;
			iframeSrc: string;
		};

		const widget = await fixture.app.inject({
			method: "GET",
			url: challenge.iframeSrc,
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
		});
		expect(widget.statusCode).toBe(200);
		expect(widget.body).toContain("reCAPTCHA");
		expect(widget.body).toContain("g-recaptcha");

		globalThis.fetch = vi.fn(async () =>
			jsonResponse({
				tokenProperties: {
					valid: true,
					action: "COMMENT_SUBMIT",
					hostname: "comments.example.com",
				},
				riskAnalysis: {
					score: 0.9,
				},
			}),
		) as typeof fetch;

		const completed = await fixture.app.inject({
			method: "POST",
			url: "/api/comments/captcha/complete",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:recaptcha",
				challengeId: challenge.challengeId,
				token: "recaptcha-token",
			},
		});
		expect(completed.statusCode).toBe(200);
		expect(completed.json()).toEqual({
			required: true,
			verified: true,
		});
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://recaptchaenterprise.googleapis.com/v1/projects/qingyan-project/assessments?key=AIza-example",
			expect.objectContaining({
				method: "POST",
			}),
		);

		globalThis.fetch = vi.fn(async () =>
			jsonResponse({
				tokenProperties: {
					valid: true,
					action: "COMMENT_SUBMIT",
					hostname: "comments.example.com",
				},
				riskAnalysis: {
					score: 0.1,
				},
			}),
		) as typeof fetch;

		const lowScoreState = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:recaptcha-low-score",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
		});
		const refreshedChallenge = lowScoreState.json().challenge as {
			challengeId: string;
		};

		const invalid = await fixture.app.inject({
			method: "POST",
			url: "/api/comments/captcha/complete",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:recaptcha-low-score",
				challengeId: refreshedChallenge.challengeId,
				token: "recaptcha-low-score",
			},
		});
		expect(invalid.statusCode).toBe(400);
		expect(invalid.json()).toMatchObject({
			error: {
				code: "COMMENT_CAPTCHA_INVALID",
			},
		});
	});

	it("serves an iframe challenge and completes geetest verification", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await upsertSystemSettings(fixture, [
			["captcha", "provider", "geetest"],
			["captcha", "geetest.captchaId", "647f5ed2ed8acb4be36784e01556bb71"],
			["captcha", "geetest.captchaKey", "b09a7aafbfd83f73b35a9b530d0337bf"],
			["captcha", "geetest.apiServer", "https://gcaptcha4.geetest.com"],
		]);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
		});

		const state = await fixture.app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:geetest",
		});
		const visitorCookie = state.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const challenge = state.json().challenge as {
			challengeId: string;
			iframeSrc: string;
		};

		const widget = await fixture.app.inject({
			method: "GET",
			url: challenge.iframeSrc,
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
		});
		expect(widget.statusCode).toBe(200);
		expect(widget.body).toContain("GeeTest");
		expect(widget.body).toContain("initGeetest4");

		globalThis.fetch = vi.fn(async () =>
			jsonResponse({
				status: "success",
				result: "success",
			}),
		) as typeof fetch;

		const completed = await fixture.app.inject({
			method: "POST",
			url: "/api/comments/captcha/complete",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:geetest",
				challengeId: challenge.challengeId,
				lotNumber: "lot-number",
				captchaOutput: "captcha-output",
				passToken: "pass-token",
				genTime: "1726123456",
			},
		});
		expect(completed.statusCode).toBe(200);
		expect(completed.json()).toEqual({
			required: true,
			verified: true,
		});
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://gcaptcha4.geetest.com/validate?captcha_id=647f5ed2ed8acb4be36784e01556bb71",
			expect.objectContaining({
				method: "POST",
			}),
		);
	});
});
