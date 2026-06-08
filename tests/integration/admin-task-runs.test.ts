import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminBootstrapState,
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	sites,
} from "../../src/db/schema";
import { AdminRepository } from "../../src/modules/admin/repository";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function seedInstalledBootstrap(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
) {
	await fixture.app.db.insert(adminBootstrapState).values({
		id: 1,
		consolePath: "/admin",
		username: "admin",
		passwordHash: createPasswordHash("replace-me"),
		passwordRotatedAt: null,
	});
}

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

describe("admin task run projection", () => {
	it("lists notification task runs in the admin task center", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);
		const taskRuns = new TaskRunRepository(fixture.app.db);
		await taskRuns.create({
			id: "task_run_notification_visible",
			type: "notification.reply_approved",
			category: "notification",
			siteKey: "fangyuan",
			status: "queued",
			payloadSummary: {
				eventType: "reply_approved",
				recipientAddressSnapshot: "reader@example.test",
			},
			payload: {
				commentId: "reply_1",
			},
			maxAttempts: 3,
			createdAt: "2026-06-02T00:00:00.000Z",
			updatedAt: "2026-06-02T00:00:00.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/tasks?siteKey=fangyuan",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			totalCount: 1,
			items: [
				{
					id: "task_run_notification_visible",
					source: "task_run",
					type: "notification.reply_approved",
					category: "notification",
					status: "queued",
					siteKey: "fangyuan",
					payloadSummary: {
						eventType: "reply_approved",
						recipientAddressSnapshot: "reader@example.test",
					},
					queueState: {
						waitingReason: "ready_for_runner",
						readyAt: expect.any(String),
					},
					createdAt: "2026-06-02T00:00:00.000Z",
				},
			],
		});
	});

	it("rejects site-scoped users because task center requires tasks.read", async () => {
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
			url: "/qingyan/api/admin/ops/tasks?siteKey=fangyuan",
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

	it("filters task runs by site key", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		await createSecondSite(fixture);
		const admin = await loginAsAdmin(fixture.app);
		const taskRuns = new TaskRunRepository(fixture.app.db);
		await taskRuns.create({
			id: "task_run_fangyuan",
			type: "notification.reply_approved",
			category: "notification",
			siteKey: "fangyuan",
			payloadSummary: { siteKey: "fangyuan" },
			payload: { siteKey: "fangyuan" },
			createdAt: "2026-06-02T00:00:01.000Z",
			updatedAt: "2026-06-02T00:00:01.000Z",
		});
		await taskRuns.create({
			id: "task_run_qingyan",
			type: "notification.reply_approved",
			category: "notification",
			siteKey: "qingyan",
			payloadSummary: { siteKey: "qingyan" },
			payload: { siteKey: "qingyan" },
			createdAt: "2026-06-02T00:00:02.000Z",
			updatedAt: "2026-06-02T00:00:02.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/tasks?siteKey=fangyuan",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			totalCount: 1,
			items: [
				{
					id: "task_run_fangyuan",
					source: "task_run",
					siteKey: "fangyuan",
				},
			],
		});
		expect(response.json().items).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "task_run_qingyan",
				}),
			]),
		);
	});
});
