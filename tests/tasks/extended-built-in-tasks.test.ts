import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import {
	adminGroups,
	adminUserGroups,
	adminUsers,
	adminUserSiteAccess,
	notificationDeliveries,
	sites,
	taskRuns,
} from "../../src/db/schema";
import { createBuiltInTaskTypeRegistry } from "../../src/modules/tasks/built-in-task-types";
import {
	DefaultBackupTaskService,
	type BackupTaskPayload,
} from "../../src/modules/tasks/built-in/backup-task";
import {
	DefaultBlacklistAutomationTaskService,
	runBlacklistAutomationTask,
} from "../../src/modules/tasks/built-in/blacklist-automation-task";
import { DefaultDailySiteDigestTaskService } from "../../src/modules/tasks/built-in/daily-site-digest-task";
import { DefaultSiteSettingsActionTaskService } from "../../src/modules/tasks/built-in/site-settings-action-task";
import type { TaskRunnerContext } from "../../src/modules/tasks/task-runner-context";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { BackendUserNotificationRecipientsRepository } from "../../src/modules/notifications/backend-user-recipients-repository";
import {
	applyInitialMigration,
	createTestWorkspace,
	type TestWorkspace,
} from "../support/test-fixtures";

function createContext(
	overrides: Partial<TaskRunnerContext> = {},
): TaskRunnerContext {
	return {
		runId: "task_run_extended",
		scheduledTaskId: "scheduled_task_extended",
		actor: { type: "admin_user", id: "7" },
		services: {},
		log: {
			stdout: vi.fn(),
			stderr: vi.fn(),
			system: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			write: vi.fn(),
		},
		writeEvent: vi.fn(),
		updateProgress: vi.fn(),
		writeAudit: vi.fn(),
		now: () => new Date("2026-06-04T10:00:00.000Z"),
		signal: new AbortController().signal,
		...overrides,
	};
}

interface DbFixture {
	workspace: TestWorkspace;
	db: ReturnType<typeof createDatabaseClients>["db"];
	sqlite: ReturnType<typeof createDatabaseClients>["sqlite"];
	siteId: number;
	adminUserId: number;
}

const fixtures: DbFixture[] = [];
const tempDirectories: string[] = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.sqlite.close();
		fixture.workspace.cleanup();
	}
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

async function createDbFixture(): Promise<DbFixture> {
	const workspace = createTestWorkspace("qingyan-extended-built-in-tasks-");
	applyInitialMigration(workspace.databaseFile);
	const clients = createDatabaseClients(workspace.databaseFile);
	await clients.db.insert(sites).values({
		siteKey: "fangyuan",
		name: "FangYuan",
		allowedOriginsJson: "[]",
	});
	const [site] = await clients.db.select().from(sites).limit(1);
	await clients.db.insert(adminUsers).values({
		username: "digest-admin",
		email: "digest-admin@example.test",
		passwordHash: "hash",
		displayName: "Digest Admin",
		isInitialAdmin: true,
	});
	const [adminUser] = await clients.db.select().from(adminUsers).limit(1);
	await clients.db.insert(adminGroups).values({
		key: "site_admin",
		name: "Site Admin",
	});
	const [adminGroup] = await clients.db.select().from(adminGroups).limit(1);
	await clients.db.insert(adminUserGroups).values({
		userId: adminUser.id,
		groupId: adminGroup.id,
	});
	await clients.db.insert(adminUserSiteAccess).values({
		userId: adminUser.id,
		siteId: site.id,
	});
	const fixture = {
		workspace,
		db: clients.db,
		sqlite: clients.sqlite,
		siteId: site.id,
		adminUserId: adminUser.id,
	};
	fixtures.push(fixture);
	return fixture;
}

describe("extended built-in task types", () => {
	it("registers extended types without arbitrary script, sql, or command tasks", () => {
		const definitions = createBuiltInTaskTypeRegistry().list();
		const byType = new Map(
			definitions.map((definition) => [definition.type, definition]),
		);

		expect(byType.get("backup")).toMatchObject({
			category: "backup",
			dangerous: false,
			reuse: {
				service: "QingYanExportService",
				method: "exportSite",
			},
		});
		expect(byType.get("site_settings_action")).toMatchObject({
			category: "system",
			dangerous: true,
			reuse: {
				service: "AdminManagementService",
				method: "updateSettings",
			},
		});
		expect(byType.get("blacklist_automation")).toMatchObject({
			category: "system",
			dangerous: true,
			reuse: {
				service: "AdminManagementService",
				method: "createBlacklist",
			},
		});
		expect(byType.get("daily_site_digest")).toMatchObject({
			category: "notification",
			dangerous: false,
			reuse: {
				service: "BackendUserNotificationRecipientsRepository",
				method: "listSiteRecipients",
			},
		});
		expect(
			["script", "shell", "sql", "command", "javascript", "python"].flatMap(
				(type) => (byType.has(type) ? [type] : []),
			),
		).toEqual([]);
	});

	it("delegates backup execution to the injected backup service with include options", async () => {
		const service = {
			createBackup: vi.fn().mockResolvedValue({ fileName: "backup.json" }),
		};
		const context = createContext({ services: { backup: service } });
		const payload: BackupTaskPayload = {
			scope: "site",
			siteKey: "fangyuan",
			include: {
				comments: true,
				pageThreads: true,
				rawUserAgent: false,
			},
			retentionCount: 3,
		};

		await createBuiltInTaskTypeRegistry()
			.getRequired("backup")
			.run(payload, context);

		expect(service.createBackup).toHaveBeenCalledWith({
			...payload,
			runId: "task_run_extended",
		});
		expect(context.writeEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "backup_precondition_checked" }),
		);
	});

	it("uses QingYanExportService for site backup output", async () => {
		const workspaceDirectory = mkdtempSync(
			path.join(tmpdir(), "qingyan-backup-task-"),
		);
		tempDirectories.push(workspaceDirectory);
		const previousCwd = process.cwd();
		const exportService = {
			exportSite: vi.fn().mockReturnValue({
				createdAt: "2026-06-04T10:00:00.000Z",
				site: { siteKey: "fangyuan" },
			}),
		};
		const service = new DefaultBackupTaskService({
			exportService: exportService as never,
		});

		let result: Awaited<ReturnType<DefaultBackupTaskService["createBackup"]>>;
		try {
			process.chdir(workspaceDirectory);
			result = await service.createBackup({
				runId: "run_backup",
				scope: "site",
				siteKey: "fangyuan",
				include: {
					comments: true,
					pageThreads: false,
					rawUserAgent: false,
				},
				retentionCount: 4,
			});
		} finally {
			process.chdir(previousCwd);
		}

		expect(exportService.exportSite).toHaveBeenCalledWith({
			siteKey: "fangyuan",
			include: {
				comments: true,
				pageThreads: false,
				rawUserAgent: false,
			},
		});
		expect(result).toMatchObject({
			scope: "site",
			siteKey: "fangyuan",
			fileName: "run_backup-fangyuan.qingyan-export.json",
			size: expect.any(Number),
			hash: expect.any(String),
			retentionCount: 4,
		});
		expect(result.path).toContain(
			path.join(workspaceDirectory, "data", "task-backups"),
		);
	});

	it("creates a restore task run after applying a temporary site settings action", async () => {
		const getSettings = vi.fn().mockResolvedValue({
			comments: {
				enabled: true,
				captcha: {
					mode: "threshold",
					thresholdWindowSec: 300,
					thresholdMaxActions: 5,
				},
				metadata: {
					collectIp: true,
					collectUserAgent: true,
				},
			},
			pageFeedback: {
				allowLike: true,
			},
			engagement: {
				visitors: { enabled: true },
				pageViews: { enabled: true },
				pageLikes: { enabled: true },
				commentVotes: { enabled: true },
			},
		});
		const updateSettings = vi
			.fn()
			.mockResolvedValue({ comments: { enabled: false } });
		const createRun = vi.fn().mockResolvedValue({ id: "restore_run_1" });
		const service = new DefaultSiteSettingsActionTaskService({
			adminManagement: { getSettings, updateSettings } as never,
			taskRuns: { create: createRun } as never,
		});

		const result = await service.applyAction({
			runId: "run_settings",
			actorUserId: 7,
			siteKey: "fangyuan",
			action: "disable_comments",
			ttlSec: 3600,
		});

		expect(updateSettings).toHaveBeenCalledWith(
			"fangyuan",
			expect.objectContaining({
				comments: { enabled: false },
				requestId: "task:run_settings",
				actorUserId: 7,
			}),
		);
		expect(createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "site_settings_action",
				category: "system",
				siteKey: "fangyuan",
				payload: expect.objectContaining({
					restore: true,
					restoreSnapshot: expect.objectContaining({
						comments: expect.objectContaining({ enabled: true }),
					}),
				}),
			}),
		);
		expect(result).toMatchObject({
			restore: {
				kind: "task_run_restore",
				runId: "restore_run_1",
			},
		});
	});

	it("creates blacklist rules through AdminManagementService and redacts target values in events", async () => {
		const service = {
			createRule: vi.fn().mockResolvedValue({ id: 11 }),
		};
		const context = createContext({
			services: { blacklistAutomation: service },
		});

		await runBlacklistAutomationTask(
			{
				siteKey: "fangyuan",
				targetType: "ip",
				matchMode: "exact",
				targetValue: "203.0.113.42",
				scope: "post",
				expiresInSec: 3600,
				sourceMetric: {
					metricKey: "comment_spam_count",
					windowSec: 300,
					value: 8,
					threshold: 5,
				},
			},
			context,
		);

		expect(context.writeEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: "blacklist_automation_precondition_checked",
				data: expect.objectContaining({
					targetValueRedacted: "203.0.*.*",
				}),
				visibleToSiteAdmin: true,
			}),
		);
		expect(service.createRule).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "task_run_extended",
				actorUserId: 7,
			}),
		);
	});

	it("uses AdminManagementService when creating blacklist automation rules", async () => {
		const createBlacklist = vi.fn().mockResolvedValue({ id: 22 });
		const service = new DefaultBlacklistAutomationTaskService({
			adminManagement: { createBlacklist } as never,
		});

		const result = await service.createRule({
			runId: "run_blacklist",
			actorUserId: 7,
			now: new Date("2026-06-04T10:00:00.000Z"),
			siteKey: "fangyuan",
			targetType: "email",
			matchMode: "exact",
			targetValue: "abuse@example.test",
			scope: "post",
			expiresInSec: 600,
		});

		expect(createBlacklist).toHaveBeenCalledWith(
			expect.objectContaining({
				siteKey: "fangyuan",
				targetType: "email",
				targetValue: "abuse@example.test",
				expiresAt: "2026-06-04T10:10:00.000Z",
				requestId: "task:run_blacklist",
				actorUserId: 7,
			}),
		);
		expect(result).toMatchObject({
			targetValueRedacted: "ab***@example.test",
		});
	});

	it("skips daily digest when there is no activity and sendIfNoActivity is false", async () => {
		const fixture = await createDbFixture();
		const service = new DefaultDailySiteDigestTaskService({
			db: fixture.db,
			taskRuns: new TaskRunRepository(fixture.db),
		});

		const result = await service.planDigest({
			runId: "run_digest",
			now: new Date("2026-06-04T10:00:00.000Z"),
			siteKey: "fangyuan",
			sendIfNoActivity: false,
		});

		expect(result).toMatchObject({
			status: "skipped",
			reason: "no_activity",
		});
		expect(await fixture.db.select().from(taskRuns)).toHaveLength(0);
	});

	it("blocks daily digest when no backend recipient is configured", async () => {
		const fixture = await createDbFixture();
		const service = new DefaultDailySiteDigestTaskService({
			db: fixture.db,
			taskRuns: new TaskRunRepository(fixture.db),
		});

		await expect(
			service.planDigest({
				runId: "run_digest",
				now: new Date("2026-06-04T10:00:00.000Z"),
				siteKey: "fangyuan",
				sendIfNoActivity: true,
				activity: {
					comments: 1,
					replies: 0,
					pageViews: 10,
					pageLikes: 0,
					unknownPages: 0,
					taskFailures: 0,
				},
			}),
		).rejects.toThrow("DAILY_DIGEST_RECIPIENT_REQUIRED");
	});

	it("creates notification task runs and deliveries for daily digest recipients", async () => {
		const fixture = await createDbFixture();
		const recipients = new BackendUserNotificationRecipientsRepository(
			fixture.db,
		);
		await recipients.replaceSiteRecipients({
			siteId: fixture.siteId,
			recipients: [
				{
					userId: fixture.adminUserId,
					routes: [
						{
							eventType: "admin_comment_pending",
							channelConfigId: "email:default",
							enabled: true,
						},
					],
					includeCommentContent: "summary",
					enabled: true,
				},
			],
		});
		const service = new DefaultDailySiteDigestTaskService({
			db: fixture.db,
			taskRuns: new TaskRunRepository(fixture.db),
		});

		const result = await service.planDigest({
			runId: "run_digest",
			now: new Date("2026-06-04T10:00:00.000Z"),
			siteKey: "fangyuan",
			sendIfNoActivity: false,
			activity: {
				comments: 2,
				replies: 1,
				pageViews: 40,
				pageLikes: 3,
				unknownPages: 1,
				taskFailures: 1,
			},
		});

		expect(result).toMatchObject({
			status: "planned",
			notificationRunIds: [expect.any(String)],
		});
		const [digestRun] = await fixture.db
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.type, "daily_site_digest"));
		expect(digestRun).toMatchObject({
			category: "notification",
			status: "queued",
			siteId: fixture.siteId,
			siteKey: "fangyuan",
		});
		const deliveries = await fixture.db
			.select()
			.from(notificationDeliveries)
			.where(eq(notificationDeliveries.taskRunId, digestRun.id));
		expect(deliveries).toEqual([
			expect.objectContaining({
				channel: "email",
				channelConfigRef: "email:default",
				recipientType: "backend_user",
				recipientUserId: fixture.adminUserId,
				eventFamily: "daily_site_digest",
				templateKey: "daily_site_digest",
			}),
		]);
	});
});
