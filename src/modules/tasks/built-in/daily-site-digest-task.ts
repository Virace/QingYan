import { z } from "zod";
import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../../db/client";
import { sites } from "../../../db/schema";
import type { TaskRunRepository } from "../task-run-repository";
import type { TaskRunnerContext } from "../task-runner-context";
import { BackendUserNotificationRecipientsRepository } from "../../notifications/backend-user-recipients-repository";
import { channelTargetSnapshot } from "../../notifications/channel-configs-repository";

export const dailySiteDigestPayloadSchema = z.object({
	siteKey: z.string().min(1),
	sendIfNoActivity: z.boolean().default(false),
	activity: z
		.object({
			comments: z.number().int().nonnegative().default(0),
			replies: z.number().int().nonnegative().default(0),
			pageViews: z.number().int().nonnegative().default(0),
			pageLikes: z.number().int().nonnegative().default(0),
			unknownPages: z.number().int().nonnegative().default(0),
			taskFailures: z.number().int().nonnegative().default(0),
		})
		.optional(),
});

export type DailySiteDigestPayload = z.infer<
	typeof dailySiteDigestPayloadSchema
>;

export interface DailySiteDigestTaskService {
	planDigest(
		input: DailySiteDigestPayload & {
			runId: string;
			now: Date;
		},
	): Promise<unknown>;
}

function activityTotal(
	activity: NonNullable<DailySiteDigestPayload["activity"]>,
) {
	return (
		activity.comments +
		activity.replies +
		activity.pageViews +
		activity.pageLikes +
		activity.unknownPages +
		activity.taskFailures
	);
}

export class DefaultDailySiteDigestTaskService
	implements DailySiteDigestTaskService
{
	private readonly recipients: BackendUserNotificationRecipientsRepository;
	private readonly taskRuns: TaskRunRepository;

	public constructor(
		private readonly services: {
			db: AppDatabase;
			taskRuns: TaskRunRepository;
		},
	) {
		this.taskRuns = services.taskRuns;
		this.recipients = new BackendUserNotificationRecipientsRepository(
			services.db,
		);
	}

	public async planDigest(
		input: DailySiteDigestPayload & {
			runId: string;
			now: Date;
		},
	) {
		const activity = input.activity ?? {
			comments: 0,
			replies: 0,
			pageViews: 0,
			pageLikes: 0,
			unknownPages: 0,
			taskFailures: 0,
		};
		if (!input.sendIfNoActivity && activityTotal(activity) === 0) {
			return {
				status: "skipped",
				reason: "no_activity",
				activity,
			};
		}
		const [site] = await this.services.db
			.select({ id: sites.id })
			.from(sites)
			.where(eq(sites.siteKey, input.siteKey))
			.limit(1);
		if (!site) {
			throw new Error("SITE_NOT_FOUND");
		}
		const recipients = await this.recipients.listSiteRecipients(site.id);
		const enabledRecipients = recipients.filter(
			(recipient) => recipient.enabled,
		);
		if (enabledRecipients.length === 0) {
			throw new Error("DAILY_DIGEST_RECIPIENT_REQUIRED");
		}
		const activeUsers = await this.recipients.listActiveSiteRecipientUsers({
			siteId: site.id,
			userIds: enabledRecipients.map((recipient) => recipient.userId),
		});
		const activeUserById = new Map(activeUsers.map((user) => [user.id, user]));
		const created: string[] = [];

		for (const recipient of enabledRecipients) {
			const user = activeUserById.get(recipient.userId);
			if (!user) {
				continue;
			}
			for (const route of recipient.routes) {
				if (!route.enabled || !route.channelConfig?.enabled) {
					continue;
				}
				const notificationRun = await this.taskRuns.create({
					type: "daily_site_digest",
					category: "notification",
					siteId: site.id,
					siteKey: input.siteKey,
					subjectType: "site",
					subjectId: input.siteKey,
					idempotencyKey: [
						"daily_site_digest",
						input.siteKey,
						recipient.userId,
						route.channelConfigId,
						input.now.toISOString().slice(0, 10),
					].join(":"),
					payloadSummary: {
						siteKey: input.siteKey,
						userId: recipient.userId,
						channel: route.channelConfig.type,
						channelConfigId: route.channelConfigId,
						activity,
					},
					payload: {
						format: route.channelConfig.type === "webhook" ? "json" : "text",
						templateContext: {
							site: { name: input.siteKey, key: input.siteKey },
							time: { iso: input.now.toISOString() },
							digest: { activity },
						},
						subjectTemplate: `[${input.siteKey}] QingYan 每日摘要`,
						bodyTemplate:
							route.channelConfig.type === "webhook"
								? JSON.stringify({ siteKey: input.siteKey, activity })
								: `评论 {{digest.activity.comments}} / 回复 {{digest.activity.replies}} / PV {{digest.activity.pageViews}} / 点赞 {{digest.activity.pageLikes}} / 未知页面 {{digest.activity.unknownPages}} / 任务失败 {{digest.activity.taskFailures}}`,
					},
				});
				await this.taskRuns.createDelivery({
					taskRunId: notificationRun.id,
					channel: route.channelConfig.type,
					channelConfigRef: route.channelConfigId,
					channelConfigNameSnapshot: route.channelName,
					recipientType: "backend_user",
					recipientUserId: recipient.userId,
					recipientAddressSnapshot: channelTargetSnapshot(
						route.channelConfig,
						user.email,
					),
					recipientIdentityKey: `backend_user:${recipient.userId}:${route.channelConfigId}`,
					eventFamily: "daily_site_digest",
					templateKey: "daily_site_digest",
				});
				created.push(notificationRun.id);
			}
		}

		if (created.length === 0) {
			throw new Error("DAILY_DIGEST_CHANNEL_REQUIRED");
		}

		return {
			status: "planned",
			notificationRunIds: created,
			activity,
		};
	}
}

export async function runDailySiteDigestTask(
	payload: DailySiteDigestPayload,
	context: TaskRunnerContext,
) {
	const service = context.services.dailySiteDigest;
	if (!service) {
		throw new Error("Task service missing: dailySiteDigest");
	}
	await context.writeEvent({
		eventType: "daily_site_digest_precondition_checked",
		message: "daily_site_digest_precondition_checked",
		data: {
			siteKey: payload.siteKey,
			sendIfNoActivity: payload.sendIfNoActivity,
		},
		visibleToSiteAdmin: true,
	});
	return service.planDigest({
		...payload,
		runId: context.runId,
		now: context.now(),
	});
}
