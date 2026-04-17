import type { FastifyInstance } from "fastify";

function extractCaptchaAnswer(imageData: string): string {
	const encoded = imageData.split(",")[1];
	if (!encoded) {
		throw new Error("Expected captcha image data");
	}

	const svg = Buffer.from(encoded, "base64").toString("utf-8");
	const matched = svg.match(/>(\d{4})</);
	if (!matched?.[1]) {
		throw new Error("Expected captcha answer in SVG");
	}

	return matched[1];
}

export async function loginAsAdmin(app: FastifyInstance) {
	const captchaResponse = await app.inject({
		method: "GET",
		url: "/api/admin/session/captcha",
	});
	if (captchaResponse.statusCode !== 200) {
		throw new Error(
			`Expected admin captcha response, got ${captchaResponse.statusCode}`,
		);
	}

	const { challenge } = captchaResponse.json() as {
		challenge: {
			challengeId: string;
			imageData: string;
		};
	};

	const loginResponse = await app.inject({
		method: "POST",
		url: "/api/admin/session/login",
		payload: {
			token: "replace-me",
			challengeId: challenge.challengeId,
			captchaValue: extractCaptchaAnswer(challenge.imageData),
		},
	});
	if (loginResponse.statusCode !== 200) {
		throw new Error(
			`Expected admin login response, got ${loginResponse.statusCode}`,
		);
	}

	const adminCookie = loginResponse.cookies.find(
		(cookie) => cookie.name === "qingyan_admin",
	);
	if (!adminCookie?.value) {
		throw new Error("Expected qingyan_admin cookie");
	}

	return {
		adminCookie,
		loginResponse,
	};
}
