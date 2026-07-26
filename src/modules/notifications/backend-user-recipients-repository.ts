import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	adminUserSiteAccess,
	adminUsers,
	siteNotificationRecipientRoutes,
	siteNotificationRecipients,
} from "../../db/schema";
import {
	type NotificationChannelConfigRecord,
	NotificationChannelConfigsRepository,
	type NotificationChannelType,
} from "./channel-configs-repository";

export type BackendUserNotificationChannel = NotificationChannelType;
export type BackendUserNotificationEventType =
	| "admin_comment_pending"
	| "admin_comment_approved";
export type BackendUserIncludeCommentContent = "none" | "summary" | "full";

export interface SiteNotificationRecipientRouteInput {
	eventType: BackendUserNotificationEventType;
	channelConfigId: string;
	enabled: boolean;
}

export interface SiteNotificationRecipientRouteRecord
	extends SiteNotificationRecipientRouteInput {
	id: string;
	channelType: BackendUserNotificationChannel;
	channelName: string;
	channelConfig: NotificationChannelConfigRecord | null;
}

export interface SiteNotificationRecipientInput {
	userId: number;
	routes?: SiteNotificationRecipientRouteInput[];
	channels?: BackendUserNotificationChannel[];
	events?: BackendUserNotificationEventType[];
	includeCommentContent: BackendUserIncludeCommentContent;
	rateLimitProfile?: string | null;
	enabled: boolean;
}

export interface SiteNotificationRecipientRecord
	extends SiteNotificationRecipientInput {
	id: string;
	siteId: number;
	username: string;
	email: string;
	displayName: string;
	status: string;
	routes: SiteNotificationRecipientRouteRecord[];
	channels: BackendUserNotificationChannel[];
	events: BackendUserNotificationEventType[];
	createdAt: string;
	updatedAt: string;
}

function createRecipientId() {
	return `snr_${randomUUID().replaceAll("-", "")}`;
}

function createRecipientRouteId() {
	return `snrr_${randomUUID().replaceAll("-", "")}`;
}

function uniqueArray<T>(values: T[]): T[] {
	return Array.from(new Set(values));
}

function normalizeRecipientRoutes(
	recipient: SiteNotificationRecipientInput,
): SiteNotificationRecipientRouteInput[] {
	if (recipient.routes) {
		return recipient.routes;
	}
	const channels = recipient.channels ?? ["email"];
	const events = recipient.events ?? ["admin_comment_pending"];
	return events.flatMap((eventType) =>
		channels.map((channel) => ({
			eventType,
			channelConfigId: channel === "email" ? "email:default" : channel,
			enabled: true,
		})),
	);
}

export class BackendUserNotificationRecipientsRepository {
	public constructor(private readonly db: AppDatabase) {
		this.channelConfigs = new NotificationChannelConfigsRepository(db);
	}

	private readonly channelConfigs: NotificationChannelConfigsRepository;

	public async listSiteRecipients(siteId: number) {
		const rows = await this.db
			.select({
				recipient: siteNotificationRecipients,
				user: adminUsers,
			})
			.from(siteNotificationRecipients)
			.innerJoin(
				adminUsers,
				eq(adminUsers.id, siteNotificationRecipients.userId),
			)
			.where(eq(siteNotificationRecipients.siteId, siteId))
			.orderBy(adminUsers.username);
		const recipientIds = rows.map(({ recipient }) => recipient.id);
		const routeRows =
			recipientIds.length === 0
				? []
				: await this.db
						.select()
						.from(siteNotificationRecipientRoutes)
						.where(
							inArray(
								siteNotificationRecipientRoutes.recipientId,
								recipientIds,
							),
						);
		const channelConfigs = await this.channelConfigs.listByIds(
			routeRows.map((route) => route.channelConfigId),
		);
		const configById = new Map(
			channelConfigs.map((config) => [config.id, config]),
		);
		const routesByRecipient = new Map<
			string,
			SiteNotificationRecipientRouteRecord[]
		>();
		for (const route of routeRows) {
			const config = configById.get(route.channelConfigId) ?? null;
			const routes = routesByRecipient.get(route.recipientId) ?? [];
			routes.push({
				id: route.id,
				eventType: route.eventType as BackendUserNotificationEventType,
				channelConfigId: route.channelConfigId,
				enabled: route.enabled,
				channelType:
					config?.type ??
					(route.channelConfigId === "email:default" ? "email" : "webhook"),
				channelName: config?.name ?? route.channelConfigId,
				channelConfig: config,
			});
			routesByRecipient.set(route.recipientId, routes);
		}

		return rows.map(
			({ recipient, user }): SiteNotificationRecipientRecord => ({
				id: recipient.id,
				siteId: recipient.siteId,
				userId: recipient.userId,
				username: user.username,
				email: user.email,
				displayName: user.displayName,
				status: user.status,
				routes: routesByRecipient.get(recipient.id) ?? [],
				channels: uniqueArray(
					(routesByRecipient.get(recipient.id) ?? []).map(
						(route) => route.channelType,
					),
				),
				events: uniqueArray(
					(routesByRecipient.get(recipient.id) ?? []).map(
						(route) => route.eventType,
					),
				),
				includeCommentContent:
					recipient.includeCommentContent as BackendUserIncludeCommentContent,
				rateLimitProfile: recipient.rateLimitProfile,
				enabled: recipient.enabled,
				createdAt: recipient.createdAt,
				updatedAt: recipient.updatedAt,
			}),
		);
	}

	public async replaceSiteRecipients(input: {
		siteId: number;
		recipients: SiteNotificationRecipientInput[];
	}) {
		const nowIso = new Date().toISOString();
		const existingRecipients = await this.db
			.select({ id: siteNotificationRecipients.id })
			.from(siteNotificationRecipients)
			.where(eq(siteNotificationRecipients.siteId, input.siteId));
		if (existingRecipients.length > 0) {
			await this.db.delete(siteNotificationRecipientRoutes).where(
				inArray(
					siteNotificationRecipientRoutes.recipientId,
					existingRecipients.map((recipient) => recipient.id),
				),
			);
		}
		await this.db
			.delete(siteNotificationRecipients)
			.where(eq(siteNotificationRecipients.siteId, input.siteId));
		if (input.recipients.length > 0) {
			const recipientRows = input.recipients.map((recipient) => ({
				id: createRecipientId(),
				input: recipient,
			}));
			await this.db.insert(siteNotificationRecipients).values(
				recipientRows.map(({ id, input: recipient }) => ({
					id,
					siteId: input.siteId,
					userId: recipient.userId,
					channelsJson: JSON.stringify(recipient.channels ?? []),
					eventsJson: JSON.stringify(recipient.events ?? []),
					includeCommentContent: recipient.includeCommentContent,
					rateLimitProfile: recipient.rateLimitProfile ?? null,
					enabled: recipient.enabled,
					createdAt: nowIso,
					updatedAt: nowIso,
				})),
			);
			const routeRows = recipientRows.flatMap(({ id: recipientId, input }) =>
				normalizeRecipientRoutes(input).map((route) => ({
					id: createRecipientRouteId(),
					recipientId,
					eventType: route.eventType,
					channelConfigId: route.channelConfigId,
					enabled: route.enabled,
					createdAt: nowIso,
					updatedAt: nowIso,
				})),
			);
			if (routeRows.length > 0) {
				await this.db.insert(siteNotificationRecipientRoutes).values(routeRows);
			}
		}

		return this.listSiteRecipients(input.siteId);
	}

	public async getUserForRecipientValidation(input: {
		userId: number;
		siteId: number;
	}) {
		const [row] = await this.db
			.select({
				id: adminUsers.id,
				username: adminUsers.username,
				email: adminUsers.email,
				status: adminUsers.status,
				deletedAt: adminUsers.deletedAt,
				siteAccessId: adminUserSiteAccess.id,
			})
			.from(adminUsers)
			.leftJoin(
				adminUserSiteAccess,
				and(
					eq(adminUserSiteAccess.userId, adminUsers.id),
					eq(adminUserSiteAccess.siteId, input.siteId),
				),
			)
			.where(eq(adminUsers.id, input.userId))
			.limit(1);

		return row;
	}

	public async listActiveSiteRecipientUsers(input: {
		siteId: number;
		userIds: number[];
	}) {
		if (input.userIds.length === 0) {
			return [];
		}
		return this.db
			.select({
				id: adminUsers.id,
				username: adminUsers.username,
				email: adminUsers.email,
				displayName: adminUsers.displayName,
			})
			.from(adminUsers)
			.innerJoin(
				adminUserSiteAccess,
				and(
					eq(adminUserSiteAccess.userId, adminUsers.id),
					eq(adminUserSiteAccess.siteId, input.siteId),
				),
			)
			.where(
				and(
					inArray(adminUsers.id, input.userIds),
					eq(adminUsers.status, "active"),
					isNull(adminUsers.deletedAt),
				),
			);
	}
}
