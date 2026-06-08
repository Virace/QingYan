import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	sitePageRegistry,
	sites,
} from "../../src/db/schema";
import { AdminRepository } from "../../src/modules/admin/repository";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function createSecondSite(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
) {
	const repository = new AdminRepository(fixture.app.db);
	await repository.createSite({
		siteKey: "qingyan",
		name: "QingYan",
		allowedOrigins: ["http://localhost:4322"],
	});
	await fixture.app.siteRegistry.loadFromDatabase(fixture.app.db);
}

async function createScopedUser(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
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
		throw new Error(`Expected group ${input.groupKey} to exist`);
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
		throw new Error(`Expected user ${input.username} to exist`);
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
			throw new Error(`Expected site ${siteKey} to exist`);
		}
		await fixture.app.db.insert(adminUserSiteAccess).values({
			userId: user.id,
			siteId: site.id,
		});
	}
}

describe("admin api ACL", () => {
	it("rejects system settings access for site-scoped users", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie } = await loginAsAdmin(fixture.app, {
			username: "site-admin",
			password: "replace-me",
		});
		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/system-settings",
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

	it("allows site admins to manage granted site settings and rejects ungranted sites", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSecondSite(fixture);
		await createScopedUser(fixture, {
			username: "granted-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "granted-site-admin",
			password: "replace-me",
		});
		const grantedRead = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(grantedRead.statusCode).toBe(200);

		const ungrantedRead = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/qingyan/settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(ungrantedRead.statusCode).toBe(403);
		expect(ungrantedRead.json()).toMatchObject({
			error: {
				code: "ADMIN_SITE_ACCESS_REQUIRED",
			},
		});

		const grantedWrite = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				comments: {
					enabled: false,
				},
			},
		});
		expect(grantedWrite.statusCode).toBe(200);
	});

	it("allows site moderators to create blacklist rules but rejects blacklist deletion", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "site-moderator",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "site-moderator",
			password: "replace-me",
		});
		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/blacklist",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				targetType: "email",
				matchMode: "exact",
				targetValue: "blocked@example.test",
				scope: "post",
			},
		});
		expect(createResponse.statusCode).toBe(200);
		const ruleId = (createResponse.json() as { rule: { id: number } }).rule.id;

		const deleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/blacklist/${ruleId}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});
		expect(deleteResponse.statusCode).toBe(403);
		expect(deleteResponse.json()).toMatchObject({
			error: {
				code: "ADMIN_PERMISSION_REQUIRED",
			},
		});
	});

	it("enforces allowlist permissions and site scope", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSecondSite(fixture);
		await createScopedUser(fixture, {
			username: "allowlist-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		await createScopedUser(fixture, {
			username: "allowlist-site-moderator",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});

		const siteAdmin = await loginAsAdmin(fixture.app, {
			username: "allowlist-site-admin",
			password: "replace-me",
		});
		const moderator = await loginAsAdmin(fixture.app, {
			username: "allowlist-site-moderator",
			password: "replace-me",
		});
		const admin = await loginAsAdmin(fixture.app);

		const ownCreate = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/allowlist",
			...withAdminWriteAuth(siteAdmin),
			payload: {
				siteKey: "fangyuan",
				targetType: "ip",
				matchMode: "exact",
				targetValue: "203.0.113.1",
				scope: "post",
			},
		});
		expect(ownCreate.statusCode).toBe(200);
		const ownRuleId = (ownCreate.json() as { rule: { id: number } }).rule.id;

		const otherSiteCreate = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/allowlist",
			...withAdminWriteAuth(siteAdmin),
			payload: {
				siteKey: "qingyan",
				targetType: "ip",
				matchMode: "exact",
				targetValue: "203.0.113.2",
				scope: "post",
			},
		});
		expect(otherSiteCreate.statusCode).toBe(403);
		expect(otherSiteCreate.json()).toMatchObject({
			error: {
				code: "ADMIN_SITE_ACCESS_REQUIRED",
			},
		});

		const moderatorCreate = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/allowlist",
			...withAdminWriteAuth(moderator),
			payload: {
				siteKey: "fangyuan",
				targetType: "ip",
				matchMode: "exact",
				targetValue: "203.0.113.3",
				scope: "post",
			},
		});
		expect(moderatorCreate.statusCode).toBe(403);
		expect(moderatorCreate.json()).toMatchObject({
			error: {
				code: "ADMIN_PERMISSION_REQUIRED",
			},
		});

		const moderatorDelete = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/allowlist/${ownRuleId}`,
			...withAdminWriteAuth(moderator),
		});
		expect(moderatorDelete.statusCode).toBe(403);
		expect(moderatorDelete.json()).toMatchObject({
			error: {
				code: "ADMIN_PERMISSION_REQUIRED",
			},
		});

		const globalCreate = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/allowlist",
			...withAdminWriteAuth(admin),
			payload: {
				targetType: "email",
				matchMode: "domain",
				targetValue: "trusted.example",
				scope: "all",
			},
		});
		expect(globalCreate.statusCode).toBe(200);
	});

	it("rejects global ops and import/export routes for site-scoped users", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "global-denied-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie } = await loginAsAdmin(fixture.app, {
			username: "global-denied-site-admin",
			password: "replace-me",
		});
		for (const url of [
			"/qingyan/api/admin/ops/status",
			"/qingyan/api/admin/import-export/jobs?siteKey=fangyuan",
		]) {
			const response = await fixture.app.inject({
				method: "GET",
				url,
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
		}
	});

	it("rejects global site, system, users, groups, and data write APIs for site admins", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "global-write-denied",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "global-write-denied",
			password: "replace-me",
		});
		const deniedRequests: Array<
			| {
					method: "GET";
					url: string;
			  }
			| {
					method: "POST" | "PATCH" | "PUT";
					url: string;
					payload: Record<string, unknown>;
			  }
		> = [
			{
				method: "POST",
				url: "/qingyan/api/admin/sites",
				payload: {
					siteKey: "blocked-site",
					name: "Blocked Site",
					allowedOrigins: ["http://localhost:4499"],
				},
			},
			{
				method: "PATCH",
				url: "/qingyan/api/admin/sites/fangyuan",
				payload: {
					name: "Blocked Rename",
				},
			},
			{
				method: "PUT",
				url: "/qingyan/api/admin/system-settings",
				payload: {
					logging: {
						level: "info",
						retentionDays: 30,
					},
				},
			},
			{
				method: "GET",
				url: "/qingyan/api/admin/groups",
			},
			{
				method: "POST",
				url: "/qingyan/api/admin/users",
				payload: {
					username: "blocked-user",
					email: "blocked-user@example.test",
					displayName: "Blocked User",
					password: "blocked-password",
					groupKey: "site_moderator",
					siteKeys: ["fangyuan"],
				},
			},
			{
				method: "POST",
				url: "/qingyan/api/admin/import-export/export",
				payload: {
					siteKey: "fangyuan",
					format: "qingyan.export.v1",
				},
			},
			{
				method: "POST",
				url: "/qingyan/api/admin/import-export/wordpress/analyze",
				payload: {
					siteKey: "fangyuan",
					fileName: "blocked.xml",
					xml: "<rss><channel /></rss>",
				},
			},
		];

		for (const request of deniedRequests) {
			const response =
				request.method === "GET"
					? await fixture.app.inject({
							method: request.method,
							url: request.url,
							cookies: {
								qingyan_admin: adminCookie.value,
							},
						})
					: await fixture.app.inject({
							method: request.method,
							url: request.url,
							...withAdminWriteAuth({ adminCookie, csrfToken }),
							payload: request.payload,
						});

			expect(response.statusCode, request.url).toBe(403);
			expect(response.json(), request.url).toMatchObject({
				error: {
					code: "ADMIN_PERMISSION_REQUIRED",
				},
			});
		}
	});

	it("rejects high-risk comments, ops, and task APIs according to role permissions", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "risk-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		await createScopedUser(fixture, {
			username: "risk-site-moderator",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});

		const siteAdmin = await loginAsAdmin(fixture.app, {
			username: "risk-site-admin",
			password: "replace-me",
		});
		const siteModerator = await loginAsAdmin(fixture.app, {
			username: "risk-site-moderator",
			password: "replace-me",
		});

		const moderatorComments = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/comments?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: siteModerator.adminCookie.value,
			},
		});
		expect(moderatorComments.statusCode).toBe(200);

		const moderatorDeleteComment = await fixture.app.inject({
			method: "DELETE",
			url: "/qingyan/api/admin/comments/missing-comment",
			...withAdminWriteAuth({
				adminCookie: siteModerator.adminCookie,
				csrfToken: siteModerator.csrfToken,
			}),
		});
		expect(moderatorDeleteComment.statusCode).toBe(403);
		expect(moderatorDeleteComment.json()).toMatchObject({
			error: {
				code: "ADMIN_PERMISSION_REQUIRED",
			},
		});

		const siteAdminDeleteComment = await fixture.app.inject({
			method: "DELETE",
			url: "/qingyan/api/admin/comments/missing-comment",
			...withAdminWriteAuth({
				adminCookie: siteAdmin.adminCookie,
				csrfToken: siteAdmin.csrfToken,
			}),
		});
		expect(siteAdminDeleteComment.statusCode).toBe(403);
		expect(siteAdminDeleteComment.json()).toMatchObject({
			error: {
				code: "ADMIN_PERMISSION_REQUIRED",
			},
		});

		for (const request of [
			{
				method: "GET" as const,
				url: "/qingyan/api/admin/ops/tasks?siteKey=fangyuan&limit=20",
				auth: siteAdmin,
			},
			{
				method: "POST" as const,
				url: "/qingyan/api/admin/ops/tasks/page-title-refresh",
				auth: siteAdmin,
				payload: {
					siteKey: "fangyuan",
					pageKeys: ["blocked-page"],
				},
			},
			{
				method: "POST" as const,
				url: "/qingyan/api/admin/ops/ip-region/update",
				auth: siteAdmin,
				payload: {
					ipVersions: ["v4"],
				},
			},
		]) {
			const response = await fixture.app.inject({
				method: request.method,
				url: request.url,
				...(request.method === "GET"
					? {
							cookies: {
								qingyan_admin: request.auth.adminCookie.value,
							},
						}
					: withAdminWriteAuth({
							adminCookie: request.auth.adminCookie,
							csrfToken: request.auth.csrfToken,
						})),
				payload: request.payload,
			});

			expect(response.statusCode, request.url).toBe(403);
			expect(response.json(), request.url).toMatchObject({
				error: {
					code: "ADMIN_PERMISSION_REQUIRED",
				},
			});
		}
	});

	it("allows site admins to read granted pages and rejects ungranted pages", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSecondSite(fixture);
		await createScopedUser(fixture, {
			username: "pages-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie } = await loginAsAdmin(fixture.app, {
			username: "pages-site-admin",
			password: "replace-me",
		});
		const granted = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(granted.statusCode).toBe(200);

		const ungranted = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=qingyan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(ungranted.statusCode).toBe(403);
		expect(ungranted.json()).toMatchObject({
			error: {
				code: "ADMIN_SITE_ACCESS_REQUIRED",
			},
		});
	});

	it("rejects page registry access outside granted sites", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSecondSite(fixture);
		await createScopedUser(fixture, {
			username: "registry-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie } = await loginAsAdmin(fixture.app, {
			username: "registry-site-admin",
			password: "replace-me",
		});
		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/page-registry/pending?siteKey=qingyan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "ADMIN_SITE_ACCESS_REQUIRED",
			},
		});
	});

	it("rejects page management routes for site moderators", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site fangyuan to exist");
		}
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:moderator-page",
			pageUrl: "/posts/moderator-page/",
			status: "active",
		});
		await createScopedUser(fixture, {
			username: "pages-site-moderator",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "pages-site-moderator",
			password: "replace-me",
		});
		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/pages?siteKey=fangyuan&limit=20&offset=0",
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

		for (const request of [
			{
				url: "/qingyan/api/admin/pages/post%3Amoderator-page/trash",
				payload: { siteKey: "fangyuan" },
			},
			{
				url: "/qingyan/api/admin/pages/post%3Amoderator-page/delete",
				payload: { siteKey: "fangyuan" },
			},
			{
				url: "/qingyan/api/admin/pages/trash/clear",
				payload: { siteKey: "fangyuan" },
			},
		]) {
			const writeResponse = await fixture.app.inject({
				method: "POST",
				url: request.url,
				...withAdminWriteAuth({ adminCookie, csrfToken }),
				payload: request.payload,
			});
			expect(writeResponse.statusCode, request.url).toBe(403);
			expect(writeResponse.json(), request.url).toMatchObject({
				error: {
					code: "ADMIN_PERMISSION_REQUIRED",
				},
			});
		}
	});

	it("allows site admins to delete granted pages and rejects ungranted page lifecycle writes", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSecondSite(fixture);
		const siteRows = await fixture.app.db.select().from(sites);
		const fangyuan = siteRows.find((site) => site.siteKey === "fangyuan");
		const qingyan = siteRows.find((site) => site.siteKey === "qingyan");
		if (!fangyuan || !qingyan) {
			throw new Error("Expected both test sites to exist");
		}
		await fixture.app.db.insert(sitePageRegistry).values([
			{
				siteId: fangyuan.id,
				pageKey: "post:granted-delete",
				pageUrl: "/posts/granted-delete/",
				status: "active",
			},
			{
				siteId: qingyan.id,
				pageKey: "post:denied-delete",
				pageUrl: "/posts/denied-delete/",
				status: "active",
			},
		]);
		await createScopedUser(fixture, {
			username: "pages-delete-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "pages-delete-site-admin",
			password: "replace-me",
		});
		const granted = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/post%3Agranted-delete/delete",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: { siteKey: "fangyuan" },
		});
		expect(granted.statusCode).toBe(200);
		expect(granted.json()).toMatchObject({
			page: {
				pageKey: "post:granted-delete",
				status: "deleted",
				deletion: {
					mode: "delayed",
				},
			},
		});

		const denied = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/post%3Adenied-delete/delete",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: { siteKey: "qingyan" },
		});
		expect(denied.statusCode).toBe(403);
		expect(denied.json()).toMatchObject({
			error: {
				code: "ADMIN_SITE_ACCESS_REQUIRED",
			},
		});
	});

	it("allows site admins to clear granted page trash and rejects ungranted trash empty writes", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSecondSite(fixture);
		const siteRows = await fixture.app.db.select().from(sites);
		const fangyuan = siteRows.find((site) => site.siteKey === "fangyuan");
		const qingyan = siteRows.find((site) => site.siteKey === "qingyan");
		if (!fangyuan || !qingyan) {
			throw new Error("Expected both test sites to exist");
		}
		await fixture.app.db.insert(sitePageRegistry).values([
			{
				siteId: fangyuan.id,
				pageKey: "post:granted-trash",
				pageUrl: "/posts/granted-trash/",
				status: "trash",
				trashedAt: "2026-06-01T00:00:00.000Z",
			},
			{
				siteId: qingyan.id,
				pageKey: "post:denied-trash",
				pageUrl: "/posts/denied-trash/",
				status: "trash",
				trashedAt: "2026-06-01T00:00:00.000Z",
			},
		]);
		await createScopedUser(fixture, {
			username: "pages-trash-empty-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "pages-trash-empty-site-admin",
			password: "replace-me",
		});
		const granted = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/trash/clear",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: { siteKey: "fangyuan" },
		});
		expect(granted.statusCode).toBe(200);
		expect(granted.json()).toMatchObject({
			deletion: {
				mode: "delayed",
				resourceCount: 1,
			},
		});

		const denied = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/trash/clear",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: { siteKey: "qingyan" },
		});
		expect(denied.statusCode).toBe(403);
		expect(denied.json()).toMatchObject({
			error: {
				code: "ADMIN_SITE_ACCESS_REQUIRED",
			},
		});
	});
});
