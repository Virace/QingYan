const FORCED_TEST_CAPTCHA_ANSWER = "2468";
const TEST_CAPTCHA_ENV = "QINGYAN_TEST_CAPTCHA_ANSWER";

export function withForcedTestCaptchaAnswer<T>(run: () => Promise<T>): Promise<T> {
	const previous = process.env[TEST_CAPTCHA_ENV];
	process.env[TEST_CAPTCHA_ENV] = FORCED_TEST_CAPTCHA_ANSWER;

	return run().finally(() => {
		if (previous === undefined) {
			delete process.env[TEST_CAPTCHA_ENV];
			return;
		}

		process.env[TEST_CAPTCHA_ENV] = previous;
	});
}

export function getForcedTestCaptchaAnswer(): string {
	return FORCED_TEST_CAPTCHA_ANSWER;
}

export function decodeSvgDataUrl(imageData: string): string {
	const encoded = imageData.split(",")[1];
	if (!encoded) {
		throw new Error("Expected captcha image data");
	}

	return Buffer.from(encoded, "base64").toString("utf-8");
}
