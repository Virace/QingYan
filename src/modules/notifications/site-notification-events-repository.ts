import { randomUUID } from "node:crypto";

import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	adminGroups,
	adminUserGroups,
	adminUserSiteAccess,
	adminUsers,
	notificationChannelConfigs,
	siteNotificationEventChannels,
	siteNotificationEventRecipients,
} from "../../db/schema";
import { AppError, ResourceNotFoundError } from "../shared/errors";
import {
	type BackendUserIncludeCommentContent,
	BackendUserNotificationRecipientsRepository,
} from "./backend-user-recipients-repository";
import {
	type NotificationChannelConfigRecord,
	NotificationChannelConfigsRepository,
} from "./channel-configs-repository";

export const siteBackendNotificationEventTypes = [
	"admin_comment_pending",
	"admin_comment_approved",
] as const;

export type SiteBackendNotificationEventType =
	(typeof siteBackendNotificationEventTypes)[number];

export interface SiteNotificationEventRecipientRecord {
	assignmentId: string;
	userId: number;
	username: string;
	displayName: string;
	email: string;
	status: string;
	includeCommentContent: BackendUserIncludeCommentContent;
}

export interface SiteNotificationEventRecord {
	eventType: SiteBackendNotificationEventType;
	recipients: SiteNotificationEventRecipientRecord[];
	externalChannelConfigIds: string[];
	externalChannels: NotificationChannelConfigRecord[];
}

export interface SiteNotificationEventInput {
	eventType: SiteBackendNotificationEventType;
	recipientUserIds: number[];
	externalChannelConfigIds: string[];
}

type SiteNotificationEventsTransaction = Parameters<
	Parameters<AppDatabase["transaction"]>[0]
>[0];

function createAssignmentId(prefix: "sner" | "snec") {
	return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function ensureUnique(
	values: Array<string | number>,
	code: string,
	message: string,
) {
	if (new Set(values).size !== values.length) {
		throw new AppError(400, code, message);
	}
}

function validateEventInputs(
	events: SiteNotificationEventInput[],
): SiteNotificationEventInput[] {
	const eventTypes = events.map((event) => event.eventType);
	ensureUnique(
		eventTypes,
		"ADMIN_NOTIFICATION_EVENT_DUPLICATE",
		"每种通知类型只能配置一次。",
	);
	if (
		events.length !== siteBackendNotificationEventTypes.length ||
		siteBackendNotificationEventTypes.some(
			(eventType) => !eventTypes.includes(eventType),
		)
	) {
		throw new AppError(
			400,
			"ADMIN_NOTIFICATION_EVENTS_INCOMPLETE",
			"必须同时提交全部站点通知类型。",
		);
	}
	for (const event of events) {
		ensureUnique(
			event.recipientUserIds,
			"ADMIN_NOTIFICATION_EVENT_RECIPIENT_DUPLICATE",
			"同一通知类型不能重复选择接收人。",
		);
		ensureUnique(
			event.externalChannelConfigIds,
			"ADMIN_NOTIFICATION_EVENT_CHANNEL_DUPLICATE",
			"同一通知类型不能重复选择其他接收目标。",
		);
	}
	return siteBackendNotificationEventTypes.map(
		(eventType) =>
			events.find((event) => event.eventType === eventType) as
				| SiteNotificationEventInput
				| never,
	);
}

export class SiteNotificationEventsRepository {
	private readonly channelConfigs: NotificationChannelConfigsRepository;
	private readonly legacyRecipients: BackendUserNotificationRecipientsRepository;

	public constructor(private readonly db: AppDatabase) {
		this.channelConfigs = new NotificationChannelConfigsRepository(db);
		this.legacyRecipients = new BackendUserNotificationRecipientsRepository(db);
	}

	public async listSiteEvents(
		siteId: number,
	): Promise<SiteNotificationEventRecord[]> {
		const recipientRows = await this.db
			.select({
				assignmentId: siteNotificationEventRecipients.id,
				eventType: siteNotificationEventRecipients.eventType,
				userId: adminUsers.id,
				username: adminUsers.username,
				displayName: adminUsers.displayName,
				email: adminUsers.email,
				status: adminUsers.status,
				includeCommentContent:
					siteNotificationEventRecipients.includeCommentContent,
			})
			.from(siteNotificationEventRecipients)
			.innerJoin(
				adminUsers,
				eq(adminUsers.id, siteNotificationEventRecipients.userId),
			)
			.where(eq(siteNotificationEventRecipients.siteId, siteId))
			.orderBy(adminUsers.username);
		const channelRows = await this.db
			.select({
				eventType: siteNotificationEventChannels.eventType,
				channelConfigId: siteNotificationEventChannels.channelConfigId,
			})
			.from(siteNotificationEventChannels)
			.where(eq(siteNotificationEventChannels.siteId, siteId));
		const channelConfigs = await this.channelConfigs.listByIds(
			channelRows.map((row) => row.channelConfigId),
		);
		const configById = new Map(
			channelConfigs.map((config) => [config.id, config]),
		);

		return siteBackendNotificationEventTypes.map((eventType) => {
			const eventChannelRows = channelRows.filter(
				(row) => row.eventType === eventType,
			);
			return {
				eventType,
				recipients: recipientRows
					.filter((row) => row.eventType === eventType)
					.map((row) => ({
						assignmentId: row.assignmentId,
						userId: row.userId,
						username: row.username,
						displayName: row.displayName,
						email: row.email,
						status: row.status,
						includeCommentContent:
							row.includeCommentContent as BackendUserIncludeCommentContent,
					})),
				externalChannelConfigIds: eventChannelRows.map(
					(row) => row.channelConfigId,
				),
				externalChannels: eventChannelRows.flatMap((row) => {
					const config = configById.get(row.channelConfigId);
					return config ? [config] : [];
				}),
			};
		});
	}

	public async validateSiteEvents(input: {
		siteId: number;
		events: SiteNotificationEventInput[];
	}) {
		const events = validateEventInputs(input.events);
		const userIds = Array.from(
			new Set(events.flatMap((event) => event.recipientUserIds)),
		);
		for (const userId of userIds) {
			const candidate =
				await this.legacyRecipients.getUserForRecipientValidation({
					siteId: input.siteId,
					userId,
				});
			if (!candidate) {
				throw new ResourceNotFoundError(
					"ADMIN_USER_NOT_FOUND",
					"接收人不存在。",
				);
			}
			if (candidate.status !== "active" || candidate.deletedAt) {
				throw new AppError(
					400,
					"ADMIN_NOTIFICATION_RECIPIENT_INACTIVE",
					"只能选择已启用的后台用户作为接收人。",
				);
			}
			if (!candidate.siteAccessId && candidate.groupKey !== "admin") {
				throw new AppError(
					403,
					"ADMIN_NOTIFICATION_RECIPIENT_SITE_ACCESS_REQUIRED",
					"接收人必须拥有当前站点的访问权限。",
				);
			}
		}

		const externalChannelConfigIds = Array.from(
			new Set(events.flatMap((event) => event.externalChannelConfigIds)),
		);
		const configs = await this.channelConfigs.listByIds(
			externalChannelConfigIds,
		);
		const configById = new Map(configs.map((config) => [config.id, config]));
		for (const channelConfigId of externalChannelConfigIds) {
			const config = configById.get(channelConfigId);
			if (!config || config.type === "email") {
				throw new AppError(
					400,
					"ADMIN_NOTIFICATION_CHANNEL_INVALID",
					"选择的其他接收目标不存在或不可用于站点通知。",
				);
			}
		}
		return events;
	}

	public async replaceSiteEvents(
		input: {
			siteId: number;
			events: SiteNotificationEventInput[];
		},
		options?: {
			beforeReplace?: (transaction: SiteNotificationEventsTransaction) => void;
		},
	) {
		const events = await this.validateSiteEvents(input);

		const nowIso = new Date().toISOString();
		this.db.transaction((tx) => {
			options?.beforeReplace?.(tx);
			tx.delete(siteNotificationEventRecipients)
				.where(eq(siteNotificationEventRecipients.siteId, input.siteId))
				.run();
			tx.delete(siteNotificationEventChannels)
				.where(eq(siteNotificationEventChannels.siteId, input.siteId))
				.run();

			const recipientRows = events.flatMap((event) =>
				event.recipientUserIds.map((userId) => ({
					id: createAssignmentId("sner"),
					siteId: input.siteId,
					eventType: event.eventType,
					userId,
					includeCommentContent: "summary",
					createdAt: nowIso,
					updatedAt: nowIso,
				})),
			);
			if (recipientRows.length > 0) {
				tx.insert(siteNotificationEventRecipients).values(recipientRows).run();
			}
			const channelRows = events.flatMap((event) =>
				event.externalChannelConfigIds.map((channelConfigId) => ({
					id: createAssignmentId("snec"),
					siteId: input.siteId,
					eventType: event.eventType,
					channelConfigId,
					createdAt: nowIso,
					updatedAt: nowIso,
				})),
			);
			if (channelRows.length > 0) {
				tx.insert(siteNotificationEventChannels).values(channelRows).run();
			}
		});

		return this.listSiteEvents(input.siteId);
	}

	public async listActiveEmailRecipients(input: {
		siteId: number;
		eventType: SiteBackendNotificationEventType;
	}) {
		return this.db
			.select({
				userId: adminUsers.id,
				username: adminUsers.username,
				email: adminUsers.email,
				displayName: adminUsers.displayName,
				includeCommentContent:
					siteNotificationEventRecipients.includeCommentContent,
			})
			.from(siteNotificationEventRecipients)
			.innerJoin(
				adminUsers,
				eq(adminUsers.id, siteNotificationEventRecipients.userId),
			)
			.innerJoin(adminUserGroups, eq(adminUserGroups.userId, adminUsers.id))
			.innerJoin(adminGroups, eq(adminGroups.id, adminUserGroups.groupId))
			.leftJoin(
				adminUserSiteAccess,
				and(
					eq(adminUserSiteAccess.userId, adminUsers.id),
					eq(adminUserSiteAccess.siteId, input.siteId),
				),
			)
			.where(
				and(
					eq(siteNotificationEventRecipients.siteId, input.siteId),
					eq(siteNotificationEventRecipients.eventType, input.eventType),
					eq(adminUsers.status, "active"),
					isNull(adminUsers.deletedAt),
					or(eq(adminGroups.key, "admin"), isNotNull(adminUserSiteAccess.id)),
				),
			)
			.orderBy(adminUsers.username);
	}

	public async listExternalChannels(input: {
		siteId: number;
		eventType: SiteBackendNotificationEventType;
	}) {
		const rows = await this.db
			.select({
				id: notificationChannelConfigs.id,
			})
			.from(siteNotificationEventChannels)
			.innerJoin(
				notificationChannelConfigs,
				eq(
					notificationChannelConfigs.id,
					siteNotificationEventChannels.channelConfigId,
				),
			)
			.where(
				and(
					eq(siteNotificationEventChannels.siteId, input.siteId),
					eq(siteNotificationEventChannels.eventType, input.eventType),
				),
			);
		return this.channelConfigs.listByIds(rows.map((row) => row.id));
	}
}
