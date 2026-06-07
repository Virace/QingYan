import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	sites,
} from "../../src/db/schema";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
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

function taskPayload(overrides: Record<string, unknown> = {}) {
	return {
		name: "Audit task",
		type: "page_metadata_refresh",
		siteKey: "fangyuan",
		scopeKind: "site",
		scope: { siteKey: "fangyuan" },
		enabled: true,
		scheduleKind: "manual_only",
		payload: { siteKey: "fangyuan", scope: "missing_only" },
		policy: {},
		trigger: { kind: "manual" },
		retentionCount: 5,
		...overrides,
	};
}

describe("admin task audit routes", () => {
	it("returns task audit summaries without raw execution payloads, results, errors, or event logs", async () => {
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
			payload: taskPayload(),
		});
		expect(createResponse.statusCode).toBe(201);
		const taskId = createResponse.json().id as string;
		const runResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}/run`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
		});
		expect(runResponse.statusCode).toBe(201);
		const runId = runResponse.json().id as string;
		const taskRuns = new TaskRunRepository(fixture.app.db);
		await taskRuns.markFailed(runId, {
			code: "TASK_RUN_FAILED",
			message: "raw error must stay out of audit list",
		});

		const audit = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/audit",
			cookies: { qingyan_admin: admin.adminCookie.value },
		});

		expect(audit.statusCode).toBe(200);
		const auditItems = audit.json().items as Array<Record<string, unknown>>;
		expect(auditItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: "task.scheduled.create",
					targetType: "scheduled_task",
					targetId: taskId,
					taskType: "page_metadata_refresh",
					siteKey: "fangyuan",
				}),
				expect.objectContaining({
					action: "task.scheduled.run",
					targetType: "scheduled_task",
					targetId: taskId,
					taskType: "page_metadata_refresh",
					runId,
				}),
			]),
		);
		for (const item of auditItems) {
			expect(item).not.toHaveProperty("payload");
			expect(item).not.toHaveProperty("input");
			expect(item).not.toHaveProperty("result");
			expect(item).not.toHaveProperty("error");
			expect(item).not.toHaveProperty("eventLogs");
			expect(item).not.toHaveProperty("payloadJson");
		}
	});

	it("exposes deleted snapshots only to the initial admin and removes deleted tasks from normal lists", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await createScopedUser(fixture, {
			username: "site-admin",
			groupKey: "site_admin",
			siteKeys: ["fangyuan"],
		});
		const admin = await loginAsAdmin(fixture.app);
		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/tasks/scheduled",
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: taskPayload({ name: "Deleted audit task" }),
		});
		expect(createResponse.statusCode).toBe(201);
		const taskId = createResponse.json().id as string;

		const deleted = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/tasks/scheduled/${taskId}`,
			...withAdminWriteAuth({
				adminCookie: admin.adminCookie,
				csrfToken: admin.csrfToken,
			}),
			payload: { reason: "audit coverage" },
		});
		expect(deleted.statusCode).toBe(200);
		const snapshotId = deleted.json().id as string;

		const scheduled = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/scheduled",
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(scheduled.statusCode).toBe(200);
		expect(
			(scheduled.json().items as Array<{ id: string }>).map((item) => item.id),
		).not.toContain(taskId);

		const snapshots = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/deleted-snapshots",
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(snapshots.statusCode).toBe(200);
		expect(snapshots.json()).toMatchObject({
			totalCount: 1,
			items: [
				expect.objectContaining({
					id: snapshotId,
					scheduledTaskId: taskId,
					visibility: "deleted_snapshot",
					snapshot: expect.objectContaining({
						name: "Deleted audit task",
						type: "page_metadata_refresh",
					}),
				}),
			],
		});

		const snapshotDetail = await fixture.app.inject({
			method: "GET",
			url: `/qingyan/api/admin/tasks/deleted-snapshots/${snapshotId}`,
			cookies: { qingyan_admin: admin.adminCookie.value },
		});
		expect(snapshotDetail.statusCode).toBe(200);
		expect(snapshotDetail.json()).toMatchObject({
			id: snapshotId,
			scheduledTaskId: taskId,
		});

		const siteAdmin = await loginAsAdmin(fixture.app, {
			username: "site-admin",
			password: "replace-me",
		});
		const denied = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/tasks/deleted-snapshots",
			cookies: { qingyan_admin: siteAdmin.adminCookie.value },
		});
		expect(denied.statusCode).toBe(403);
	});
});
