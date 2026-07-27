import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	sites,
} from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { AdminRepository } from "../../src/modules/admin/repository";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

type Fixture = Awaited<ReturnType<typeof createTestApp>>;

async function createSecondSite(fixture: Fixture) {
	const repository = new AdminRepository(fixture.app.db);
	await repository.createSite({
		siteKey: "qingyan",
		name: "QingYan",
		allowedOrigins: ["http://localhost:4322"],
	});
	await fixture.app.siteRegistry.loadFromDatabase(fixture.app.db);
}

async function createScopedUser(
	fixture: Fixture,
	input: {
		username: string;
		groupKey: "site_admin" | "site_moderator";
		siteKeys: string[];
	},
) {
	const [group] = await fixture.app.db
		.select()
		.from(adminGroups)
		.where(eq(adminGroups.key, input.groupKey));
	if (!group) {
		throw new Error(`Expected group ${input.groupKey}.`);
	}
	await fixture.app.db.insert(adminUsers).values({
		username: input.username,
		email: `${input.username}@example.test`,
		passwordHash: createPasswordHash("replace-me"),
		displayName: input.username,
		status: "active",
	});
	const [user] = await fixture.app.db
		.select()
		.from(adminUsers)
		.where(eq(adminUsers.username, input.username));
	if (!user) {
		throw new Error(`Expected user ${input.username}.`);
	}
	await fixture.app.db.insert(adminUserGroups).values({
		userId: user.id,
		groupId: group.id,
	});
	for (const siteKey of input.siteKeys) {
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, siteKey));
		if (!site) {
			throw new Error(`Expected site ${siteKey}.`);
		}
		await fixture.app.db.insert(adminUserSiteAccess).values({
			userId: user.id,
			siteId: site.id,
		});
	}
}

describe("admin notification diagnostics", () => {
	it("requires an authenticated admin session", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/notification-diagnostics",
		});

		expect(response.statusCode).toBe(401);
	});

	it("requires site access and site_settings.read", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSecondSite(fixture);
		await createScopedUser(fixture, {
			username: "diagnostics-other-site",
			groupKey: "site_admin",
			siteKeys: ["qingyan"],
		});
		await createScopedUser(fixture, {
			username: "diagnostics-moderator",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});

		const otherSiteAuth = await loginAsAdmin(fixture.app, {
			username: "diagnostics-other-site",
			password: "replace-me",
		});
		const siteDenied = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/notification-diagnostics",
			cookies: {
				qingyan_admin: otherSiteAuth.adminCookie.value,
			},
		});
		expect(siteDenied.statusCode).toBe(403);
		expect(siteDenied.json()).toMatchObject({
			error: { code: "ADMIN_SITE_ACCESS_REQUIRED" },
		});

		const moderatorAuth = await loginAsAdmin(fixture.app, {
			username: "diagnostics-moderator",
			password: "replace-me",
		});
		const permissionDenied = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/notification-diagnostics",
			cookies: {
				qingyan_admin: moderatorAuth.adminCookie.value,
			},
		});
		expect(permissionDenied.statusCode).toBe(403);
		expect(permissionDenied.json()).toMatchObject({
			error: { code: "ADMIN_PERMISSION_REQUIRED" },
		});
	});

	it("returns only saved-config diagnostics and runtime blocker evidence", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/notification-diagnostics?mail.enabled=true&backend.enabled=true",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body).toMatchObject({
			overall: "blocked",
			savedConfigOnly: true,
			runtime: {
				notificationWorker: "blocked",
				queueBackend: "database",
				lastTickAt: null,
			},
			flows: [
				{ key: "admin_comment_pending_email", status: "not_sending" },
				{ key: "admin_comment_approved_email", status: "not_sending" },
				{ key: "commenter_reply_email", status: "blocked" },
			],
		});
		expect(body.generatedAt).toEqual(expect.any(String));
		expect(body.flows[0].blockers).toEqual([]);
		const pendingCodes = body.flows[0].warnings.map(
			(warning: { code: string }) => warning.code,
		);
		expect(pendingCodes).toContain("backend_notifications_disabled");
		expect(JSON.stringify(body)).not.toContain("smtp.example");
		expect(JSON.stringify(body)).not.toContain("secret");
		expect(JSON.stringify(body)).not.toContain("unsubscribeToken");
		expect(JSON.stringify(body)).not.toContain("password");
	});
});
