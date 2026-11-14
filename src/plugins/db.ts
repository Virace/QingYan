import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

import { createDatabaseClients } from "../db/client";
import { resolveAdminBootstrap } from "../modules/admin/bootstrap-service";
import { AdminIdentityService } from "../modules/admin/admin-identity-service";
import { IpRegionAutoUpdateScheduler } from "../modules/comments/metadata/ip-region-scheduler";
import { CommentIpMaintenanceService } from "../modules/comments/metadata/comment-ip-maintenance-service";
import { EmailReputationRepository } from "../modules/notifications/email-reputation-repository";
import { NotificationChannelConfigsRepository } from "../modules/notifications/channel-configs-repository";
import { NotificationTemplateContextBuilder } from "../modules/notifications/notification-template-context";
import { RuntimeNotificationChannelAdapterFactory } from "../modules/notifications/notification-channel-adapter-factory";
import { NotificationRuntime } from "../modules/notifications/notification-runtime";
import { NotificationWorker } from "../modules/notifications/notification-worker";
import { fetchPageSourceText } from "../modules/page-registry/source-fetcher";
import { PageSourceRefreshService } from "../modules/page-registry/source-refresh-service";
import { PageMetadataRefreshService } from "../modules/page-registry/title-refresh-service";
import { RuntimeSystemSettingsService } from "../modules/system-settings/service";
import { DefaultDailySiteDigestTaskService } from "../modules/tasks/built-in/daily-site-digest-task";
import { createBuiltInTaskTypeRegistry } from "../modules/tasks/built-in-task-types";
import { ConditionTriggerEvaluator } from "../modules/tasks/condition-trigger-evaluator";
import { ScheduledTaskRepository } from "../modules/tasks/scheduled-task-repository";
import { TaskEventLogRepository } from "../modules/tasks/task-event-log-repository";
import { TaskFailureNotificationService } from "../modules/tasks/task-failure-notification-service";
import { TaskMetricRollupRepository } from "../modules/tasks/task-metric-rollup-repository";
import { TaskRunRepository } from "../modules/tasks/task-run-repository";
import { TaskRunWorker } from "../modules/tasks/task-run-worker";
import { DatabaseTaskQueue } from "../modules/tasks/database-task-queue";
import { TaskRunner } from "../modules/tasks/task-runner";
import { TaskScheduler } from "../modules/tasks/scheduler";
import type { TaskRunnerServices } from "../modules/tasks/task-runner-context";
import { PageSourceRefreshPolicyService } from "../modules/tasks/page-source-refresh-policy";
import { safeFetchText } from "../modules/shared/server-safe-fetch";

async function fetchPageTitleHtml(
	url: string,
	options: { allowedOrigins: string[]; timeoutMs: number; maxBytes: number },
): Promise<{ status: number; text: string }> {
	const response = await safeFetchText(url, options);
	return { status: response.status, text: response.text };
}

const dbPlugin: FastifyPluginAsync = async (fastify) => {
	const clients = createDatabaseClients(fastify.config.database.url, {
		pool: fastify.config.database.pool,
		tls: fastify.config.database.tls,
	});
	const { db, pool } = clients;
	fastify.addHook("onClose", async () => {
		await clients.close();
	});
	fastify.decorate("db", db);
	fastify.decorate("databasePool", pool);
	const adminBootstrap = await resolveAdminBootstrap(
		fastify.config,
		db,
		fastify.runtimeOptions,
	);
	if (adminBootstrap.development) {
		const user = await new AdminIdentityService(db).ensureInitialAdmin(
			adminBootstrap,
		);
		adminBootstrap.initialAdminUserId = user.id;
	}
	fastify.decorate("adminBootstrap", adminBootstrap);

	if (fastify.runtimeOptions.devMode.seed) {
		await fastify.siteRegistry.seedSiteFromTemplate(
			db,
			fastify.runtimeOptions.devMode.seed.site,
		);
	}
	await fastify.siteRegistry.loadFromDatabase(db);
	const systemSettingsService = new RuntimeSystemSettingsService(db);
	const taskMetricRollups = new TaskMetricRollupRepository(db);
	fastify.decorate("taskMetricRollups", taskMetricRollups);
	const ipRegionScheduler = new IpRegionAutoUpdateScheduler(db, () =>
		systemSettingsService.getIpRegionSettings(),
	);
	if (fastify.backgroundRuntimeAutoStart) await ipRegionScheduler.start();
	const titleRefresh = new PageMetadataRefreshService(db, {
		fetchHtml: fastify.pageTitleFetchHtml ?? fetchPageTitleHtml,
	});
	const taskRuns = new TaskRunRepository(db);
	const eventLogs = new TaskEventLogRepository(db);
	const scheduledTasks = new ScheduledTaskRepository(db);
	const sourceRefresh = new PageSourceRefreshService(db, {
		fetchText: fastify.pageSourceFetchText ?? fetchPageSourceText,
		loadAllowedOriginsForSite: async (siteKey) =>
			fastify.siteRegistry.getRegisteredSite(siteKey)?.allowedOrigins ?? [],
		createTitleRefreshRun: async (input) => {
			await taskRuns.create({
				type: "page_metadata_refresh",
				category: "maintenance",
				siteKey: input.siteKey,
				payload: {
					siteKey: input.siteKey,
					scope: "missing_only",
					pageKeys: input.pageKeys,
					trigger: "source_refresh",
				},
				payloadSummary: {
					siteKey: input.siteKey,
					pageKeys: input.pageKeys,
				},
				input: {
					siteKey: input.siteKey,
					scope: "missing_only",
					pageKeys: input.pageKeys,
					trigger: "source_refresh",
				},
				trigger: "source_refresh",
			});
		},
	});
	const taskFailureNotifications = new TaskFailureNotificationService(db);
	const taskTypeRegistry = createBuiltInTaskTypeRegistry();
	const commentIpMaintenance = new CommentIpMaintenanceService(db, {
		loadIpRegionSettings: () => systemSettingsService.getIpRegionSettings(),
	});
	const taskRunnerServices: TaskRunnerServices = {
		pageSourceRefresh: sourceRefresh,
		pageSourceRefreshPolicy: new PageSourceRefreshPolicyService(
			db,
			fastify.siteRegistry,
		),
		pageMetadataRefresh: titleRefresh,
		commentIpMaintenance,
		dailySiteDigest: new DefaultDailySiteDigestTaskService({
			db,
			taskRuns,
		}),
	};
	const taskScheduler = new TaskScheduler({
		scheduledTasks,
		taskRuns,
		eventLogs,
		workerId: `scheduler:${process.pid}`,
		registry: taskTypeRegistry,
		services: taskRunnerServices,
		conditionEvaluator: new ConditionTriggerEvaluator(taskMetricRollups),
		failureNotifications: taskFailureNotifications,
	});
	if (fastify.backgroundRuntimeAutoStart) taskScheduler.start();
	const taskRunWorker = new TaskRunWorker({
		taskRuns,
		runner: new TaskRunner({
			registry: taskTypeRegistry,
			taskRuns,
			scheduledTasks,
			eventLogs,
			workerId: `task-worker:${process.pid}`,
			services: taskRunnerServices,
			failureNotifications: taskFailureNotifications,
		}),
		workerId: `task-worker:${process.pid}`,
		claimScope: {
			excludeCategories: ["notification"],
		},
	});
	if (fastify.backgroundRuntimeAutoStart) taskRunWorker.start();
	const emailReputation = new EmailReputationRepository(db);
	const notificationRuntime = new NotificationRuntime({
		worker: new NotificationWorker({
			queue: new DatabaseTaskQueue(db),
			repository: taskRuns,
			logApp: (record) => fastify.loggerManager.logApp(record),
			adapterFactory: new RuntimeNotificationChannelAdapterFactory({
				configs: new NotificationChannelConfigsRepository(db),
				systemSettings: systemSettingsService,
				emailSender: fastify.emailSender,
			}),
			reputation: {
				recordRecipientFailure: (input) =>
					input.siteId
						? emailReputation.recordRecipientFailure({
								...input,
								siteId: input.siteId,
							})
						: undefined,
				recordSuccess: (input) =>
					input.siteId
						? emailReputation.recordSuccess({
								...input,
								siteId: input.siteId,
							})
						: undefined,
			},
			templateContextBuilder: new NotificationTemplateContextBuilder(
				db,
				fastify.config.server,
			),
		}),
		onError: (error) => {
			fastify.log.error({ err: error }, "Notification worker tick failed.");
		},
	});
	fastify.decorate("notificationRuntime", notificationRuntime);
	if (
		fastify.backgroundRuntimeAutoStart &&
		fastify.notificationRuntimeAutoStart
	) {
		notificationRuntime.start();
	}

	fastify.addHook("onClose", async () => {
		await notificationRuntime.stop();
		await taskRunWorker.stop();
		await taskScheduler.stop();
		await ipRegionScheduler.stop();
	});
};

export default fp(dbPlugin, {
	name: "qingyan-db",
});
