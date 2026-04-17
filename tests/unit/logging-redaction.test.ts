import { describe, expect, it } from "vitest";

import { sanitizeLogData } from "../../src/logging/redaction";

describe("sanitizeLogData", () => {
	it("redacts token cookie captcha and password fields", () => {
		expect(
			sanitizeLogData({
				authorization: "Bearer secret",
				cookie: "qingyan_admin=abc",
				captchaValue: "1234",
				password: "smtp-secret",
				sessionId: "session-1",
			}),
		).toEqual({
			authorization: "[REDACTED]",
			cookie: "[REDACTED]",
			captchaValue: "[REDACTED]",
			password: "[REDACTED]",
			sessionId: "[REDACTED]",
		});
	});
});
