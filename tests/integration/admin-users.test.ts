import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	auditLogs,
	adminGroups,
	adminSessions,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	sites,
} from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { permissionsForGroup } from "../../src/modules/admin/permissions";
import {
	PAGE_REGISTRY_SYSTEM_USERNAME,
	SYSTEM_BUILTIN_GROUP_KEY,
	SystemPrincipalService,
} from "../../src/modules/tasks/system-principal";
import {
	getForcedTestCaptchaAnswer,
	withForcedTestCaptchaAnswer,
} from "../support/captcha";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

type TestFixture = Awaited<ReturnType<typeof createTestApp>>;

async function createUser(
	fixture: TestFixture,
	input: {
		username: string;
		groupKey: "admin" | "site_admin" | "site_moderator";
		siteKeys?: string[];
		isInitialAdmin?: boolean;
		password?: string;
	},
) {
	const [group] = await fixture.app.db
		.select()
		.from(adminGroups)
		.where(eq(adminGroups.key, input.groupKey));
	if (!group) {
		throw new Error(`Expected group ${input.groupKey}`);
	}
	await fixture.app.db.insert(adminUsers).values({
		username: input.username,
		email: `${input.username}@example.test`,
		passwordHash: createPasswordHash(input.password ?? "replace-me"),
		displayName: input.username,
		status: "active",
		isInitialAdmin: input.isInitialAdmin ?? false,
	});
	const [user] = await fixture.app.db
		.select()
		.from(adminUsers)
		.where(eq(adminUsers.username, input.username));
	if (!user) {
		throw new Error(`Expected user ${input.username}`);
	}
	await fixture.app.db.insert(adminUserGroups).values({
		userId: user.id,
		groupId: group.id,
	});
	for (const siteKey of input.siteKeys ?? []) {
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, siteKey));
		if (!site) {
			throw new Error(`Expected site ${siteKey}`);
		}
		await fixture.app.db.insert(adminUserSiteAccess).values({
			userId: user.id,
			siteId: site.id,
		});
	}
	return user;
}

describe("admin users api", () => {
	it("keeps the system principal hidden, unprivileged, and unable to log in", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const service = new SystemPrincipalService(fixture.app.db);

		const firstPrincipal = await service.ensurePageRegistryPrincipal();
		await fixture.app.db
			.update(adminUsers)
			.set({
				displayName: "Drifted System User",
				status: "active",
				loginBlockedUntil: null,
			})
			.where(eq(adminUsers.id, firstPrincipal.id));
		const repairedPrincipal = await service.ensurePageRegistryPrincipal();
		const repeatedPrincipal = await service.ensurePageRegistryPrincipal();

		expect(repairedPrincipal.id).toBe(firstPrincipal.id);
		expect(repeatedPrincipal.id).toBe(firstPrincipal.id);
		expect(repairedPrincipal).toMatchObject({
			username: PAGE_REGISTRY_SYSTEM_USERNAME,
			displayName: "系统：页面注册表",
			status: "system",
			loginBlockedUntil: "9999-12-31T23:59:59.999Z",
			deletedAt: null,
		});
		expect(permissionsForGroup(SYSTEM_BUILTIN_GROUP_KEY)).toEqual([]);

		const memberships = await fixture.app.db
			.select({
				groupKey: adminGroups.key,
			})
			.from(adminUserGroups)
			.innerJoin(adminGroups, eq(adminGroups.id, adminUserGroups.groupId))
			.where(eq(adminUserGroups.userId, firstPrincipal.id));
		expect(memberships).toEqual([{ groupKey: SYSTEM_BUILTIN_GROUP_KEY }]);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const groupsResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/groups",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(groupsResponse.statusCode).toBe(200);
		expect(
			groupsResponse.json().groups.map((group: { key: string }) => group.key),
		).toEqual(["admin", "site_admin", "site_moderator"]);

		const usersResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/users",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(usersResponse.statusCode).toBe(200);
		expect(
			usersResponse
				.json()
				.users.map((user: { username: string }) => user.username),
		).toEqual(["admin"]);

		const loginResponse = await withForcedTestCaptchaAnswer(async () => {
			const captchaResponse = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/captcha",
			});
			const { challenge } = captchaResponse.json() as {
				challenge: { challengeId: string };
			};
			return fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/session/login",
				payload: {
					username: PAGE_REGISTRY_SYSTEM_USERNAME,
					password: "replace-me",
					challengeId: challenge.challengeId,
					captchaValue: getForcedTestCaptchaAnswer(),
				},
			});
		});
		expect(loginResponse.statusCode).toBe(401);
		expect(loginResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_CREDENTIALS_INVALID",
			},
		});
	}, 15_000);

	it("lets admins list users and fixed groups", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie } = await loginAsAdmin(fixture.app);

		const usersResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/users",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(usersResponse.statusCode).toBe(200);
		expect(usersResponse.json()).toMatchObject({
			users: [
				{
					username: "admin",
					groupKey: "admin",
					isInitialAdmin: true,
					status: "active",
				},
			],
		});

		const groupsResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/groups",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(groupsResponse.statusCode).toBe(200);
		expect(groupsResponse.json()).toMatchObject({
			groups: [
				{ key: "admin", name: "管理员" },
				{ key: "site_admin", name: "站点管理员" },
				{ key: "site_moderator", name: "站点评论管理员" },
			],
		});
	});

	it("lets an initial admin create an admin user and site-scoped users", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const adminResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/users",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				username: "second-admin",
				email: "second-admin@example.test",
				displayName: "Second Admin",
				password: "admin-password",
				groupKey: "admin",
				siteKeys: [],
			},
		});
		expect(adminResponse.statusCode).toBe(200);
		expect(adminResponse.json()).toMatchObject({
			user: {
				username: "second-admin",
				groupKey: "admin",
				isInitialAdmin: false,
			},
		});

		const siteUserResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/users",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				username: "site-admin",
				email: "site-admin@example.test",
				displayName: "Site Admin",
				password: "site-password",
				groupKey: "site_admin",
				siteKeys: ["fangyuan"],
				passwordChangeRequired: true,
			},
		});
		expect(siteUserResponse.statusCode).toBe(200);
		expect(siteUserResponse.json()).toMatchObject({
			user: {
				username: "site-admin",
				groupKey: "site_admin",
				siteKeys: ["fangyuan"],
				passwordChangeRequired: true,
			},
		});
	});

	it("prevents ordinary admins from creating or mutating admin users", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createUser(fixture, {
			username: "ordinary-admin",
			groupKey: "admin",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "ordinary-admin",
			password: "replace-me",
		});

		const createAdminResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/users",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				username: "forbidden-admin",
				email: "forbidden-admin@example.test",
				displayName: "Forbidden Admin",
				password: "forbidden-password",
				groupKey: "admin",
				siteKeys: [],
			},
		});
		expect(createAdminResponse.statusCode).toBe(403);
		expect(createAdminResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_INITIAL_ADMIN_REQUIRED",
			},
		});

		const [initialAdmin] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		const updateAdminResponse = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/users/${initialAdmin?.id}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				displayName: "Blocked",
			},
		});
		expect(updateAdminResponse.statusCode).toBe(403);
		expect(updateAdminResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_TARGET_USER_FORBIDDEN",
			},
		});
	});

	it("prevents site-scoped users from accessing user management", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createUser(fixture, {
			username: "scoped-user",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const { adminCookie } = await loginAsAdmin(fixture.app, {
			username: "scoped-user",
			password: "replace-me",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/users",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_PERMISSION_REQUIRED",
			},
		});
	});

	it("resets a site user password and invalidates existing sessions", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createUser(fixture, {
			username: "reset-target",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const targetLogin = await loginAsAdmin(fixture.app, {
			username: "reset-target",
			password: "replace-me",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const [target] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "reset-target"));

		const response = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/users/${target?.id}/reset-password`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				password: "new-password",
				passwordChangeRequired: true,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			user: {
				username: "reset-target",
				passwordChangeRequired: true,
			},
			revokedSessions: 1,
		});

		const oldMe = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
			cookies: {
				qingyan_admin: targetLogin.adminCookie.value,
			},
		});
		expect(oldMe.statusCode).toBe(401);
		expect(oldMe.json()).toMatchObject({
			error: {
				code: "ADMIN_SESSION_REVOKED",
			},
		});

		const newLogin = await loginAsAdmin(fixture.app, {
			username: "reset-target",
			password: "new-password",
		});
		expect(newLogin.loginResponse.statusCode).toBe(200);
	});

	it("disables a site user and invalidates existing sessions", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createUser(fixture, {
			username: "disable-target",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});
		const targetLogin = await loginAsAdmin(fixture.app, {
			username: "disable-target",
			password: "replace-me",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const [target] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "disable-target"));

		const response = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/users/${target?.id}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				status: "disabled",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			user: {
				username: "disable-target",
				status: "disabled",
			},
			revokedSessions: 1,
		});

		const oldMe = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
			cookies: {
				qingyan_admin: targetLogin.adminCookie.value,
			},
		});
		expect(oldMe.statusCode).toBe(401);
		expect(oldMe.json()).toMatchObject({
			error: {
				code: "ADMIN_SESSION_REVOKED",
			},
		});
	});

	it("soft deletes a site user, revokes sessions, and records an audit log", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createUser(fixture, {
			username: "delete-target",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});
		const targetLogin = await loginAsAdmin(fixture.app, {
			username: "delete-target",
			password: "replace-me",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const [target] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "delete-target"));

		const response = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/users/${target?.id}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			user: {
				username: "delete-target",
				status: "deleted",
			},
			revokedSessions: 1,
		});

		const oldMe = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
			cookies: {
				qingyan_admin: targetLogin.adminCookie.value,
			},
		});
		expect(oldMe.statusCode).toBe(401);

		const audits = await fixture.app.db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.action, "admin.user.deleted"));
		expect(audits).toEqual([
			expect.objectContaining({
				actorType: "admin_user",
				actorId: expect.any(String),
				targetType: "admin_user",
				targetId: String(target?.id),
			}),
		]);
		expect(JSON.parse(audits[0]?.payloadJson ?? "{}")).toMatchObject({
			target: {
				username: "delete-target",
				groupKey: "site_moderator",
			},
			affectedCount: 1,
		});
	});

	it("force revokes a site user's sessions and blocks login until the preset expires", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createUser(fixture, {
			username: "revoke-target",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const targetLogin = await loginAsAdmin(fixture.app, {
			username: "revoke-target",
			password: "replace-me",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const [target] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "revoke-target"));

		const response = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/users/${target?.id}/revoke-sessions`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				loginBlockPreset: "1h",
				reason: "security review",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			user: {
				username: "revoke-target",
			},
			revokedSessions: 1,
		});
		expect(response.json().user.loginBlockedUntil).toEqual(expect.any(String));

		const oldMe = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
			cookies: {
				qingyan_admin: targetLogin.adminCookie.value,
			},
		});
		expect(oldMe.statusCode).toBe(401);
		expect(oldMe.json()).toMatchObject({
			error: {
				code: "ADMIN_SESSION_REVOKED",
			},
		});

		const blockedLogin = await withForcedTestCaptchaAnswer(async () => {
			const captchaResponse = await fixture.app.inject({
				method: "GET",
				url: "/qingyan/api/admin/session/captcha",
			});
			const { challenge } = captchaResponse.json() as {
				challenge: { challengeId: string };
			};
			return fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/session/login",
				payload: {
					username: "revoke-target",
					password: "replace-me",
					challengeId: challenge.challengeId,
					captchaValue: getForcedTestCaptchaAnswer(),
				},
			});
		});
		expect(blockedLogin.statusCode).toBe(403);
		expect(blockedLogin.json()).toMatchObject({
			error: {
				code: "ADMIN_LOGIN_BLOCKED",
			},
		});

		const revokedSessions = await fixture.app.db
			.select()
			.from(adminSessions)
			.where(eq(adminSessions.userId, target?.id ?? 0));
		expect(revokedSessions).toEqual([
			expect.objectContaining({
				revokedAt: expect.any(String),
				revocationReason: "security review",
			}),
		]);
		const audits = await fixture.app.db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.action, "admin.user.sessions_revoked"));
		expect(JSON.parse(audits[0]?.payloadJson ?? "{}")).toMatchObject({
			affectedCount: 1,
			loginBlockedUntil: response.json().user.loginBlockedUntil,
			reason: "security review",
		});
	});

	it("lists only active non-revoked user sessions for force logout state", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createUser(fixture, {
			username: "session-state-target",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		await loginAsAdmin(fixture.app, {
			username: "session-state-target",
			password: "replace-me",
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const [target] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "session-state-target"));
		if (!target) {
			throw new Error("Expected target user");
		}
		await fixture.app.db.insert(adminSessions).values([
			{
				id: "expired_session_state_target",
				userId: target.id,
				tokenHash: "expired_session_hash",
				expiresAt: "2000-01-01T00:00:00.000Z",
				lastSeenAt: "2000-01-01T00:00:00.000Z",
			},
			{
				id: "revoked_session_state_target",
				userId: target.id,
				tokenHash: "revoked_session_hash",
				expiresAt: "2099-01-01T00:00:00.000Z",
				revokedAt: "2026-06-02T00:00:00.000Z",
				revocationReason: "test",
				lastSeenAt: "2026-06-02T00:00:00.000Z",
			},
		]);

		const listBefore = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/users",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(listBefore.statusCode).toBe(200);
		const targetBefore = listBefore
			.json()
			.users.find(
				(user: { username: string }) =>
					user.username === "session-state-target",
			);
		expect(targetBefore).toMatchObject({
			username: "session-state-target",
			activeSessionCount: 1,
		});
		expect(typeof targetBefore.lastSessionSeenAt).toBe("string");

		const revoke = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/users/${target.id}/revoke-sessions`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				loginBlockPreset: "none",
				reason: "session state test",
			},
		});
		expect(revoke.statusCode).toBe(200);

		const listAfter = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/users",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(listAfter.statusCode).toBe(200);
		const targetAfter = listAfter
			.json()
			.users.find(
				(user: { username: string }) =>
					user.username === "session-state-target",
			);
		expect(targetAfter).toMatchObject({
			activeSessionCount: 0,
			lastSessionSeenAt: null,
		});
	});

	it("prevents removing the initial admin protections and the final active admin", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const [initialAdmin] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));

		const disableInitial = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/users/${initialAdmin?.id}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				status: "disabled",
			},
		});
		expect(disableInitial.statusCode).toBe(403);
		expect(disableInitial.json()).toMatchObject({
			error: {
				code: "ADMIN_INITIAL_ADMIN_PROTECTED",
			},
		});

		const demoteInitial = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/users/${initialAdmin?.id}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				groupKey: "site_admin",
				siteKeys: ["fangyuan"],
			},
		});
		expect(demoteInitial.statusCode).toBe(403);
		expect(demoteInitial.json()).toMatchObject({
			error: {
				code: "ADMIN_INITIAL_ADMIN_PROTECTED",
			},
		});

		await createUser(fixture, {
			username: "second-admin-final",
			groupKey: "admin",
		});
		const finalAdminLogin = await loginAsAdmin(fixture.app, {
			username: "second-admin-final",
			password: "replace-me",
		});
		const [secondAdmin] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "second-admin-final"));
		await fixture.app.db
			.update(adminUsers)
			.set({ status: "disabled" })
			.where(eq(adminUsers.id, initialAdmin?.id ?? 0));

		const disableFinalAdmin = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/users/${secondAdmin?.id}`,
			...withAdminWriteAuth({
				adminCookie: finalAdminLogin.adminCookie,
				csrfToken: finalAdminLogin.csrfToken,
			}),
			payload: {
				status: "disabled",
			},
		});
		expect(disableFinalAdmin.statusCode).toBe(403);
		expect(disableFinalAdmin.json()).toMatchObject({
			error: {
				code: "ADMIN_LAST_ACTIVE_ADMIN",
			},
		});
	});
});
