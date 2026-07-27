import { z } from "zod";
import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../../db/client";
import { sites } from "../../../db/schema";
import {
	channelTargetSnapshot,
	defaultEmailChannelConfig,
	type NotificationChannelConfigRecord,
} from "../../notifications/channel-configs-repository";
import {
	SiteNotificationEventsRepository,
	siteBackendNotificationEventTypes,
} from "../../notifications/site-notification-events-repository";
import type { TaskRunRepository } from "../task-run-repository";
import type { TaskRunnerContext } from "../task-runner-context";

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
	private readonly events: SiteNotificationEventsRepository;
	private readonly taskRuns: TaskRunRepository;

	public constructor(
		private readonly services: {
			db: AppDatabase;
			taskRuns: TaskRunRepository;
		},
	) {
		this.taskRuns = services.taskRuns;
		this.events = new SiteNotificationEventsRepository(services.db);
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
		const recipients = (
			await Promise.all(
				siteBackendNotificationEventTypes.map((eventType) =>
					this.events.listActiveEmailRecipients({
						siteId: site.id,
						eventType,
					}),
				),
			)
		).flat();
		const recipientByUserId = new Map(
			recipients.map((recipient) => [recipient.userId, recipient]),
		);
		const eventSettings = await this.events.listSiteEvents(site.id);
		const externalById = new Map(
			eventSettings
				.flatMap((event) => event.externalChannels)
				.filter((config) => config.enabled)
				.map((config) => [config.id, config]),
		);
		if (recipientByUserId.size === 0 && externalById.size === 0) {
			throw new Error("DAILY_DIGEST_RECIPIENT_REQUIRED");
		}
		const created: string[] = [];

		const createTarget = async (target: {
			config: NotificationChannelConfigRecord;
			recipientType: "backend_user" | "external_target";
			recipientUserId: number | null;
			recipientAddress: string;
			identityKey: string;
		}) => {
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
					target.identityKey,
					input.now.toISOString().slice(0, 10),
				].join(":"),
				payloadSummary: {
					siteKey: input.siteKey,
					userId: target.recipientUserId,
					channel: target.config.type,
					channelConfigId: target.config.id,
					activity,
				},
				payload: {
					format: target.config.type === "webhook" ? "json" : "text",
					templateContext: {
						site: { name: input.siteKey, key: input.siteKey },
						time: { iso: input.now.toISOString() },
						digest: { activity },
					},
					subjectTemplate: `[${input.siteKey}] QingYan 每日摘要`,
					bodyTemplate:
						target.config.type === "webhook"
							? JSON.stringify({ siteKey: input.siteKey, activity })
							: `评论 {{digest.activity.comments}} / 回复 {{digest.activity.replies}} / PV {{digest.activity.pageViews}} / 点赞 {{digest.activity.pageLikes}} / 未知页面 {{digest.activity.unknownPages}} / 任务失败 {{digest.activity.taskFailures}}`,
				},
			});
			await this.taskRuns.createDelivery({
				taskRunId: notificationRun.id,
				channel: target.config.type,
				channelConfigRef: target.config.id,
				channelConfigNameSnapshot: target.config.name,
				recipientType: target.recipientType,
				recipientUserId: target.recipientUserId,
				recipientAddressSnapshot: target.recipientAddress,
				recipientIdentityKey: target.identityKey,
				eventFamily: "daily_site_digest",
				templateKey: "daily_site_digest",
			});
			created.push(notificationRun.id);
		};

		for (const recipient of recipientByUserId.values()) {
			await createTarget({
				config: defaultEmailChannelConfig,
				recipientType: "backend_user",
				recipientUserId: recipient.userId,
				recipientAddress: recipient.email,
				identityKey: `backend_user:${recipient.userId}:email:default`,
			});
		}
		for (const config of externalById.values()) {
			await createTarget({
				config,
				recipientType: "external_target",
				recipientUserId: null,
				recipientAddress: channelTargetSnapshot(config),
				identityKey: `external_target:${config.id}`,
			});
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
