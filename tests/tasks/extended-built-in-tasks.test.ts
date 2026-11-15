import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	notificationChannelConfigs,
	notificationDeliveries,
	sites,
	taskRuns,
} from "../../src/db/schema";
import {
	SiteNotificationEventsRepository,
	siteBackendNotificationEventTypes,
} from "../../src/modules/notifications/site-notification-events-repository";
import {
	DefaultBlacklistAutomationTaskService,
	runBlacklistAutomationTask,
} from "../../src/modules/tasks/built-in/blacklist-automation-task";
import { DefaultDailySiteDigestTaskService } from "../../src/modules/tasks/built-in/daily-site-digest-task";
import { DefaultSiteSettingsActionTaskService } from "../../src/modules/tasks/built-in/site-settings-action-task";
import { createBuiltInTaskTypeRegistry } from "../../src/modules/tasks/built-in-task-types";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import type { TaskRunnerContext } from "../../src/modules/tasks/task-runner-context";
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
	close: ReturnType<typeof createDatabaseClients>["close"];
	siteId: number;
	adminUserId: number;
}

const fixtures: DbFixture[] = [];

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.close();
		await fixture.workspace.cleanup();
	}
});

async function createDbFixture(): Promise<DbFixture> {
	const workspace = createTestWorkspace("qingyan-extended-built-in-tasks-");
	await applyInitialMigration(workspace.databaseUrl);
	const clients = createDatabaseClients(workspace.databaseUrl);
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
		close: clients.close,
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

		expect(byType.has("backup")).toBe(false);
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
				service: "SiteNotificationEventsRepository",
				method: "listSiteEvents",
			},
		});
		expect(
			["script", "shell", "sql", "command", "javascript", "python"].flatMap(
				(type) => (byType.has(type) ? [type] : []),
			),
		).toEqual([]);
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
		const events = new SiteNotificationEventsRepository(fixture.db);
		await events.replaceSiteEvents({
			siteId: fixture.siteId,
			events: siteBackendNotificationEventTypes.map((eventType) => ({
				eventType,
				recipientUserIds: [fixture.adminUserId],
				externalChannelConfigIds: [],
			})),
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

	it("sends one daily digest to an external target selected by both comment events", async () => {
		const fixture = await createDbFixture();
		await fixture.db.insert(notificationChannelConfigs).values({
			id: "webhook:digest",
			type: "webhook",
			name: "摘要 Webhook",
			enabled: true,
			configJson: '{"url":"https://hooks.example.test/digest"}',
			secretConfigJson: "{}",
		});
		await new SiteNotificationEventsRepository(fixture.db).replaceSiteEvents({
			siteId: fixture.siteId,
			events: siteBackendNotificationEventTypes.map((eventType) => ({
				eventType,
				recipientUserIds: [],
				externalChannelConfigIds: ["webhook:digest"],
			})),
		});
		const service = new DefaultDailySiteDigestTaskService({
			db: fixture.db,
			taskRuns: new TaskRunRepository(fixture.db),
		});

		const result = await service.planDigest({
			runId: "run_external_digest",
			now: new Date("2026-06-04T10:00:00.000Z"),
			siteKey: "fangyuan",
			sendIfNoActivity: true,
		});

		expect(result).toMatchObject({
			status: "planned",
			notificationRunIds: [expect.any(String)],
		});
		expect(await fixture.db.select().from(notificationDeliveries)).toEqual([
			expect.objectContaining({
				channel: "webhook",
				channelConfigRef: "webhook:digest",
				recipientType: "external_target",
				recipientUserId: null,
				eventFamily: "daily_site_digest",
			}),
		]);
	});
});
