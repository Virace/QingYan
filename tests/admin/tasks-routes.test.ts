import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	auditLogs,
	scheduledTaskDeletedSnapshots,
	scheduledTasks,
	sites,
	taskRuns,
} from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { AdminTaskService } from "../../src/modules/tasks/admin-task-service";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
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

async function createSite(
	fixture: Awaited<ReturnType<typeof createTestApp>>,
	input: { siteKey: string; name: string; allowedOrigins: string[] },
) {
	await fixture.app.db.insert(sites).values({
		siteKey: input.siteKey,
		name: input.name,
		allowedOriginsJson: JSON.stringify(input.allowedOrigins),
	});
	await fixture.app.siteRegistry.loadFromDatabase(fixture.app.db);
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
	it("pages and searches complete task histories before applying limits", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		const [initialAdmin] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.isInitialAdmin, true));
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!initialAdmin || !site) throw new Error("Expected admin and site");
		const repository = new ScheduledTaskRepository(fixture.app.db);
		const template = await repository.create({
			id: "history_scheduled_0",
			name: "旧任务 0",
			type: "page_metadata_refresh",
			siteId: site.id,
			scopeKind: "site",
			scope: { siteKey: site.siteKey },
			scheduleKind: "manual_only",
			payload: { siteKey: site.siteKey, scope: "missing_only" },
			policy: {},
			trigger: {},
			ownerUserId: initialAdmin.id,
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const history = Array.from({ length: 205 }, (_, index) => ({
			index,
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
		}));
		await fixture.app.db.insert(scheduledTasks).values(
			history.slice(1).map(({ index, createdAt }) => ({
				id: `history_scheduled_${index}`,
				name: `旧任务 ${index}`,
				type: template.type,
				siteId: site.id,
				scopeKind: "site",
				scopeJson: "{}",
				scheduleKind: "manual_only",
				payloadJson: "{}",
				policyJson: "{}",
				triggerJson: "{}",
				ownerUserId: initialAdmin.id,
				createdAt,
			})),
		);
		await fixture.app.db.insert(taskRuns).values(
			history.map(({ index, createdAt }) => ({
				id: `history_run_${index}`,
				type: template.type,
				category: "maintenance",
				status: "succeeded",
				queueBackend: "database",
				scheduledTaskNameSnapshot: `旧任务 ${index}`,
				siteId: site.id,
				siteKey: site.siteKey,
				payloadSummaryJson: "{}",
				payloadJson: "{}",
				createdAt,
			})),
		);
		await fixture.app.db.insert(auditLogs).values(
			history.map(({ index, createdAt }) => ({
				siteId: site.id,
				actorType: "admin_user",
				actorId: String(initialAdmin.id),
				action: "task.scheduled.create",
				targetType: "scheduled_task",
				targetId: `history_scheduled_${index}`,
				payloadJson: JSON.stringify({
					taskName: `旧任务 ${index}`,
					taskType: template.type,
				}),
				createdAt,
			})),
		);
		await fixture.app.db.insert(auditLogs).values(
			history.map(({ index }) => ({
				actorType: "admin_user",
				action: "admin.settings.update",
				targetType: "settings",
				targetId: `settings_${index}`,
				createdAt: "2026-02-01T00:00:00.000Z",
			})),
		);
		await fixture.app.db.insert(scheduledTaskDeletedSnapshots).values(
			history.map(({ index, createdAt }) => ({
				id: `history_snapshot_${index}`,
				scheduledTaskId: `deleted_${index}`,
				snapshotJson: JSON.stringify({ ...template, name: `旧任务 ${index}` }),
				deletedAt: createdAt,
			})),
		);
		for (const [path, id] of [
			["scheduled", "history_scheduled_0"],
			["runs", "history_run_0"],
			["audit", undefined],
			["deleted-snapshots", "history_snapshot_0"],
		] as const) {
			const page = await fixture.app.inject({
				method: "GET",
				url: `/qingyan/api/admin/tasks/${path}?limit=5&offset=200`,
				cookies: { qingyan_admin: admin.adminCookie.value },
			});
			expect(page.statusCode).toBe(200);
			expect(page.json().totalCount).toBe(205);
			expect(page.json().items).toHaveLength(5);
			if (id) expect(page.json().items[4].id).toBe(id);
			else expect(page.json().items[4].taskName).toBe("旧任务 0");
			const search = await fixture.app.inject({
				method: "GET",
				url: `/qingyan/api/admin/tasks/${path}?limit=1&search=${encodeURIComponent("旧任务 0")}`,
				cookies: { qingyan_admin: admin.adminCookie.value },
			});
			expect(search.statusCode).toBe(200);
			expect(search.json().totalCount).toBe(1);
			expect(search.json().items).toHaveLength(1);
		}
		const typeSearch = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/tasks/runs?limit=1&search=${encodeURIComponent("页面 Title 刷新")}`,
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(typeSearch.json().totalCount).toBe(205);
		const beyondEnd = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/runs?limit=20&offset=220",
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(beyondEnd.json()).toMatchObject({ items: [], totalCount: 205 });
	});

	it("counts only accessible sites and manageable definitions before pagination", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSite(fixture, {
			siteKey: "other",
			name: "Other",
			allowedOrigins: ["http://localhost:4322"],
		});
		const user = await createScopedUser(fixture, {
			username: "history-owner",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const admin = await loginAsAdmin(fixture.app);
		const scoped = await loginAsAdmin(fixture.app, {
			username: user.username,
			password: "replace-me",
		});
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		const [other] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "other"));
		const [initialAdmin] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.isInitialAdmin, true));
		if (!site || !other || !initialAdmin)
			throw new Error("Expected sites and admin");
		const repository = new ScheduledTaskRepository(fixture.app.db);
		for (const [id, siteId, ownerUserId, createdAt] of [
			["owned_old", site.id, user.id, "2026-01-01T00:00:00.000Z"],
			["summary_new", site.id, initialAdmin.id, "2026-02-01T00:00:00.000Z"],
			["inaccessible_newest", other.id, user.id, "2026-03-01T00:00:00.000Z"],
		] as const) {
			await repository.create({
				id,
				name: id,
				type: "page_metadata_refresh",
				siteId,
				scopeKind: "site",
				scope: {},
				scheduleKind: "manual_only",
				payload: {},
				policy: {},
				trigger: {},
				ownerUserId,
				createdAt,
			});
			await fixture.app.db.insert(taskRuns).values({
				id,
				type: "page_metadata_refresh",
				category: "maintenance",
				status: "succeeded",
				queueBackend: "database",
				siteId,
				payloadSummaryJson: "{}",
				payloadJson: "{}",
				createdAt,
			});
			await fixture.app.db.insert(auditLogs).values({
				siteId,
				actorType: "admin_user",
				action: "task.scheduled.create",
				targetType: "scheduled_task",
				targetId: id,
				createdAt,
			});
		}
		for (const path of ["scheduled", "runs", "audit"]) {
			const response = await fixture.app.inject({
				method: "GET",
				url: `/qingyan/api/admin/tasks/${path}?limit=1&offset=1`,
				cookies: { qingyan_admin: scoped.adminCookie.value },
			});
			expect(response.statusCode).toBe(200);
			expect(response.json().totalCount).toBe(2);
			expect(response.json().items).toHaveLength(1);
			expect(
				response.json().items[0][path === "audit" ? "targetId" : "id"],
			).toBe("owned_old");
		}
		const owned = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/scheduled?limit=1&visibility=owned",
			cookies: { qingyan_admin: scoped.adminCookie.value },
		});
		expect(owned.json()).toMatchObject({
			totalCount: 1,
			items: [{ id: "owned_old", visibility: "definition" }],
		});
		const summary = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/scheduled?limit=1&visibility=summary",
			cookies: { qingyan_admin: scoped.adminCookie.value },
		});
		expect(summary.json()).toMatchObject({
			totalCount: 1,
			items: [{ id: "summary_new", visibility: "summary" }],
		});
		const denied = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/deleted-snapshots?limit=1&offset=200",
			cookies: { qingyan_admin: scoped.adminCookie.value },
		});
		expect(denied.statusCode).toBe(403);
		const invalid = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/runs?limit=201",
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(invalid.statusCode).toBe(400);
	});

	it("filters notification runs by comment and returns a safe delivery projection", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site");
		}
		const taskRuns = new TaskRunRepository(fixture.app.db);
		const target = await taskRuns.createNotificationTaskWithDelivery({
			task: {
				type: "backend_user_comment_approved",
				siteId: site.id,
				siteKey: site.siteKey,
				subjectType: "comment",
				subjectId: "comment-task-filter",
				payloadSummary: {
					channel: "email",
					flow: "site_staff_comment",
				},
				payload: { body: "private body" },
				idempotencyKey: "task-filter-target",
			},
			delivery: {
				channel: "email",
				recipientType: "backend_user",
				recipientAddressSnapshot: "private-admin@example.test",
				recipientIdentityKey: "backend_user:private",
				eventFamily: "admin_comment_approved",
				templateKey: "backend_user.comment.approved",
			},
		});
		if (!target.delivery) {
			throw new Error("Expected delivery");
		}
		const claimed = await taskRuns.markRunning(target.task.id);
		if (!claimed) {
			throw new Error("Expected claimed notification task");
		}
		await taskRuns.completeNotificationAttempt({
			taskId: target.task.id,
			claimToken: claimed.claimToken,
			outcomes: [
				{
					deliveryId: target.delivery.id,
					status: "failed",
					error: { kind: "temporary", message: "private SMTP response" },
				},
			],
			next: {
				status: "failed",
				error: { kind: "temporary", message: "private SMTP response" },
			},
			events: [],
		});
		await taskRuns.create({
			type: "reply_approved",
			category: "notification",
			siteId: site.id,
			siteKey: site.siteKey,
			subjectType: "comment",
			subjectId: "other-comment",
			payloadSummary: { channel: "email", flow: "commenter_reply" },
			payload: {},
		});

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/runs?commentId=comment-task-filter",
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json()).toMatchObject({
			totalCount: 1,
			items: [
				{
					id: target.task.id,
					category: "notification",
					status: "failed",
					workflow: "站点人员评论提醒",
				},
			],
		});
		expect(listResponse.json().items[0].type).toBe("站点人员评论提醒");
		expect(listResponse.json().items[0]).not.toHaveProperty("payload");
		expect(listResponse.json().items[0]).not.toHaveProperty("error");
		for (const [search, totalCount] of [
			["站点人员评论提醒", 1],
			["private body", 0],
			["private SMTP response", 0],
		] as const) {
			const searched = await fixture.app.inject({
				method: "GET",
				url: `/qingyan/api/admin/tasks/runs?commentId=comment-task-filter&limit=1&search=${encodeURIComponent(search)}`,
				cookies: { qingyan_admin: admin.adminCookie.value },
			});
			expect(searched.statusCode).toBe(200);
			expect(searched.json().totalCount).toBe(totalCount);
			expect(searched.json().items).toHaveLength(totalCount);
		}

		const detailResponse = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/tasks/runs/${target.task.id}`,
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(detailResponse.statusCode).toBe(200);
		expect(detailResponse.json()).toMatchObject({
			id: target.task.id,
			workflow: "站点人员评论提醒",
			deliveries: [
				{
					kind: "delivery",
					channel: "email",
					state: "failed",
					phase: "failed",
					errorKind: "temporary",
					recipient: {
						label: "站点人员",
						address: "p***@example.test",
					},
				},
			],
		});
		const responseBody = detailResponse.body;
		expect(responseBody).not.toContain("private-admin@example.test");
		expect(responseBody).not.toContain("private SMTP response");
		expect(responseBody).not.toContain("private body");
		expect(responseBody).not.toContain(target.delivery.id);
		expect(detailResponse.json().type).toBe("站点人员评论提醒");
		expect(detailResponse.json()).not.toHaveProperty("payload");
		expect(detailResponse.json()).not.toHaveProperty("error");
		expect(detailResponse.json()).not.toHaveProperty("result");
		expect(detailResponse.json()).not.toHaveProperty("progress");
		expect(detailResponse.json()).not.toHaveProperty("workerId");
		expect(detailResponse.json()).not.toHaveProperty("concurrencyKey");
	});

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
		await eventLogs.appendLogLine({
			taskRunId: runId,
			stream: "stdout",
			level: "info",
			message: "Created",
			visibleToSiteAdmin: true,
		});

		const logs = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/tasks/runs/${runId}/logs?afterSequence=0&limit=10`,
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(logs.statusCode).toBe(200);
		expect(logs.json()).toMatchObject({
			nextSequence: 1,
			hasMore: false,
			items: [
				expect.objectContaining({
					sequence: 1,
					stream: "stdout",
					eventType: "log.stdout",
				}),
			],
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

	it("lets site admins create their own task but requires permission to run it", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "site-admin-task-permissions",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const siteAdmin = await loginAsAdmin(fixture.app, {
			username: "site-admin-task-permissions",
			password: "replace-me",
		});

		const created = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: siteAdmin.adminCookie,
				csrfToken: siteAdmin.csrfToken,
			}),
			payload: taskPayload({ name: "Own task without run permission" }),
		});
		expect(created.statusCode).toBe(201);

		const run = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/scheduled/${created.json().id}/run`,
			...withAdminWriteAuth({
				adminCookie: siteAdmin.adminCookie,
				csrfToken: siteAdmin.csrfToken,
			}),
		});
		expect(run.statusCode).toBe(403);
		expect(run.json()).toMatchObject({
			error: {
				code: "TASK_PERMISSION_DENIED",
				details: {
					requiredPermission: "tasks.run",
					taskType: "page_metadata_refresh",
					operation: "run",
				},
			},
		});
	});

	it("binds site-scoped task payloads to the authorized top-level site", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createSite(fixture, {
			siteKey: "xitem",
			name: "x-item",
			allowedOrigins: ["https://x-item.example.test"],
		});
		await createScopedUser(fixture, {
			username: "site-admin-task-binding",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const siteAdmin = await loginAsAdmin(fixture.app, {
			username: "site-admin-task-binding",
			password: "replace-me",
		});

		const mismatchedCreate = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: siteAdmin.adminCookie,
				csrfToken: siteAdmin.csrfToken,
			}),
			payload: taskPayload({
				name: "Cross-site source refresh",
				type: "page_source_refresh",
				scheduleKind: "manual_only",
				trigger: {},
				payload: {
					siteKey: "xitem",
					sitemapUrls: ["http://localhost:4321/sitemap.xml"],
					mode: "replace",
				},
			}),
		});
		expect(mismatchedCreate.statusCode).toBe(403);
		expect(mismatchedCreate.json()).toMatchObject({
			error: {
				code: "TASK_SITE_BINDING_MISMATCH",
				details: { siteKey: "fangyuan" },
			},
		});

		const created = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: siteAdmin.adminCookie,
				csrfToken: siteAdmin.csrfToken,
			}),
			payload: taskPayload({ name: "Bound task" }),
		});
		expect(created.statusCode).toBe(201);
		expect(created.json()).toMatchObject({
			payload: { siteKey: "fangyuan" },
		});

		const mismatchedUpdate = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/tasks/scheduled/${created.json().id}`,
			...withAdminWriteAuth({
				adminCookie: siteAdmin.adminCookie,
				csrfToken: siteAdmin.csrfToken,
			}),
			payload: {
				payload: {
					siteKey: "xitem",
					scope: "force",
				},
			},
		});
		expect(mismatchedUpdate.statusCode).toBe(403);
		expect(mismatchedUpdate.json()).toMatchObject({
			error: {
				code: "TASK_SITE_BINDING_MISMATCH",
				details: { siteKey: "fangyuan" },
			},
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

	it("protects system-managed authoritative page source refresh tasks in Admin API", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);
		const targetOwner = await createScopedUser(fixture, {
			username: "protected-target-owner",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const service = new AdminTaskService(
			fixture.app.db,
			fixture.app.siteRegistry,
		);
		const ensured = await service.ensureAuthoritativePageSourceRefreshTask({
			siteKey: "fangyuan",
			sitemapUrls: ["http://localhost:4321/sitemap.xml"],
			requestId: "protected-task-test",
		});
		const taskId = ensured.task.id;
		await createScopedUser(fixture, {
			username: "protected-site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const protectedSiteAdmin = await loginAsAdmin(fixture.app, {
			username: "protected-site-admin",
			password: "replace-me",
		});

		const detail = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}`,
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(detail.statusCode).toBe(200);
		expect(detail.json()).toMatchObject({
			visibility: "definition",
			systemManaged: true,
			systemKey: "page_registry:authoritative_source_refresh:fangyuan",
			protectionKind: "authoritative_page_source_refresh",
			protectedActions: {
				delete: true,
				disable: true,
				transferOwner: true,
			},
			canDelete: false,
			canDisable: false,
			canTransferOwner: false,
			payload: {
				siteKey: "fangyuan",
				sitemapUrls: ["http://localhost:4321/sitemap.xml"],
				mode: "replace",
			},
		});

		const allowedPatch = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: {
				name: "Protected refresh hourly",
				trigger: { everyMinutes: 120 },
				payload: {
					siteKey: "fangyuan",
					sitemapUrls: ["http://localhost:4321/sitemap.xml"],
					mode: "replace",
					trigger: "scheduled",
					timeoutMs: 5000,
				},
			},
		});
		expect(allowedPatch.statusCode, allowedPatch.body).toBe(200);
		expect(allowedPatch.json()).toMatchObject({
			name: "Protected refresh hourly",
			trigger: { everyMinutes: 120 },
			payload: {
				siteKey: "fangyuan",
				sitemapUrls: ["http://localhost:4321/sitemap.xml"],
				mode: "replace",
				timeoutMs: 5000,
			},
		});

		const siteAdminRun = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}/run`,
			...withAdminWriteAuth({
				adminCookie: protectedSiteAdmin.adminCookie,
				csrfToken: protectedSiteAdmin.csrfToken,
			}),
		});
		expect(siteAdminRun.statusCode).toBe(403);
		expect(siteAdminRun.json()).toMatchObject({
			error: {
				code: "TASK_PERMISSION_DENIED",
				details: {
					requiredPermission: "tasks.run",
					taskType: "page_source_refresh",
					operation: "run",
				},
			},
		});

		const lockedPayloadPatch = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: {
				payload: {
					siteKey: "fangyuan",
					sitemapUrls: ["http://localhost:4321/other.xml"],
					mode: "replace",
					trigger: "scheduled",
					timeoutMs: 5000,
				},
			},
		});
		expect(lockedPayloadPatch.statusCode).toBe(409);
		expect(lockedPayloadPatch.json()).toMatchObject({
			error: { code: "SCHEDULED_TASK_PROTECTED_FIELD" },
		});

		const disable = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}/disable`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: { reason: "try_disable" },
		});
		expect(disable.statusCode).toBe(409);
		expect(disable.json()).toMatchObject({
			error: { code: "SCHEDULED_TASK_PROTECTED" },
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
		expect(transfer.statusCode).toBe(409);
		expect(transfer.json()).toMatchObject({
			error: { code: "SYSTEM_TASK_OWNER_IMMUTABLE" },
		});

		const deleted = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: { reason: "try_delete" },
		});
		expect(deleted.statusCode).toBe(409);
		expect(deleted.json()).toMatchObject({
			error: { code: "SCHEDULED_TASK_PROTECTED" },
		});

		const auditRows = await fixture.app.db
			.select()
			.from(auditLogs)
			.where(eq(auditLogs.targetId, taskId));
		expect(auditRows.map((row) => row.action)).toEqual(
			expect.arrayContaining([
				"task.scheduled.system_created",
				"task.scheduled.update",
				"task.scheduled.protected_operation_denied",
			]),
		);
	});

	it("blocks ordinary same-site page source refresh tasks in authoritative mode", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const admin = await loginAsAdmin(fixture.app);

		const settingsResponse = await fixture.app.inject({
			method: "PUT",
			url: "/qingyan/api/admin/sites/fangyuan/settings",
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: {
				pageRegistry: {
					mode: "authoritative",
					authoritativeSitemapUrls: ["http://localhost:4321/sitemap.xml"],
				},
			},
		});
		expect(settingsResponse.statusCode).toBe(200);

		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: taskPayload({
				name: "Ordinary page source refresh",
				type: "page_source_refresh",
				scheduleKind: "manual_only",
				trigger: {},
				payload: {
					siteKey: "fangyuan",
					sitemapUrls: ["http://localhost:4321/other.xml"],
					mode: "replace",
				},
			}),
		});

		expect(createResponse.statusCode).toBe(409);
		expect(createResponse.json()).toMatchObject({
			error: {
				code: "AUTHORITATIVE_PAGE_SOURCE_REFRESH_CONFLICT",
			},
		});
	});
});
