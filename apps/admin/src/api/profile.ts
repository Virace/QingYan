import { requestJson } from "./client";
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
	confirmPassword: string;
}) {
	return requestJson<
		| AdminProfilePayload
		| {
				status: "pending_verification";
				expiresAt: string;
		  }
	>("/api/admin/profile/password", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function confirmAdminProfilePasswordChange(input: { token: string }) {
	return requestJson<AdminProfilePayload>(
		"/api/admin/profile/password/confirm",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export type AdminEmailChangeResponse =
	| {
			status: "pending_verification";
			newEmail: string;
			expiresAt: string;
	  }
	| {
			status: "changed";
			user: AdminMePayload["user"];
	  };

export function requestAdminProfileEmailChange(input: {
	newEmail: string;
	currentPassword: string;
}) {
	return requestJson<AdminEmailChangeResponse>(
		"/api/admin/profile/email-change",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
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
