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
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
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
		groupKey: "admin" | "site_admin" | "site_moderator";
		siteKeys?: string[];
		status?: "active" | "disabled" | "deleted";
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
		status: input.status ?? "active",
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

	for (const siteKey of input.siteKeys ?? []) {
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

function recipientsPayload(userId: number) {
	return {
		notifications: {
			recipients: [
				{
					userId,
					routes: [
						{
							eventType: "admin_comment_pending",
							channelConfigId: "email:default",
							enabled: true,
						},
						{
							eventType: "admin_comment_approved",
							channelConfigId: "email:default",
							enabled: true,
						},
					],
					includeCommentContent: "summary",
					enabled: true,
				},
			],
		},
	};
}

describe("admin site notification recipients", () => {
	it("lets admins add active backend users with target-site access", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const recipient = await createScopedUser(fixture, {
			username: "recipient-admin-target",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const updateResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: recipientsPayload(recipient.id),
		});

		expect(updateResponse.statusCode).toBe(200);
		expect(updateResponse.json().notifications).toMatchObject({
			recipients: [
				{
					userId: recipient.id,
					username: "recipient-admin-target",
					email: "recipient-admin-target@example.test",
					routes: [
						expect.objectContaining({
							eventType: "admin_comment_pending",
							channelConfigId: "email:default",
							channelType: "email",
							channelName: "默认邮件",
							enabled: true,
						}),
						expect.objectContaining({
							eventType: "admin_comment_approved",
							channelConfigId: "email:default",
							channelType: "email",
							channelName: "默认邮件",
							enabled: true,
						}),
					],
					includeCommentContent: "summary",
					enabled: true,
				},
			],
		});

		const readResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(readResponse.statusCode).toBe(200);
		expect(readResponse.json().notifications.recipients).toHaveLength(1);
	});

	it("lets site admins add same-site users but rejects users without target-site access", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSecondSite(fixture);
		await createScopedUser(fixture, {
			username: "recipient-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const sameSiteRecipient = await createScopedUser(fixture, {
			username: "same-site-recipient",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});
		const otherSiteRecipient = await createScopedUser(fixture, {
			username: "other-site-recipient",
			groupKey: "site_moderator",
			siteKeys: ["qingyan"],
		});

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app, {
			username: "recipient-site-admin",
			password: "replace-me",
		});

		const allowed = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: recipientsPayload(sameSiteRecipient.id),
		});
		expect(allowed.statusCode).toBe(200);

		const denied = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: recipientsPayload(otherSiteRecipient.id),
		});
		expect(denied.statusCode).toBe(403);
		expect(denied.json()).toMatchObject({
			error: {
				code: "ADMIN_NOTIFICATION_RECIPIENT_SITE_ACCESS_REQUIRED",
			},
		});
	});

	it("rejects site moderators and disabled target users", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "recipient-site-moderator",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});
		const disabledRecipient = await createScopedUser(fixture, {
			username: "disabled-recipient",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
			status: "disabled",
		});
		const activeRecipient = await createScopedUser(fixture, {
			username: "active-recipient",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});

		const moderatorAuth = await loginAsAdmin(fixture.app, {
			username: "recipient-site-moderator",
			password: "replace-me",
		});
		const moderatorDenied = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth(moderatorAuth),
			payload: recipientsPayload(activeRecipient.id),
		});
		expect(moderatorDenied.statusCode).toBe(403);
		expect(moderatorDenied.json()).toMatchObject({
			error: {
				code: "ADMIN_PERMISSION_REQUIRED",
			},
		});

		const adminAuth = await loginAsAdmin(fixture.app);
		const disabledDenied = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth(adminAuth),
			payload: recipientsPayload(disabledRecipient.id),
		});
		expect(disabledDenied.statusCode).toBe(400);
		expect(disabledDenied.json()).toMatchObject({
			error: {
				code: "ADMIN_NOTIFICATION_RECIPIENT_INACTIVE",
			},
		});
	});
});
