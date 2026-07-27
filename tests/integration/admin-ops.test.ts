import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	adminBootstrapState,
	adminUsers,
	auditLogs,
	delayedDeletions,
	sitePageRegistry,
	sites,
	taskRuns,
} from "../../src/db/schema";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import type {
	ServiceControlController,
	ServiceState,
} from "../../src/modules/service-control/systemd-service";
import { createPasswordHash } from "../../src/modules/admin/password-hash";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
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

class FakeServiceControl implements ServiceControlController {
	public calls: string[] = [];

	public constructor(private state: ServiceState = "running") {}

	public async status() {
		this.calls.push("status");
		return this.state;
	}

	public async start() {
		this.calls.push("start");
		this.state = "running";
	}

	public async stop() {
		this.calls.push("stop");
		this.state = "stopped";
	}

	public async restart() {
		this.calls.push("restart");
		this.state = "running";
	}
}

describe("admin ops routes", () => {
	it("requires an admin session", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/status",
		});

		expect(response.statusCode).toBe(401);
	});

	it("returns shared operations status", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const { adminCookie } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/status",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			version: {
				current: "0.2.1",
			},
			update: {
				supported: true,
				entry: "service-action",
				estimatedRestartSeconds: {
					min: 30,
					max: 60,
				},
				check: {
					state: "not_checked",
					currentVersion: "0.2.1",
					autoUpdatable: false,
					source: {
						provider: "github-releases",
						owner: "Virace",
						repo: "QingYan",
						url: "https://github.com/Virace/QingYan",
					},
				},
			},
			upgrade: {
				state: "normal_current",
			},
			backup: {
				format: "qingyan.full-backup",
				provider: "sqlite",
			},
			recovery: {
				manualCommands: [
					"systemctl status qingyan.service",
					"journalctl -u qingyan.service -n 120 --no-pager",
					"qyctl status",
				],
			},
		});
	});

	it("returns update plan without executing update", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/update/plan",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			kind: "program-update",
			executor: "qingyan.service",
			estimatedRestartSeconds: {
				min: 30,
				max: 60,
			},
			manualCommands: expect.arrayContaining(["qyctl status"]),
		});
	});

	it("reports service control as disabled by default", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const { adminCookie } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/service-control",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			enabled: false,
			mode: "disabled",
			state: "unknown",
			restart: {
				confirmation: "RESTART QINGYAN",
			},
		});
	});

	it("rejects service restart when service control is disabled", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);
		const [adminUser] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		if (!adminUser) {
			throw new Error("Expected admin user to exist");
		}

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/service-control/restart",
			...withAdminWriteAuth(admin),
			payload: {
				confirm: "RESTART QINGYAN",
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "SERVICE_CONTROL_DISABLED",
			},
		});
		const audits = await fixture.app.db.select().from(auditLogs);
		expect(audits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					actorType: "admin_user",
					actorId: String(adminUser.id),
					action: "ops.service_restart.rejected",
					targetType: "service",
					targetId: "qingyan.service",
				}),
			]),
		);
	});

	it("requires exact service restart confirmation", async () => {
		const controller = new FakeServiceControl();
		const fixture = await createTestApp({
			serviceControl: controller,
		});
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/service-control/restart",
			...withAdminWriteAuth(admin),
			payload: {
				confirm: "restart",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "INVALID_REQUEST",
			},
		});
		expect(controller.calls).toEqual([]);
	});

	it("restarts the service through an injected service controller", async () => {
		const controller = new FakeServiceControl("running");
		const fixture = await createTestApp({
			serviceControl: controller,
		});
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);
		const [adminUser] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		if (!adminUser) {
			throw new Error("Expected admin user to exist");
		}

		const statusResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/service-control",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});

		expect(statusResponse.statusCode).toBe(200);
		expect(statusResponse.json()).toMatchObject({
			enabled: true,
			mode: "systemd",
			state: "running",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/service-control/restart",
			...withAdminWriteAuth(admin),
			payload: {
				confirm: "RESTART QINGYAN",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			ok: true,
			state: "running",
		});
		expect(controller.calls).toEqual(["status", "restart", "status"]);
		const audits = await fixture.app.db.select().from(auditLogs);
		expect(audits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					actorType: "admin_user",
					actorId: String(adminUser.id),
					action: "ops.service_restart.requested",
					targetType: "service",
					targetId: "qingyan.service",
				}),
			]),
		);
	});

	it("requires an admin session to check for updates", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/update/check",
		});

		expect(response.statusCode).toBe(401);
	});

	it("returns the shared upgrade dry-run state", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/upgrade/dry-run",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			state: "normal_current",
		});
	});

	it("lists maintenance tasks for the task center", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);
		await new TaskRunRepository(fixture.app.db).create({
			id: "maintenance_task_center",
			type: "page_metadata_refresh",
			category: "maintenance",
			status: "queued",
			siteKey: "fangyuan",
			payload: { siteKey: "fangyuan" },
			payloadSummary: { siteKey: "fangyuan" },
			input: { siteKey: "fangyuan" },
			maxAttempts: 2,
			retryDelaySec: 30,
			concurrencyKey: "page-title:fangyuan",
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
			items: [
				{
					id: "maintenance_task_center",
					source: "task_run",
					type: "page_metadata_refresh",
					status: "queued",
					siteKey: "fangyuan",
				},
			],
		});
	});

	it("lists task center jobs with pagination and queue state", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);
		const taskRunRepository = new TaskRunRepository(fixture.app.db);
		await taskRunRepository.create({
			id: "maintenance_task_delayed",
			type: "page_metadata_refresh",
			category: "maintenance",
			siteKey: "fangyuan",
			payload: { siteKey: "fangyuan" },
			payloadSummary: { siteKey: "fangyuan" },
			input: { siteKey: "fangyuan" },
			runAfter: "2099-01-01T00:00:00.000Z",
			maxAttempts: 3,
			retryDelaySec: 60,
			concurrencyKey: "page-title:fangyuan",
			createdAt: "2026-05-30T00:00:02.000Z",
			updatedAt: "2026-05-30T00:00:02.000Z",
		});
		await taskRunRepository.create({
			id: "maintenance_task_older",
			type: "page_metadata_refresh",
			category: "maintenance",
			status: "queued",
			siteKey: "fangyuan",
			payload: { siteKey: "fangyuan" },
			payloadSummary: { siteKey: "fangyuan" },
			input: { siteKey: "fangyuan" },
			maxAttempts: 1,
			retryDelaySec: 0,
			concurrencyKey: "page-title:fangyuan-older",
			createdAt: "2026-05-30T00:00:01.000Z",
			updatedAt: "2026-05-30T00:00:01.000Z",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/tasks?siteKey=fangyuan&limit=1&offset=0",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			totalCount: 2,
			limit: 1,
			offset: 0,
			items: [
				{
					id: "maintenance_task_delayed",
					status: "delayed",
					priority: 0,
					queueState: {
						waitingReason: "delayed_until_run_after",
						readyAt: "2099-01-01T00:00:00.000Z",
					},
				},
			],
		});
		expect(response.json().items[0].queueState.waitingDescription).toContain(
			"2099-01-01T00:00:00.000Z",
		);
	});

	it("creates a missing-title refresh task from the task center", async () => {
		const fixture = await createTestApp({
			pageTitleFetchHtml: async () => ({
				status: 200,
				text: "<title>Task Center Title</title>",
			}),
		});
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/tasks/page-title-refresh",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
				onlyMissingTitle: true,
				batchSize: 25,
				maxAttempts: 3,
				retryDelaySec: 90,
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			run: {
				type: "page_metadata_refresh",
				siteKey: "fangyuan",
				status: "queued",
				maxAttempts: 3,
				retryDelaySec: 90,
				input: {
					siteKey: "fangyuan",
					scope: "missing_only",
					batchSize: 25,
					trigger: "manual",
				},
			},
		});
		const [run] = await fixture.app.db.select().from(taskRuns);
		expect(run).toMatchObject({
			type: "page_metadata_refresh",
			status: "queued",
			siteKey: "fangyuan",
			maxAttempts: 3,
			retryDelaySec: 90,
		});
	});

	it("lists and restores pending delayed page deletions", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:ops-restore",
			pageUrl: "/posts/ops-restore/",
			title: "Ops Restore",
			status: "active",
		});

		const deleteResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/post%3Aops-restore/delete",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
			},
		});
		expect(deleteResponse.statusCode).toBe(200);

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/ops/delayed-deletions?siteKey=fangyuan&status=pending",
			cookies: {
				qingyan_admin: admin.adminCookie.value,
			},
		});
		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json()).toMatchObject({
			totalCount: 1,
			items: [
				{
					id: expect.any(Number),
					resourceType: "page",
					resourceId: "post:ops-restore",
					siteKey: "fangyuan",
					status: "pending",
					metadata: {
						pageKey: "post:ops-restore",
						siteKey: "fangyuan",
					},
				},
			],
		});
		const recordId = listResponse.json().items[0].id as number;

		const restoreResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/ops/delayed-deletions/${recordId}/restore`,
			...withAdminWriteAuth(admin),
		});

		expect(restoreResponse.statusCode).toBe(200);
		expect(restoreResponse.json()).toMatchObject({
			deletion: {
				id: recordId,
				status: "restored",
				restoredAt: expect.any(String),
			},
			resource: {
				resourceType: "page",
				resourceId: "post:ops-restore",
				restoredCount: 1,
			},
		});
		const [page] = await fixture.app.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "post:ops-restore"));
		expect(page).toMatchObject({
			status: "active",
			deletedAt: null,
		});
		const audits = await fixture.app.db.select().from(auditLogs);
		expect(audits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					actorType: "admin_user",
					action: "delayed_deletion.restored",
					targetType: "page",
					targetId: "post:ops-restore",
				}),
			]),
		);
	});

	it("runs due delayed deletion cleanup with actor and resource count audit", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		const [adminUser] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		if (!site || !adminUser) {
			throw new Error("Expected site and admin user to exist");
		}
		await fixture.app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: "post:ops-cleanup",
			pageUrl: "/posts/ops-cleanup/",
			title: "Ops Cleanup",
			status: "deleted",
			deletedAt: "2026-05-01T00:00:00.000Z",
		});
		await fixture.app.db.insert(delayedDeletions).values({
			resourceType: "page",
			resourceId: "post:ops-cleanup",
			siteId: site.id,
			requestedByUserId: adminUser.id,
			requestedAt: "2026-05-01T00:00:00.000Z",
			hardDeleteAfter: "2026-05-16T00:00:00.000Z",
			status: "pending",
			metadataJson: JSON.stringify({
				pageKey: "post:ops-cleanup",
				siteKey: "fangyuan",
			}),
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/delayed-deletions/cleanup",
			...withAdminWriteAuth(admin),
			payload: {
				now: "2026-05-17T00:00:00.000Z",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			processedCount: 1,
			hardDeletedCount: 1,
		});
		const [page] = await fixture.app.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "post:ops-cleanup"));
		expect(page).toBeUndefined();
		const [record] = await fixture.app.db.select().from(delayedDeletions);
		expect(record).toMatchObject({
			resourceType: "page",
			resourceId: "post:ops-cleanup",
			status: "hard_deleted",
			hardDeletedAt: "2026-05-17T00:00:00.000Z",
		});
		const audits = await fixture.app.db.select().from(auditLogs);
		const cleanupAudit = audits.find(
			(audit) => audit.action === "delayed_deletion.cleanup",
		);
		expect(cleanupAudit).toMatchObject({
			actorType: "admin_user",
			actorId: String(adminUser.id),
			targetType: "delayed_deletions",
			targetId: "cleanup",
		});
		expect(JSON.parse(cleanupAudit?.payloadJson ?? "{}")).toMatchObject({
			processedCount: 1,
			hardDeletedCount: 1,
			hardDeletedAt: "2026-05-17T00:00:00.000Z",
			records: [
				{
					resourceType: "page",
					resourceId: "post:ops-cleanup",
					requestedByUserId: adminUser.id,
					requestedAt: "2026-05-01T00:00:00.000Z",
					hardDeletedCount: 1,
				},
			],
		});
	});

	it("restores and hard deletes delayed page trash records with all affected pages", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		const [adminUser] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		if (!site || !adminUser) {
			throw new Error("Expected site and admin user to exist");
		}
		await fixture.app.db.insert(sitePageRegistry).values([
			{
				siteId: site.id,
				pageKey: "post:ops-trash-restore-a",
				pageUrl: "/posts/ops-trash-restore-a/",
				status: "trash",
				trashedAt: "2026-06-01T00:00:00.000Z",
			},
			{
				siteId: site.id,
				pageKey: "post:ops-trash-restore-b",
				pageUrl: "/posts/ops-trash-restore-b/",
				status: "trash",
				trashedAt: "2026-06-01T00:00:00.000Z",
			},
		]);
		const clearResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/pages/trash/clear",
			...withAdminWriteAuth(admin),
			payload: {
				siteKey: "fangyuan",
			},
		});
		expect(clearResponse.statusCode).toBe(200);

		const [record] = await fixture.app.db
			.select()
			.from(delayedDeletions)
			.where(eq(delayedDeletions.resourceType, "page_trash"));
		const restoreResponse = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/ops/delayed-deletions/${record?.id}/restore`,
			...withAdminWriteAuth(admin),
		});
		expect(restoreResponse.statusCode).toBe(200);
		expect(restoreResponse.json()).toMatchObject({
			resource: {
				resourceType: "page_trash",
				resourceId: "fangyuan",
				restoredCount: 2,
			},
		});
		const restoredPages = await fixture.app.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.siteId, site.id));
		expect(restoredPages.map((page) => page.status).sort()).toEqual([
			"active",
			"active",
		]);

		await fixture.app.db.insert(sitePageRegistry).values([
			{
				siteId: site.id,
				pageKey: "post:ops-trash-cleanup-a",
				pageUrl: "/posts/ops-trash-cleanup-a/",
				status: "deleted",
				deletedAt: "2026-06-01T00:00:00.000Z",
			},
			{
				siteId: site.id,
				pageKey: "post:ops-trash-cleanup-b",
				pageUrl: "/posts/ops-trash-cleanup-b/",
				status: "deleted",
				deletedAt: "2026-06-01T00:00:00.000Z",
			},
		]);
		await fixture.app.db.insert(delayedDeletions).values({
			resourceType: "page_trash",
			resourceId: "fangyuan",
			siteId: site.id,
			requestedByUserId: adminUser.id,
			requestedAt: "2026-06-01T00:00:00.000Z",
			hardDeleteAfter: "2026-06-16T00:00:00.000Z",
			status: "pending",
			metadataJson: JSON.stringify({
				siteKey: "fangyuan",
				pageCount: 2,
				pages: [
					{ pageKey: "post:ops-trash-cleanup-a" },
					{ pageKey: "post:ops-trash-cleanup-b" },
				],
			}),
		});

		const cleanupResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/delayed-deletions/cleanup",
			...withAdminWriteAuth(admin),
			payload: {
				now: "2026-06-17T00:00:00.000Z",
			},
		});
		expect(cleanupResponse.statusCode).toBe(200);
		expect(cleanupResponse.json()).toMatchObject({
			processedCount: 1,
			hardDeletedCount: 2,
			records: [
				{
					resourceType: "page_trash",
					resourceId: "fangyuan",
					hardDeletedCount: 2,
				},
			],
		});
		const cleanupPages = await fixture.app.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.siteId, site.id));
		expect(
			cleanupPages
				.filter((page) => page.pageKey.startsWith("post:ops-trash-cleanup"))
				.map((page) => page.pageKey),
		).toEqual([]);
	});
});
