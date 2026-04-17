import { describe, expect, it } from "vitest";

import { requiresCaptchaForAttempt } from "../../src/modules/comments/captcha-threshold";

describe("requiresCaptchaForAttempt", () => {
	it("treats thresholdMaxActions as the Nth write that starts requiring captcha", () => {
		expect(requiresCaptchaForAttempt(0, 3)).toBe(false);
		expect(requiresCaptchaForAttempt(1, 3)).toBe(false);
		expect(requiresCaptchaForAttempt(2, 3)).toBe(true);
		expect(requiresCaptchaForAttempt(3, 3)).toBe(true);
	});

	it("requires captcha from the first write when thresholdMaxActions is 1", () => {
		expect(requiresCaptchaForAttempt(0, 1)).toBe(true);
	});
});
