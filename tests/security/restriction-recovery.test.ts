import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/modules/shared/errors";
import { buildErrorResponse } from "../../src/modules/shared/error-response";
import { restrictionRecovery } from "../../src/modules/shared/restriction-recovery";
import { registerRestrictionRoutes } from "../../src/modules/shared/restriction-routes";

describe("public restriction recovery", () => {
	it("preserves millisecond resetAt and reports rounded-up seconds", () => {
		const error = new AppError(429, "COMMENT_RATE_LIMITED", "请稍后重试。", {
			resetAt: 2501,
		});
		expect(restrictionRecovery(error, "/comments", 1000)).toEqual({
			reason: "rate_limited",
			retryAfterSec: 2,
			helpUrl: "/comments/restricted?reason=rate_limited&resetAt=2501",
		});
		const response = buildErrorResponse(error, "test-request", "/comments");
		expect(response.body.error).toMatchObject({
			code: "COMMENT_RATE_LIMITED",
			details: { resetAt: 2501 },
			recovery: { reason: "rate_limited" },
		});
		expect(
			restrictionRecovery(
				new AppError(429, "COMMENT_RATE_LIMITED", "请稍后重试。", {
					retryAfterSec: 3,
				}),
				"/comments",
				1000,
			)?.helpUrl,
		).toBe("/comments/restricted?reason=rate_limited&resetAt=4000");
	});

	it("distinguishes login and email correction without disclosing policy", () => {
		expect(
			restrictionRecovery(
				new AppError(403, "COMMENT_EMAIL_LOGIN_REQUIRED", "请登录。"),
				"/comments",
			),
		).toEqual({
			reason: "login_required",
			retryAfterSec: undefined,
			helpUrl: "/comments/restricted?reason=login_required",
		});
		expect(
			restrictionRecovery(
				new AppError(403, "COMMENT_EMAIL_NOT_ALLOWED", "请更换邮箱。"),
				"/qingyan",
			)?.reason,
		).toBe("email_not_allowed");
		expect(
			restrictionRecovery(
				new AppError(500, "INTERNAL_ERROR", "服务异常。"),
				"/qingyan",
			),
		).toBeUndefined();
	});

	it("serves a self-contained same-origin page and ignores untrusted text and links", async () => {
		const app = Fastify();
		registerRestrictionRoutes(app, "/comments");
		try {
			const response = await app.inject(
				"/comments/restricted?reason=blocked&message=%3Cimg%20src=x%20onerror=alert(1)%3E&returnUrl=https://evil.example",
			);
			expect(response.statusCode).toBe(200);
			expect(response.headers["content-type"]).toContain("text/html");
			expect(response.headers["content-security-policy"]).toContain(
				"default-src 'none'",
			);
			expect(response.body).toContain("当前访问受到限制");
			expect(response.body).not.toContain("evil.example");
			expect(response.body).not.toContain("onerror");
		} finally {
			await app.close();
		}
	});
});
