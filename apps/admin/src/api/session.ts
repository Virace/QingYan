import { requestJson } from "./client";

export interface CaptchaChallenge {
	challengeId: string;
	mode: "inline_value";
	imageData: string;
	expiresAt: string;
}

export interface AdminSiteSummary {
	siteKey: string;
	name: string;
}

export interface AdminSessionPayload {
	authenticated: true;
	session: {
		expiresAt: string;
	};
}

export interface AdminMePayload extends AdminSessionPayload {
	sites: AdminSiteSummary[];
}

export function fetchAdminCaptcha() {
	return requestJson<{ challenge: CaptchaChallenge }>(
		"/api/admin/session/captcha",
	);
}

export function loginAdmin(input: {
	username: string;
	password: string;
	challengeId?: string;
	captchaValue: string;
}) {
	return requestJson<AdminSessionPayload>("/api/admin/session/login", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function logoutAdmin() {
	return requestJson<{ authenticated: false }>("/api/admin/session/logout", {
		method: "POST",
		body: "{}",
	});
}

export function fetchAdminMe() {
	return requestJson<AdminMePayload>("/api/admin/session/me");
}
