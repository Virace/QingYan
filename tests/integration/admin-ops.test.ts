import { afterEach, describe, expect, it } from "vitest";

import {
	adminBootstrapState,
	auditLogs,
	maintenanceJobs,
} from "../../src/db/schema";
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
				current: "0.1.0",
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
					currentVersion: "0.1.0",
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
					actorType: "admin",
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
					actorType: "admin",
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
		await fixture.app.db.insert(maintenanceJobs).values({
			id: "maintenance_task_center",
			type: "page_metadata_refresh",
			status: "queued",
			siteKey: "fangyuan",
			scopeJson: JSON.stringify({ siteKey: "fangyuan" }),
			runAfter: null,
			attempts: 0,
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
					source: "maintenance",
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
		await fixture.app.db.insert(maintenanceJobs).values([
			{
				id: "maintenance_task_delayed",
				type: "page_metadata_refresh",
				status: "delayed",
				siteKey: "fangyuan",
				scopeJson: JSON.stringify({ siteKey: "fangyuan" }),
				runAfter: "2099-01-01T00:00:00.000Z",
				attempts: 0,
				maxAttempts: 3,
				retryDelaySec: 60,
				concurrencyKey: "page-title:fangyuan",
				createdAt: "2026-05-30T00:00:02.000Z",
				updatedAt: "2026-05-30T00:00:02.000Z",
			},
			{
				id: "maintenance_task_older",
				type: "page_metadata_refresh",
				status: "queued",
				siteKey: "fangyuan",
				scopeJson: JSON.stringify({ siteKey: "fangyuan" }),
				runAfter: null,
				attempts: 0,
				maxAttempts: 1,
				retryDelaySec: 0,
				concurrencyKey: "page-title:fangyuan-older",
				createdAt: "2026-05-30T00:00:01.000Z",
				updatedAt: "2026-05-30T00:00:01.000Z",
			},
		]);

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

	it("runs delayed tasks now and raises queued task priority", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		await seedInstalledBootstrap(fixture);
		const admin = await loginAsAdmin(fixture.app);
		await fixture.app.db.insert(maintenanceJobs).values({
			id: "maintenance_task_prioritize",
			type: "page_metadata_refresh",
			status: "delayed",
			siteKey: "fangyuan",
			scopeJson: JSON.stringify({ siteKey: "fangyuan" }),
			runAfter: "2099-01-01T00:00:00.000Z",
			attempts: 0,
			maxAttempts: 1,
			retryDelaySec: 0,
			concurrencyKey: "page-title:fangyuan",
		});

		const runNowResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/tasks/maintenance_task_prioritize/run-now",
			...withAdminWriteAuth(admin),
		});

		expect(runNowResponse.statusCode).toBe(200);
		expect(runNowResponse.json()).toMatchObject({
			job: {
				id: "maintenance_task_prioritize",
				status: "queued",
				runAfter: null,
			},
		});

		const prioritizeResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/ops/tasks/maintenance_task_prioritize/prioritize",
			...withAdminWriteAuth(admin),
		});

		expect(prioritizeResponse.statusCode).toBe(200);
		expect(prioritizeResponse.json()).toMatchObject({
			job: {
				id: "maintenance_task_prioritize",
				priority: 1,
			},
		});
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
			job: {
				type: "page_metadata_refresh",
				siteKey: "fangyuan",
				status: "queued",
				maxAttempts: 3,
				retryDelaySec: 90,
				scope: {
					siteKey: "fangyuan",
					onlyMissingTitle: true,
					batchSize: 25,
					trigger: "manual",
				},
			},
		});
	});
});
