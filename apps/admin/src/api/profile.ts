import { requestJson, updateAdminCsrf } from "./client";
import type { AdminMePayload } from "./session";

export interface AdminProfilePayload {
	user: AdminMePayload["user"] & {
		website?: string | null;
		avatarUrl?: string | null;
	};
	sites: string[];
	session: {
		expiresAt: string;
	};
}

export function fetchAdminProfile() {
	return requestJson<AdminProfilePayload>("/api/admin/profile");
}

export function updateAdminProfile(input: {
	displayName?: string;
	website?: string;
	avatarUrl?: string;
}) {
	return requestJson<AdminProfilePayload>("/api/admin/profile", {
		method: "PATCH",
		body: JSON.stringify(input),
	});
}

export function updateAdminProfilePassword(input: {
	currentPassword: string;
	nextPassword: string;
}) {
	return requestJson<AdminProfilePayload>("/api/admin/profile/password", {
		method: "POST",
		body: JSON.stringify(input),
	}).then((payload) => {
		updateAdminCsrf({ token: null });
		return payload;
	});
}

export type AdminEmailChangeResponse =
	| {
			status: "pending_verification";
			newEmail: string;
			expiresAt: string;
			verificationToken?: string;
	  }
	| {
			status: "changed";
			user: AdminMePayload["user"];
	  };

export function requestAdminProfileEmailChange(input: {
	newEmail: string;
	currentPassword?: string;
}) {
	return requestJson<AdminEmailChangeResponse>(
		"/api/admin/profile/email-change",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	).then((payload) => {
		if (payload.status === "changed") {
			updateAdminCsrf({ token: null });
		}
		return payload;
	});
}

export function confirmAdminProfileEmailChange(input: { token: string }) {
	return requestJson<AdminProfilePayload>(
		"/api/admin/profile/email-change/confirm",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}
