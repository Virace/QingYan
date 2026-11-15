import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { adminUsers, sites } from "../../src/db/schema";
import { ScheduledTaskRepository } from "../../src/modules/tasks/scheduled-task-repository";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import {
	applyInitialMigration,
	createTestWorkspace,
	type TestWorkspace,
} from "../support/test-fixtures";

interface Fixture {
	workspace: TestWorkspace;
	db: ReturnType<typeof createDatabaseClients>["db"];
	close: ReturnType<typeof createDatabaseClients>["close"];
	scheduledTasks: ScheduledTaskRepository;
	eventLogs: TaskEventLogRepository;
	taskRuns: TaskRunRepository;
	siteId: number;
	adminUserId: number;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.close();
		await fixture.workspace.cleanup();
	}
});

async function createFixture(): Promise<Fixture> {
	const workspace = createTestWorkspace("qingyan-scheduled-tasks-");
	await applyInitialMigration(workspace.databaseUrl);
	const clients = createDatabaseClients(workspace.databaseUrl);
	await clients.db.insert(sites).values({
		siteKey: "fangyuan",
		name: "FangYuan",
		allowedOriginsJson: "[]",
	});
	const [site] = await clients.db.select().from(sites).limit(1);
	await clients.db.insert(adminUsers).values({
		username: "admin",
		email: "admin@example.test",
		passwordHash: "hash",
		displayName: "Admin",
		isInitialAdmin: true,
	});
	const [adminUser] = await clients.db.select().from(adminUsers).limit(1);
	const fixture = {
		workspace,
		db: clients.db,
		close: clients.close,
		scheduledTasks: new ScheduledTaskRepository(clients.db, {
			retentionCountMax: 10,
		}),
		eventLogs: new TaskEventLogRepository(clients.db),
		taskRuns: new TaskRunRepository(clients.db),
		siteId: site.id,
		adminUserId: adminUser.id,
	};
	fixtures.push(fixture);
	return fixture;
}

describe("ScheduledTaskRepository", () => {
	it("creates scheduled tasks and clamps retention count to the system limit", async () => {
		const { scheduledTasks, siteId, adminUserId } = await createFixture();

		const task = await scheduledTasks.create({
			name: "Refresh FangYuan sources",
			description: "Refresh sitemap/RSS sources",
			type: "page_source_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "interval",
			schedulePreset: "hourly",
			timezone: "Asia/Shanghai",
			payload: { sitemapUrls: ["https://example.com/sitemap.xml"] },
			payloadSchemaVersion: 1,
			policy: { maxAttempts: 2, retryDelaySec: 60 },
			trigger: { kind: "schedule" },
			triggerSchemaVersion: 1,
			nextRunAt: "2026-06-04T10:00:00.000Z",
			retentionCount: 99,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		expect(task).toMatchObject({
			name: "Refresh FangYuan sources",
			type: "page_source_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "interval",
			schedulePreset: "hourly",
			payload: { sitemapUrls: ["https://example.com/sitemap.xml"] },
			policy: { maxAttempts: 2, retryDelaySec: 60 },
			trigger: { kind: "schedule" },
			retentionCount: 10,
			ownerUserId: adminUserId,
		});
	});

	it("updates status and writes a deletion snapshot in one repository call", async () => {
		const { scheduledTasks, siteId, adminUserId } = await createFixture();
		const task = await scheduledTasks.create({
			name: "Refresh titles",
			type: "page_metadata_refresh",
			siteId,
			scopeKind: "site",
			scope: { siteKey: "fangyuan" },
			enabled: true,
			scheduleKind: "daily",
			payload: { scope: "missing_only" },
			policy: {},
			trigger: { kind: "schedule" },
			retentionCount: 5,
			ownerUserId: adminUserId,
			createdByUserId: adminUserId,
			updatedByUserId: adminUserId,
		});

		await scheduledTasks.disable(task.id, {
			reason: "manual_disabled",
			updatedByUserId: adminUserId,
		});
		const disabled = await scheduledTasks.getRequired(task.id);
		const snapshot = await scheduledTasks.deleteWithSnapshot(task.id, {
			deletedByUserId: adminUserId,
			deleteReason: "cleanup",
		});

		expect(disabled).toMatchObject({
			enabled: false,
			disabledReason: "manual_disabled",
		});
		expect(await scheduledTasks.get(task.id)).toBeNull();
		expect(snapshot).toMatchObject({
			scheduledTaskId: task.id,
			deletedByUserId: adminUserId,
			deleteReason: "cleanup",
			lastStatus: null,
		});
		expect(snapshot.snapshot).toMatchObject({
			id: task.id,
			name: "Refresh titles",
			enabled: false,
			disabledReason: "manual_disabled",
		});
	});

	it("paginates event logs and hides private events from summary viewers", async () => {
		const { eventLogs, taskRuns } = await createFixture();
		const run = await taskRuns.create({
			type: "notification.channel_test",
			category: "notification",
			payloadSummary: { channel: "email" },
			payload: { channel: "email" },
		});

		await eventLogs.append({
			taskRunId: run.id,
			eventType: "created",
			level: "info",
			message: "Run created",
			data: { visible: true },
			visibleToSiteAdmin: true,
			createdAt: "2026-06-04T10:00:00.000Z",
		});
		await eventLogs.append({
			taskRunId: run.id,
			eventType: "secret_payload_loaded",
			level: "debug",
			message: "Payload loaded",
			data: { secret: "redacted" },
			visibleToSiteAdmin: false,
			createdAt: "2026-06-04T10:01:00.000Z",
		});

		const summary = await eventLogs.listForRun({
			taskRunId: run.id,
			limit: 10,
			offset: 0,
			includePrivate: false,
		});
		const detail = await eventLogs.listForRun({
			taskRunId: run.id,
			limit: 1,
			offset: 1,
			includePrivate: true,
		});

		expect(summary).toMatchObject({
			totalCount: 1,
			items: [
				{
					eventType: "created",
					data: { visible: true },
					visibleToSiteAdmin: true,
				},
			],
		});
		expect(detail).toMatchObject({
			totalCount: 2,
			items: [
				{
					eventType: "secret_payload_loaded",
					visibleToSiteAdmin: false,
				},
			],
		});
	});
	it("prevents an expired scheduler lease from clearing a newer claim or creating a run", async () => {
		const { scheduledTasks, taskRuns, adminUserId } = await createFixture();
		const task = await scheduledTasks.create({
			name: "lease",
			type: "page_metadata_refresh",
			scopeKind: "global",
			scope: {},
			enabled: true,
			scheduleKind: "interval",
			payload: {},
			policy: {},
			trigger: {},
			nextRunAt: "2026-06-04T10:00:00.000Z",
			ownerUserId: adminUserId,
		});
		const old = await scheduledTasks.claimDue(task.id, {
			nowIso: "2026-06-04T10:00:00.000Z",
			workerId: "old",
			claimExpiresAt: "2026-06-04T10:05:00.000Z",
		});
		const current = await scheduledTasks.claimDue(task.id, {
			nowIso: "2026-06-04T10:06:00.000Z",
			workerId: "new",
			claimExpiresAt: "2026-06-04T10:11:00.000Z",
		});
		if (!old || !current) throw new Error("Expected scheduler claims");
		expect(
			await scheduledTasks.releaseClaim(old, {
				nextRunAt: null,
				updatedAt: "2026-06-04T10:06:00.000Z",
			}),
		).toBeNull();
		expect(
			await taskRuns.createScheduledTaskRunAndAdvance(
				{
					scheduledTask: old,
					trigger: "schedule",
					triggerSnapshot: {},
					input: {},
				},
				{ nextRunAt: null },
			),
		).toBeNull();
		expect(await scheduledTasks.getRequired(task.id)).toMatchObject({
			claimWorkerId: "new",
			claimExpiresAt: "2026-06-04T10:11:00.000Z",
		});
		expect(
			(await taskRuns.listForTaskCenter({ limit: 10, offset: 0 })).totalCount,
		).toBe(0);
	});
});
