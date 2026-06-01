import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	auditLogs,
	blacklistRules,
	sites,
} from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { AdminRepository } from "../../src/modules/admin/repository";
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

async function createSiteAdmin(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
	input: {
		username: string;
		siteKeys: string[];
	},
) {
	const [group] = await fixture.app.db
		.select()
		.from(adminGroups)
		.where(eq(adminGroups.key, "site_admin"));
	if (!group) {
		throw new Error("Expected site_admin group to exist");
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
	return user;
}

describe("admin blacklist", () => {
	it("creates, lists and deletes blacklist rules", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/blacklist",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				targetType: "email",
				matchMode: "wildcard",
				targetValue: "*@spam.test",
				scope: "all",
				reason: "wildcard ban",
			},
		});
		expect(createResponse.statusCode).toBe(200);
		expect(createResponse.json()).toMatchObject({
			rule: {
				targetType: "email",
				targetValue: "*@spam.test",
				matchMode: "wildcard",
				scope: "all",
			},
		});
		const ruleId = createResponse.json().rule.id as number;

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/blacklist?siteKey=fangyuan",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json()).toMatchObject({
			items: [
				{
					id: ruleId,
					targetType: "email",
					matchMode: "wildcard",
					scope: "all",
				},
			],
		});

		const deleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/blacklist/${ruleId}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});
		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			rule: {
				id: ruleId,
			},
		});
	});

	it("paginates and searches blacklist rules", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		for (const [index, payload] of [
			{
				targetType: "email",
				matchMode: "exact",
				targetValue: "first@spam.test",
				reason: "first rule",
			},
			{
				targetType: "ip",
				matchMode: "exact",
				targetValue: "203.0.113.20",
				reason: "needle network",
			},
			{
				targetType: "visitor",
				matchMode: "exact",
				targetValue: "visitor_blacklist_3",
				reason: "third rule",
			},
		].entries()) {
			const response = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/blacklist",
				...withAdminWriteAuth({ adminCookie, csrfToken }),
				payload: {
					siteKey: "fangyuan",
					scope: index === 0 ? "all" : "post",
					...payload,
				},
			});
			expect(response.statusCode).toBe(200);
		}

		const pageResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/blacklist?siteKey=fangyuan&limit=1&offset=1",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(pageResponse.statusCode).toBe(200);
		expect(pageResponse.json()).toMatchObject({
			items: [
				{
					targetValue: "203.0.113.20",
				},
			],
			pagination: {
				limit: 1,
				offset: 1,
				totalCount: 3,
			},
		});

		const searchResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/blacklist?siteKey=fangyuan&search=needle",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(searchResponse.statusCode).toBe(200);
		expect(searchResponse.json()).toMatchObject({
			items: [
				{
					targetType: "ip",
					targetValue: "203.0.113.20",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});
	});

	it("lets site admins delete only blacklist rules from granted sites", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSecondSite(fixture);
		const siteAdmin = await createSiteAdmin(fixture, {
			username: "blacklist-site-admin",
			siteKeys: ["fangyuan"],
		});
		const [fangyuan] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		const [qingyan] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "qingyan"));
		if (!fangyuan || !qingyan) {
			throw new Error("Expected both sites to exist");
		}
		await fixture.app.db.insert(blacklistRules).values([
			{
				siteId: fangyuan.id,
				targetType: "email",
				targetValue: "granted@example.test",
				matchMode: "exact",
				scope: "post",
			},
			{
				siteId: qingyan.id,
				targetType: "email",
				targetValue: "denied@example.test",
				matchMode: "exact",
				scope: "post",
			},
			{
				siteId: null,
				targetType: "email",
				targetValue: "global@example.test",
				matchMode: "exact",
				scope: "post",
			},
		]);
		const rows = await fixture.app.db.select().from(blacklistRules);
		const grantedRule = rows.find(
			(rule) => rule.targetValue === "granted@example.test",
		);
		const deniedRule = rows.find(
			(rule) => rule.targetValue === "denied@example.test",
		);
		const globalRule = rows.find(
			(rule) => rule.targetValue === "global@example.test",
		);
		if (!grantedRule || !deniedRule || !globalRule) {
			throw new Error("Expected seeded blacklist rules");
		}
		const admin = await loginAsAdmin(fixture.app, {
			username: "blacklist-site-admin",
			password: "replace-me",
		});

		const deniedSiteDelete = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/blacklist/${deniedRule.id}`,
			...withAdminWriteAuth(admin),
		});
		expect(deniedSiteDelete.statusCode).toBe(403);
		expect(deniedSiteDelete.json()).toMatchObject({
			error: {
				code: "ADMIN_SITE_ACCESS_REQUIRED",
			},
		});

		const deniedGlobalDelete = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/blacklist/${globalRule.id}`,
			...withAdminWriteAuth(admin),
		});
		expect(deniedGlobalDelete.statusCode).toBe(403);
		expect(deniedGlobalDelete.json()).toMatchObject({
			error: {
				code: "ADMIN_SITE_ACCESS_REQUIRED",
			},
		});

		const grantedDelete = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/blacklist/${grantedRule.id}`,
			...withAdminWriteAuth(admin),
		});
		expect(grantedDelete.statusCode).toBe(200);
		expect(grantedDelete.json()).toMatchObject({
			rule: {
				id: grantedRule.id,
				targetValue: "granted@example.test",
			},
		});
		const remainingRules = await fixture.app.db.select().from(blacklistRules);
		expect(remainingRules.map((rule) => rule.targetValue).sort()).toEqual([
			"denied@example.test",
			"global@example.test",
		]);
		const audit = (await fixture.app.db.select().from(auditLogs)).find(
			(row) => row.action === "blacklist.deleted",
		);
		expect(audit).toMatchObject({
			actorType: "admin_user",
			actorId: String(siteAdmin.id),
			targetType: "blacklist_rule",
			targetId: String(grantedRule.id),
		});
	});

	it("does not delete global blacklist rules from site-scoped target deletion", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const siteAdmin = await createSiteAdmin(fixture, {
			username: "blacklist-target-site-admin",
			siteKeys: ["fangyuan"],
		});
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected fangyuan site");
		}
		await fixture.app.db.insert(blacklistRules).values([
			{
				siteId: site.id,
				targetType: "email",
				targetValue: "target@example.test",
				matchMode: "exact",
				scope: "post",
			},
			{
				siteId: null,
				targetType: "email",
				targetValue: "target@example.test",
				matchMode: "exact",
				scope: "post",
			},
		]);
		const admin = await loginAsAdmin(fixture.app, {
			username: "blacklist-target-site-admin",
			password: "replace-me",
		});

		const response = await fixture.app.inject({
			method: "DELETE",
			url: "/qingyan/api/admin/blacklist/target",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				targetType: "email",
				matchMode: "exact",
				targetValue: "target@example.test",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			rules: [
				{
					siteId: site.id,
					targetValue: "target@example.test",
				},
			],
		});
		const remainingRules = await fixture.app.db.select().from(blacklistRules);
		expect(remainingRules).toEqual([
			expect.objectContaining({
				siteId: null,
				targetValue: "target@example.test",
			}),
		]);
		const audit = (await fixture.app.db.select().from(auditLogs)).find(
			(row) => row.action === "security.blacklist.deleted",
		);
		expect(audit).toMatchObject({
			actorType: "admin_user",
			actorId: String(siteAdmin.id),
			targetType: "email",
			targetId: "target@example.test",
		});
	});
});
