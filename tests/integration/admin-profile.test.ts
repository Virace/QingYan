import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminGroups,
	adminSessions,
	adminUserGroups,
	adminUsers,
	adminProfileVerificationTokens,
} from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

type TestFixture = Awaited<ReturnType<typeof createTestApp>>;
type SentProfileEmail = {
	to: string;
	from: string;
	subject?: string;
	body: string;
	format: "html" | "text" | "json";
};

async function createProfileUser(
	fixture: TestFixture,
	input: {
		username: string;
		passwordChangeRequired?: boolean;
	},
) {
	const [group] = await fixture.app.db
		.select()
		.from(adminGroups)
		.where(eq(adminGroups.key, "site_admin"));
	if (!group) {
		throw new Error("Expected site_admin group");
	}
	await fixture.app.db.insert(adminUsers).values({
		username: input.username,
		email: `${input.username}@example.test`,
		passwordHash: createPasswordHash("replace-me"),
		displayName: input.username,
		status: "active",
		passwordChangeRequired: input.passwordChangeRequired ?? false,
	});
	const [user] = await fixture.app.db
		.select()
		.from(adminUsers)
		.where(eq(adminUsers.username, input.username));
	if (!user) {
		throw new Error(`Expected ${input.username}`);
	}
	await fixture.app.db.insert(adminUserGroups).values({
		userId: user.id,
		groupId: group.id,
	});
	return user;
}

describe("admin profile api", () => {
	it("returns and updates only the current user's self-editable profile fields", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createProfileUser(fixture, {
			username: "profile-user",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "profile-user",
			password: "replace-me",
		});

		const readResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/profile",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(readResponse.statusCode).toBe(200);
		expect(readResponse.json()).toMatchObject({
			user: {
				username: "profile-user",
				displayName: "profile-user",
				groupKey: "site_admin",
				passwordChangeRequired: false,
			},
		});

		const updateResponse = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/profile",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				displayName: "Updated Profile",
				website: "https://profile.example.test",
				avatarUrl: "https://profile.example.test/avatar.png",
				groupKey: "admin",
				status: "disabled",
				isInitialAdmin: true,
				siteKeys: ["fangyuan"],
			},
		});
		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json()).toMatchObject({
			user: {
				username: "profile-user",
				displayName: "Updated Profile",
				groupKey: "site_admin",
				passwordChangeRequired: false,
			},
		});

		const [stored] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "profile-user"));
		expect(stored).toMatchObject({
			displayName: "Updated Profile",
			website: "https://profile.example.test",
			avatarUrl: "https://profile.example.test/avatar.png",
			status: "active",
			isInitialAdmin: false,
		});
	});

	it("gates password-change-required users until they change their password", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createProfileUser(fixture, {
			username: "must-change",
			passwordChangeRequired: true,
		});
		const { adminCookie } = await loginAsAdmin(fixture.app, {
			username: "must-change",
			password: "replace-me",
		});

		const meResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(meResponse.statusCode).toBe(200);
		expect(meResponse.json()).toMatchObject({
			user: {
				passwordChangeRequired: true,
			},
		});
		const nextCsrf = (meResponse.json() as { csrf: { token: string } }).csrf
			.token;

		const blockedResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/overview",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(blockedResponse.statusCode).toBe(403);
		expect(blockedResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_PASSWORD_CHANGE_REQUIRED",
			},
		});

		const passwordResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/password",
			...withAdminWriteAuth({ adminCookie, csrfToken: nextCsrf }),
			payload: {
				currentPassword: "replace-me",
				nextPassword: "next-password",
				confirmPassword: "next-password",
			},
		});
		expect(passwordResponse.statusCode).toBe(200);
		expect(passwordResponse.json()).toMatchObject({
			user: {
				username: "must-change",
				passwordChangeRequired: false,
			},
		});

		const allowedResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/overview",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(allowedResponse.statusCode).toBe(200);

		const oldLogin = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/session/login",
			payload: {
				username: "must-change",
				password: "replace-me",
				captchaValue: "2468",
			},
		});
		expect(oldLogin.statusCode).not.toBe(200);

		const newLogin = await loginAsAdmin(fixture.app, {
			username: "must-change",
			password: "next-password",
		});
		expect(newLogin.loginResponse.statusCode).toBe(200);
	});

	it("rejects password changes when confirmation does not match", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createProfileUser(fixture, {
			username: "password-mismatch-user",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "password-mismatch-user",
			password: "replace-me",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/password",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				currentPassword: "replace-me",
				nextPassword: "next-password",
				confirmPassword: "different-password",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "INVALID_REQUEST",
			},
		});
		const oldLogin = await loginAsAdmin(fixture.app, {
			username: "password-mismatch-user",
			password: "replace-me",
		});
		expect(oldLogin.loginResponse.statusCode).toBe(200);
	});

	it("changes password immediately and keeps the current session valid when verification cannot run", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createProfileUser(fixture, {
			username: "direct-password-user",
		});
		const initialAdmin = await loginAsAdmin(fixture.app);
		const settingsResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie: initialAdmin.adminCookie,
				csrfToken: initialAdmin.csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				admin: {
					emailVerification: {
						selfServiceRequired: true,
					},
				},
				mail: {
					enabled: false,
					smtp: {
						host: "",
						port: 465,
						secure: true,
						username: "",
						from: "",
					},
				},
			},
		});
		expect(settingsResponse.statusCode).toBe(200);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "direct-password-user",
			password: "replace-me",
		});

		const invalidPasswordResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/password",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				currentPassword: "wrong-password",
				nextPassword: "next-password",
				confirmPassword: "next-password",
			},
		});
		expect(invalidPasswordResponse.statusCode).toBe(403);
		expect(invalidPasswordResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_CURRENT_PASSWORD_INVALID",
			},
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/password",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				currentPassword: "replace-me",
				nextPassword: "next-password",
				confirmPassword: "next-password",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			user: {
				username: "direct-password-user",
				passwordChangeRequired: false,
			},
		});
		const sessionResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(sessionResponse.statusCode).toBe(200);

		const oldLogin = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/session/login",
			payload: {
				username: "direct-password-user",
				password: "replace-me",
				captchaValue: "2468",
			},
		});
		expect(oldLogin.statusCode).not.toBe(200);
		const newLogin = await loginAsAdmin(fixture.app, {
			username: "direct-password-user",
			password: "next-password",
		});
		expect(newLogin.loginResponse.statusCode).toBe(200);
	});

	it("stores a pending password hash and changes password after email verification", async () => {
		const sentProfileEmails: SentProfileEmail[] = [];
		const fixture = await createTestApp({
			adminProfileEmailSender: async (input) => {
				sentProfileEmails.push(input);
				return { providerMessageId: "profile-password-1" };
			},
		});
		cleanups.push(fixture.cleanup);
		const user = await createProfileUser(fixture, {
			username: "verified-password-user",
		});
		const initialAdmin = await loginAsAdmin(fixture.app);
		const settingsResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie: initialAdmin.adminCookie,
				csrfToken: initialAdmin.csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				admin: {
					emailVerification: {
						selfServiceRequired: true,
					},
				},
				mail: {
					enabled: true,
					smtp: {
						host: "smtp.example.test",
						port: 465,
						secure: true,
						username: "smtp-user",
						password: "smtp-secret",
						from: "QingYan <noreply@example.test>",
					},
				},
			},
		});
		expect(settingsResponse.statusCode).toBe(200);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "verified-password-user",
			password: "replace-me",
		});

		const requestResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/password",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				currentPassword: "replace-me",
				nextPassword: "next-password",
				confirmPassword: "next-password",
			},
		});

		expect(requestResponse.statusCode).toBe(200);
		expect(requestResponse.json()).toMatchObject({
			status: "pending_verification",
			expiresAt: expect.any(String),
		});
		expect(requestResponse.json().verificationToken).toBeUndefined();
		expect(sentProfileEmails).toHaveLength(1);
		expect(sentProfileEmails[0]).toMatchObject({
			to: "verified-password-user@example.test",
			format: "text",
		});
		const code = sentProfileEmails[0]?.body.match(/\b\d{6}\b/u)?.[0];
		expect(code).toEqual(expect.any(String));

		const tokens = await fixture.app.db
			.select()
			.from(adminProfileVerificationTokens)
			.where(eq(adminProfileVerificationTokens.userId, user.id));
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toMatchObject({
			purpose: "password_change",
			newEmail: null,
			consumedAt: null,
		});
		expect(tokens[0]?.pendingPasswordHash).toMatch(/^scrypt:/);

		const oldLogin = await loginAsAdmin(fixture.app, {
			username: "verified-password-user",
			password: "replace-me",
		});
		expect(oldLogin.loginResponse.statusCode).toBe(200);

		const confirmResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/password/confirm",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				token: code,
			},
		});
		expect(confirmResponse.statusCode).toBe(200);
		expect(confirmResponse.json()).toMatchObject({
			user: {
				username: "verified-password-user",
				passwordChangeRequired: false,
			},
		});
		const sessionResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(sessionResponse.statusCode).toBe(200);

		const newLogin = await loginAsAdmin(fixture.app, {
			username: "verified-password-user",
			password: "next-password",
		});
		expect(newLogin.loginResponse.statusCode).toBe(200);
	});

	it("creates and consumes email verification tokens for ordinary self-service email changes without leaking codes", async () => {
		const sentProfileEmails: SentProfileEmail[] = [];
		const fixture = await createTestApp({
			emailSender: async (input) => {
				sentProfileEmails.push(input);
				return { providerMessageId: "profile-email-1" };
			},
		});
		cleanups.push(fixture.cleanup);
		const user = await createProfileUser(fixture, {
			username: "email-change-user",
		});
		await createProfileUser(fixture, {
			username: "email-change-taken",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "email-change-user",
			password: "replace-me",
		});
		const initialAdmin = await loginAsAdmin(fixture.app);
		const settingsResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie: initialAdmin.adminCookie,
				csrfToken: initialAdmin.csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				admin: {
					session: {
						ttlMinutes: 4320,
					},
					emailVerification: {
						selfServiceRequired: true,
					},
				},
				mail: {
					enabled: true,
					smtp: {
						host: "smtp.example.test",
						port: 465,
						secure: true,
						username: "smtp-user",
						password: "smtp-secret",
						from: "QingYan <noreply@example.test>",
					},
				},
			},
		});
		expect(settingsResponse.statusCode).toBe(200);

		const duplicateResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/email-change",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				newEmail: "email-change-taken@example.test",
				currentPassword: "replace-me",
			},
		});
		expect(duplicateResponse.statusCode).toBe(409);
		expect(duplicateResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_EMAIL_ALREADY_EXISTS",
			},
		});

		const requestResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/email-change",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				newEmail: "Next.Email@Example.test",
				currentPassword: "replace-me",
			},
		});
		expect(requestResponse.statusCode).toBe(200);
		const requestPayload = requestResponse.json() as {
			status: string;
			newEmail: string;
			expiresAt: string;
			verificationToken?: string;
			code?: string;
		};
		expect(requestPayload).toMatchObject({
			status: "pending_verification",
			newEmail: "next.email@example.test",
		});
		expect(requestPayload.expiresAt).toEqual(expect.any(String));
		expect(requestPayload.verificationToken).toBeUndefined();
		expect(requestPayload.code).toBeUndefined();
		expect(sentProfileEmails).toHaveLength(1);
		expect(sentProfileEmails[0]).toMatchObject({
			to: "next.email@example.test",
			format: "text",
		});
		const code = sentProfileEmails[0]?.body.match(/\b\d{6}\b/u)?.[0];
		expect(code).toEqual(expect.any(String));

		const tokens = await fixture.app.db
			.select()
			.from(adminProfileVerificationTokens)
			.where(eq(adminProfileVerificationTokens.userId, user.id));
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toMatchObject({
			purpose: "email_change",
			newEmail: "next.email@example.test",
			pendingPasswordHash: null,
			consumedAt: null,
		});
		expect(tokens[0]?.tokenHash).toEqual(expect.any(String));

		const confirmResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/email-change/confirm",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				token: code,
			},
		});
		expect(confirmResponse.statusCode).toBe(200);
		expect(confirmResponse.json()).toMatchObject({
			user: {
				username: "email-change-user",
				email: "next.email@example.test",
			},
		});

		const reusedResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/email-change/confirm",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				token: code,
			},
		});
		expect(reusedResponse.statusCode).toBe(400);
		expect(reusedResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_EMAIL_VERIFICATION_TOKEN_INVALID",
			},
		});
	});

	it("changes email immediately without revoking the current session when verification is disabled", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const user = await createProfileUser(fixture, {
			username: "direct-email-user",
		});
		const initialAdmin = await loginAsAdmin(fixture.app);
		const settingsResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/system-settings",
			...withAdminWriteAuth({
				adminCookie: initialAdmin.adminCookie,
				csrfToken: initialAdmin.csrfToken,
			}),
			payload: {
				logging: {
					level: "info",
					retentionDays: 7,
				},
				admin: {
					session: {
						ttlMinutes: 4320,
					},
					emailVerification: {
						selfServiceRequired: false,
					},
				},
			},
		});
		expect(settingsResponse.statusCode).toBe(200);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "direct-email-user",
			password: "replace-me",
		});

		const invalidPasswordResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/email-change",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				newEmail: "direct-next@example.test",
				currentPassword: "wrong-password",
			},
		});
		expect(invalidPasswordResponse.statusCode).toBe(403);
		expect(invalidPasswordResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_CURRENT_PASSWORD_INVALID",
			},
		});

		const directResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/email-change",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				newEmail: "Direct.Next@Example.test",
				currentPassword: "replace-me",
			},
		});
		expect(directResponse.statusCode).toBe(200);
		expect(directResponse.json()).toMatchObject({
			status: "changed",
			user: {
				username: "direct-email-user",
				email: "direct.next@example.test",
			},
		});

		const [stored] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.id, user.id));
		expect(stored?.email).toBe("direct.next@example.test");

		const [directUserSession] = await fixture.app.db
			.select()
			.from(adminSessions)
			.where(eq(adminSessions.userId, user.id));
		expect(directUserSession?.revokedAt).toBeNull();

		const afterChangeResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(afterChangeResponse.statusCode).toBe(200);
		expect(afterChangeResponse.json()).toMatchObject({
			user: {
				username: "direct-email-user",
				email: "direct.next@example.test",
			},
		});
	});

	it("lets admins change their own email immediately without verification", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/email-change",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				newEmail: "Initial.Admin.Next@Example.test",
				currentPassword: "replace-me",
			},
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			status: "changed",
			user: {
				username: "admin",
				email: "initial.admin.next@example.test",
			},
		});

		const [stored] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		expect(stored?.email).toBe("initial.admin.next@example.test");
	});

	it("rejects expired email verification tokens", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const user = await createProfileUser(fixture, {
			username: "expired-token-user",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "expired-token-user",
			password: "replace-me",
		});

		await fixture.app.db.insert(adminProfileVerificationTokens).values({
			purpose: "email_change",
			userId: user.id,
			newEmail: "expired-next@example.test",
			tokenHash:
				"b52b3ef2233858ce1156d85f235cf2c41eddfa8ca1eedc924398b9af1db303cb",
			expiresAt: "2020-01-01T00:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/profile/email-change/confirm",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				token: "expired-token",
			},
		});
		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_EMAIL_VERIFICATION_TOKEN_EXPIRED",
			},
		});
	});
});
