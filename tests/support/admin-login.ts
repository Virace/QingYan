import type { FastifyInstance } from "fastify";

import {
	getForcedTestCaptchaAnswer,
	withForcedTestCaptchaAnswer,
} from "./captcha";

export async function loginAsAdmin(
	app: FastifyInstance,
	options?: {
		password?: string;
	},
) {
	return withForcedTestCaptchaAnswer(async () => {
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
				username: "admin",
				password: options?.password ?? "replace-me",
				challengeId: challenge.challengeId,
				captchaValue: getForcedTestCaptchaAnswer(),
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
		const payload = loginResponse.json() as {
			csrf?: {
				header?: string;
				token?: string;
			};
		};
		if (!payload.csrf?.token) {
			throw new Error("Expected csrf token in login response");
		}

		return {
			adminCookie,
			csrfToken: payload.csrf.token,
			loginResponse,
		};
	});
}

export function withAdminWriteAuth(input: {
	adminCookie: { value: string };
	csrfToken: string;
	origin?: string;
}) {
	return {
		cookies: {
			qingyan_admin: input.adminCookie.value,
		},
		headers: {
			origin: input.origin ?? "http://localhost:4401",
			"x-qingyan-csrf-token": input.csrfToken,
		},
	};
}
