import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	auditLogs,
	sites,
} from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

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
	return user;
}

function taskPayload(overrides: Record<string, unknown> = {}) {
	return {
		name: "Refresh FangYuan titles",
		type: "page_metadata_refresh",
		siteKey: "fangyuan",
		scopeKind: "site",
		scope: { siteKey: "fangyuan" },
		enabled: true,
		scheduleKind: "interval",
		payload: { siteKey: "fangyuan", scope: "missing_only" },
		policy: {},
		trigger: { everyMinutes: 30 },
		retentionCount: 5,
		...overrides,
	};
}

describe("admin tasks api", () => {
	it("lists definitions and lets admin create, update, run, view logs, transfer, and delete a scheduled task", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		const targetOwner = await createScopedUser(fixture, {
			username: "target-owner",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});

		const definitions = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/definitions",
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(definitions.statusCode).toBe(200);
		expect(definitions.json().items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "page_metadata_refresh",
					category: "maintenance",
				}),
			]),
		);

		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: taskPayload(),
		});
		expect(createResponse.statusCode).toBe(201);
		expect(createResponse.json()).toMatchObject({
			visibility: "definition",
			name: "Refresh FangYuan titles",
			payload: { siteKey: "fangyuan", scope: "missing_only" },
			nextRunAt: expect.any(String),
			canManage: true,
			canRun: true,
		});
		const taskId = createResponse.json().id as string;

		const patchResponse = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: {
				name: "Updated title refresh",
				trigger: { everyMinutes: 60 },
			},
		});
		expect(patchResponse.statusCode).toBe(200);
		expect(patchResponse.json()).toMatchObject({
			name: "Updated title refresh",
			trigger: { everyMinutes: 60 },
		});

		const runNow = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}/run`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
		});
		expect(runNow.statusCode).toBe(201);
		expect(runNow.json()).toMatchObject({
			visibility: "run_detail",
			scheduledTaskId: taskId,
			trigger: "manual",
			input: { siteKey: "fangyuan", scope: "missing_only" },
		});
		const runId = runNow.json().id as string;
		const eventLogs = new TaskEventLogRepository(fixture.app.db);
		await eventLogs.append({
			taskRunId: runId,
			eventType: "created",
			level: "info",
			message: "Created",
			visibleToSiteAdmin: true,
		});

		const events = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/tasks/runs/${runId}/events`,
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(events.statusCode).toBe(200);
		expect(events.json()).toMatchObject({
			totalCount: 1,
			items: [expect.objectContaining({ eventType: "created" })],
		});

		const cancelResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/runs/${runId}/cancel`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
		});
		expect(cancelResponse.statusCode).toBe(200);
		expect(cancelResponse.json()).toMatchObject({
			visibility: "run_detail",
			status: "cancelled",
			error: { code: "TASK_RUN_CANCELLED" },
		});

		const retryResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/runs/${runId}/retry`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
		});
		expect(retryResponse.statusCode).toBe(200);
		expect(retryResponse.json()).toMatchObject({
			visibility: "run_detail",
			status: "retrying",
			error: { code: "TASK_RUN_RETRY_REQUESTED" },
		});

		const transfer = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}/transfer-owner`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: { ownerUserId: targetOwner.id },
		});
		expect(transfer.statusCode).toBe(200);
		expect(transfer.json()).toMatchObject({
			ownerUserId: targetOwner.id,
		});

		const deleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: { reason: "test cleanup" },
		});
		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			scheduledTaskId: taskId,
			visibility: "deleted_snapshot",
		});

		const auditRows = await fixture.app.db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.targetId, taskId));
		expect(auditRows.map((row) => row.action)).toEqual(
			expect.arrayContaining([
				"task.scheduled.create",
				"task.scheduled.update",
				"task.scheduled.run",
				"task.scheduled.transfer_owner",
				"task.scheduled.delete",
			]),
		);
	}, 10_000);

	it("returns field-level validation errors for invalid payloads", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: taskPayload({
				payload: { siteKey: "fangyuan", scope: "invalid_scope" },
				trigger: { everyMinutes: 1 },
			}),
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
				fields: expect.arrayContaining([
					expect.objectContaining({ path: "payload.scope" }),
					expect.objectContaining({ path: "trigger.everyMinutes" }),
				]),
			},
		});
	});

	it("rejects creating dangerous tasks as enabled", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: taskPayload({
				name: "Temporary comment shutdown",
				type: "site_settings_action",
				enabled: true,
				payload: {
					siteKey: "fangyuan",
					action: "disable_comments",
					ttlSec: 3600,
				},
			}),
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
				fields: expect.arrayContaining([
					expect.objectContaining({ path: "enabled" }),
				]),
			},
		});
	});

	it("prevents site admins from creating global blacklist automation", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "site-admin-blacklist",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const siteAdmin = await loginAsAdmin(fixture.app, {
			username: "site-admin-blacklist",
			password: "replace-me",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: siteAdmin.adminCookie,
				csrfToken: siteAdmin.csrfToken,
			}),
			payload: taskPayload({
				name: "Global blacklist automation",
				type: "blacklist_automation",
				enabled: false,
				siteKey: null,
				scopeKind: "global",
				scope: {},
				payload: {
					targetType: "ip",
					matchMode: "exact",
					targetValue: "203.0.113.42",
					scope: "post",
					expiresInSec: 3600,
				},
			}),
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
				fields: expect.arrayContaining([
					expect.objectContaining({ path: "scopeKind" }),
				]),
			},
		});
	});

	it("creates manual backup runs with backup category", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: taskPayload({
				name: "Manual FangYuan backup",
				type: "backup",
				enabled: false,
				scheduleKind: "manual_only",
				trigger: {},
				payload: {
					scope: "site",
					siteKey: "fangyuan",
					include: {
						siteSettings: true,
						pageThreads: true,
						comments: true,
					},
					retentionCount: 3,
				},
			}),
		});
		expect(createResponse.statusCode).toBe(201);
		const taskId = createResponse.json().id as string;

		const runNow = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}/run`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
		});

		expect(runNow.statusCode).toBe(201);
		expect(runNow.json()).toMatchObject({
			visibility: "run_detail",
			scheduledTaskId: taskId,
			type: "backup",
			category: "backup",
			trigger: "manual",
		});
	});

	it("allows site admins to see admin-created task summaries but not raw details or logs", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		await createScopedUser(fixture, {
			username: "site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: taskPayload(),
		});
		const taskId = createResponse.json().id as string;
		const siteAdmin = await loginAsAdmin(fixture.app, {
			username: "site-admin",
			password: "replace-me",
		});

		const detail = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}`,
			cookies: { qingyan_admin: siteAdmin.adminCookie.value },
		});
		expect(detail.statusCode).toBe(200);
		expect(detail.json()).toMatchObject({
			visibility: "summary",
			canManage: false,
			canViewLogs: false,
		});
		expect(detail.json()).not.toHaveProperty("payload");

		const runAttempt = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}/run`,
			...withAdminWriteAuth({
				adminCookie: siteAdmin.adminCookie,
				csrfToken: siteAdmin.csrfToken,
			}),
		});
		expect(runAttempt.statusCode).toBe(403);
	});

	it("lets site admins manage their own site task while moderators remain summary-only", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		await createScopedUser(fixture, {
			username: "moderator",
			groupKey: "site_moderator",
			siteKeys: ["fangyuan"],
		});
		const siteAdmin = await loginAsAdmin(fixture.app, {
			username: "site-admin",
			password: "replace-me",
		});
		const moderator = await loginAsAdmin(fixture.app, {
			username: "moderator",
			password: "replace-me",
		});

		const created = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: siteAdmin.adminCookie,
				csrfToken: siteAdmin.csrfToken,
			}),
			payload: taskPayload({ name: "Own task" }),
		});
		expect(created.statusCode).toBe(201);
		expect(created.json()).toMatchObject({
			visibility: "definition",
			canManage: true,
		});
		const taskId = created.json().id as string;

		const moderatorDetail = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}`,
			cookies: { qingyan_admin: moderator.adminCookie.value },
		});
		expect(moderatorDetail.statusCode).toBe(200);
		expect(moderatorDetail.json()).toMatchObject({
			visibility: "summary",
			canManage: false,
			canRun: false,
			canViewLogs: false,
		});
	});

	it("can disable tasks and transfer ownership to the initial admin for invalid owners", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const owner = await createScopedUser(fixture, {
			username: "site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const [initialAdmin] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.isInitialAdmin, true));
		const repository = new ScheduledTaskRepository(fixture.app.db);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		const task = await repository.create({
			name: "Owner task",
			type: "page_metadata_refresh",
			siteId: site?.id,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "manual_only",
			payload: { siteKey: "fangyuan", scope: "missing_only" },
			policy: {},
			trigger: { kind: "manual" },
			retentionCount: 5,
			ownerUserId: owner.id,
			createdByUserId: owner.id,
		});

		const admin = await loginAsAdmin(fixture.app);
		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/owners/reconcile",
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: { ownerUserId: owner.id, reason: "owner_disabled" },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			updatedTaskIds: [task.id],
		});
		const updated = await repository.getRequired(task.id);
		expect(updated).toMatchObject({
			enabled: false,
			disabledReason: "owner_disabled",
			ownerUserId: initialAdmin?.id,
		});
	});
});
