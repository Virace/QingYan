import { and, desc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import {
	notificationDeliveries,
	siteSettings,
	sites,
	taskRuns,
} from "../../db/schema";
import { ResourceNotFoundError } from "../shared/errors";
import { RuntimeSystemSettingsService } from "../system-settings/service";
import { BackendUserNotificationPreferencesRepository } from "./backend-user-preferences-repository";
import {
	type BackendUserNotificationEventType,
	BackendUserNotificationRecipientsRepository,
} from "./backend-user-recipients-repository";
import { CommenterPreferencesRepository } from "./commenter-preferences-repository";
import {
	hashNotificationEmail,
	isAcceptableNotificationEmail,
	normalizeNotificationEmail,
} from "./email-address-policy";
import { EmailReputationRepository } from "./email-reputation-repository";
import type { NotificationRuntimeState } from "./notification-runtime";

export type DiagnosticStatus = "ready" | "conditional" | "blocked";

export type NotificationDiagnosticFlowKey =
	| "admin_comment_pending_email"
	| "admin_comment_approved_email"
	| "commenter_reply_email";

export interface NotificationDiagnosticIssue {
	code: string;
	path?: string;
	message: string;
}

export interface NotificationDiagnosticRecipient {
	userId?: number;
	displayName?: string;
	email: string;
	status: DiagnosticStatus;
	notes: string[];
}

export interface NotificationDiagnosticFlow {
	key: NotificationDiagnosticFlowKey;
	status: DiagnosticStatus;
	recipients: NotificationDiagnosticRecipient[];
	blockers: NotificationDiagnosticIssue[];
	warnings: NotificationDiagnosticIssue[];
}

export interface NotificationDiagnostic {
	generatedAt: string;
	overall: DiagnosticStatus;
	savedConfigOnly: true;
	runtime: {
		notificationWorker: DiagnosticStatus;
		queueBackend: string;
		lastTickAt: string | null;
	};
	flows: NotificationDiagnosticFlow[];
}

type DiagnosticsOptions = {
	notificationRuntimeState?: () => NotificationRuntimeState;
	now?: () => Date;
};

type SiteDiagnosticContext = {
	siteId: number;
	settings: {
		commentsEnabled: boolean;
		maxDepth: number;
		commenterReplyEmailEnabled: boolean;
		commenterReplyEmailDefaultChecked: boolean;
		backendNotificationsEnabled: boolean;
	};
	systemSettings: Awaited<
		ReturnType<RuntimeSystemSettingsService["getSettings"]>
	>;
	runtimeState: NotificationRuntimeState;
};

type FlowEvidence = {
	warnings: NotificationDiagnosticIssue[];
	conditional: boolean;
};

type RecentEvidence = Record<NotificationDiagnosticFlowKey, FlowEvidence>;

const diagnosticFlowKeys: NotificationDiagnosticFlowKey[] = [
	"admin_comment_pending_email",
	"admin_comment_approved_email",
	"commenter_reply_email",
];

const stoppedRuntimeState = (): NotificationRuntimeState => ({
	started: false,
	running: false,
	lastTickAt: null,
	lastError: null,
});

function issue(
	code: string,
	message: string,
	path?: string,
): NotificationDiagnosticIssue {
	return {
		code,
		...(path ? { path } : {}),
		message,
	};
}

function aggregateStatuses(statuses: DiagnosticStatus[]): DiagnosticStatus {
	if (statuses.includes("blocked")) {
		return "blocked";
	}
	if (statuses.includes("conditional")) {
		return "conditional";
	}
	return "ready";
}

function statusFor(
	blockers: NotificationDiagnosticIssue[],
	conditional: boolean,
): DiagnosticStatus {
	if (blockers.length > 0) {
		return "blocked";
	}
	return conditional ? "conditional" : "ready";
}

function recipientPath(userId: number): string {
	return `notifications.backend.recipients[userId=${userId}]`;
}

function eventRoutePath(
	userId: number,
	eventType: BackendUserNotificationEventType,
): string {
	return `${recipientPath(userId)}.routes[eventType=${eventType}]`;
}

export class NotificationDiagnosticsService {
	private readonly systemSettings: RuntimeSystemSettingsService;
	private readonly recipients: BackendUserNotificationRecipientsRepository;
	private readonly preferences: BackendUserNotificationPreferencesRepository;
	private readonly commenterPreferences: CommenterPreferencesRepository;
	private readonly reputation: EmailReputationRepository;

	public constructor(
		private readonly db: AppDatabase,
		private readonly options: DiagnosticsOptions = {},
	) {
		this.systemSettings = new RuntimeSystemSettingsService(db);
		this.recipients = new BackendUserNotificationRecipientsRepository(db);
		this.preferences = new BackendUserNotificationPreferencesRepository(db);
		this.commenterPreferences = new CommenterPreferencesRepository(db);
		this.reputation = new EmailReputationRepository(db);
	}

	public async diagnose(siteKey: string): Promise<NotificationDiagnostic> {
		return this.diagnoseInternal(siteKey);
	}

	public async diagnoseCommenterEmail(
		siteKey: string,
		email: string,
	): Promise<NotificationDiagnostic> {
		return this.diagnoseInternal(siteKey, email);
	}

	private async diagnoseInternal(
		siteKey: string,
		commenterEmail?: string,
	): Promise<NotificationDiagnostic> {
		const context = await this.loadContext(siteKey);
		const runtime = this.buildRuntimeDiagnostics(context);
		const baseFlows = [
			await this.diagnoseAdminFlow(
				context,
				"admin_comment_pending",
				"admin_comment_pending_email",
			),
			await this.diagnoseAdminFlow(
				context,
				"admin_comment_approved",
				"admin_comment_approved_email",
			),
			await this.diagnoseCommenterFlow(context, commenterEmail),
		];
		const recentEvidence = await this.loadRecentEvidence(context.siteId);
		const flows = baseFlows.map((flow) =>
			this.applyRecentEvidence(flow, recentEvidence[flow.key]),
		);

		return {
			generatedAt: (this.options.now?.() ?? new Date()).toISOString(),
			overall: aggregateStatuses(flows.map((flow) => flow.status)),
			savedConfigOnly: true,
			runtime: {
				notificationWorker: runtime.workerStatus,
				queueBackend:
					context.systemSettings.notifications.delivery.queueBackend,
				lastTickAt: context.runtimeState.lastTickAt,
			},
			flows,
		};
	}

	private async loadRecentEvidence(siteId: number): Promise<RecentEvidence> {
		const evidence: RecentEvidence = {
			admin_comment_pending_email: { warnings: [], conditional: false },
			admin_comment_approved_email: { warnings: [], conditional: false },
			commenter_reply_email: { warnings: [], conditional: false },
		};
		const recentDeliveries = await this.db
			.select({
				taskType: taskRuns.type,
				eventFamily: notificationDeliveries.eventFamily,
				templateKey: notificationDeliveries.templateKey,
				status: notificationDeliveries.status,
				updatedAt: notificationDeliveries.updatedAt,
			})
			.from(notificationDeliveries)
			.innerJoin(taskRuns, eq(taskRuns.id, notificationDeliveries.taskRunId))
			.where(
				and(
					eq(taskRuns.siteId, siteId),
					eq(notificationDeliveries.channel, "email"),
					inArray(notificationDeliveries.status, [
						"sent",
						"failed",
						"suppressed",
					]),
				),
			)
			.orderBy(desc(notificationDeliveries.updatedAt))
			.limit(20);

		const seenFlows = new Set<NotificationDiagnosticFlowKey>();
		for (const delivery of recentDeliveries) {
			const key = this.flowKeyForDelivery(delivery);
			if (!key || seenFlows.has(key)) {
				continue;
			}
			seenFlows.add(key);
			const failed =
				delivery.status === "failed" || delivery.status === "suppressed";
			evidence[key].warnings.push(
				failed
					? issue(
							"recent_email_delivery_failed",
							`最近一次相关邮件投递在 ${delivery.updatedAt} 未成功。`,
						)
					: issue(
							"recent_email_delivery_sent",
							`最近一次相关邮件投递在 ${delivery.updatedAt} 已被服务商接受。`,
						),
			);
			if (failed) {
				evidence[key].conditional = true;
			}
		}

		const [chainTest] = await this.db
			.select({
				status: taskRuns.status,
				updatedAt: taskRuns.updatedAt,
			})
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.siteId, siteId),
					eq(taskRuns.type, "notification_chain_test"),
				),
			)
			.orderBy(desc(taskRuns.updatedAt))
			.limit(1);
		if (chainTest?.status === "failed") {
			for (const key of diagnosticFlowKeys) {
				evidence[key].warnings.push(
					issue(
						"recent_chain_test_failed",
						`最近一次评论邮件链路测试在 ${chainTest.updatedAt} 失败。`,
					),
				);
				evidence[key].conditional = true;
			}
		} else if (
			chainTest?.status === "succeeded" ||
			chainTest?.status === "passed"
		) {
			for (const key of diagnosticFlowKeys) {
				evidence[key].warnings.push(
					issue(
						"recent_chain_test_passed",
						`最近一次评论邮件链路测试在 ${chainTest.updatedAt} 通过。`,
					),
				);
			}
		}

		return evidence;
	}

	private flowKeyForDelivery(input: {
		taskType: string;
		eventFamily: string;
		templateKey: string;
	}): NotificationDiagnosticFlowKey | null {
		if (
			input.taskType === "backend_user_comment_pending" ||
			input.eventFamily === "admin_comment_pending" ||
			input.templateKey === "backend_user.comment.pending"
		) {
			return "admin_comment_pending_email";
		}
		if (
			input.taskType === "backend_user_comment_approved" ||
			input.eventFamily === "admin_comment_approved" ||
			input.templateKey === "backend_user.comment.approved"
		) {
			return "admin_comment_approved_email";
		}
		if (
			input.taskType === "commenter_reply" ||
			input.eventFamily === "commenter_reply" ||
			input.templateKey === "commenter.reply_approved"
		) {
			return "commenter_reply_email";
		}
		return null;
	}

	private applyRecentEvidence(
		flow: NotificationDiagnosticFlow,
		evidence: FlowEvidence,
	): NotificationDiagnosticFlow {
		return {
			...flow,
			status:
				flow.status === "blocked"
					? "blocked"
					: flow.status === "conditional" || evidence.conditional
						? "conditional"
						: "ready",
			warnings: [...flow.warnings, ...evidence.warnings],
		};
	}

	private async loadContext(siteKey: string): Promise<SiteDiagnosticContext> {
		const [row] = await this.db
			.select({
				siteId: sites.id,
				commentsEnabled: siteSettings.commentsEnabled,
				maxDepth: siteSettings.maxDepth,
				commenterReplyEmailEnabled: siteSettings.commenterReplyEmailEnabled,
				commenterReplyEmailDefaultChecked:
					siteSettings.commenterReplyEmailDefaultChecked,
				backendNotificationsEnabled: siteSettings.backendNotificationsEnabled,
			})
			.from(sites)
			.innerJoin(siteSettings, eq(siteSettings.siteId, sites.id))
			.where(eq(sites.siteKey, siteKey))
			.limit(1);
		if (!row) {
			throw new ResourceNotFoundError("SITE_NOT_FOUND", "站点不存在。");
		}

		return {
			siteId: row.siteId,
			settings: {
				commentsEnabled: row.commentsEnabled,
				maxDepth: row.maxDepth,
				commenterReplyEmailEnabled: row.commenterReplyEmailEnabled,
				commenterReplyEmailDefaultChecked:
					row.commenterReplyEmailDefaultChecked,
				backendNotificationsEnabled: row.backendNotificationsEnabled,
			},
			systemSettings: await this.systemSettings.getSettings(),
			runtimeState:
				this.options.notificationRuntimeState?.() ?? stoppedRuntimeState(),
		};
	}

	private commonBlockers(context: SiteDiagnosticContext) {
		const blockers: NotificationDiagnosticIssue[] = [];
		const warnings: NotificationDiagnosticIssue[] = [];
		const { mail, notifications } = context.systemSettings;

		if (!mail.enabled) {
			blockers.push(
				issue("system_mail_disabled", "系统邮件总开关未启用。", "mail.enabled"),
			);
		}
		if (!mail.smtp.host.trim()) {
			blockers.push(
				issue("smtp_host_missing", "SMTP 主机尚未配置。", "mail.smtp.host"),
			);
		}
		if (!mail.smtp.from.trim()) {
			blockers.push(
				issue("smtp_from_missing", "SMTP 发件人尚未配置。", "mail.smtp.from"),
			);
		}
		if (notifications.delivery.queueBackend !== "database") {
			blockers.push(
				issue(
					"queue_backend_unavailable",
					`当前运行时不支持队列后端 ${notifications.delivery.queueBackend}。`,
					"notifications.delivery.queueBackend",
				),
			);
		}
		if (!context.runtimeState.started) {
			blockers.push(
				issue(
					"notification_worker_not_started",
					"专用通知 worker 尚未启动。",
					"runtime.notificationWorker",
				),
			);
		} else if (!context.runtimeState.lastTickAt) {
			blockers.push(
				issue(
					"notification_worker_no_tick",
					"专用通知 worker 尚无执行 tick 证据。",
					"runtime.notificationWorker",
				),
			);
		}
		if (context.runtimeState.lastError) {
			warnings.push(
				issue(
					"notification_worker_last_error",
					"专用通知 worker 最近一次执行记录了错误。",
					"runtime.notificationWorker",
				),
			);
		}

		return { blockers, warnings };
	}

	private buildRuntimeDiagnostics(context: SiteDiagnosticContext) {
		const { blockers, warnings } = this.commonBlockers(context);
		const workerBlockerCodes = new Set([
			"notification_worker_not_started",
			"notification_worker_no_tick",
		]);
		const workerBlocked = blockers.some((blocker) =>
			workerBlockerCodes.has(blocker.code),
		);
		const workerConditional = warnings.some(
			(warning) => warning.code === "notification_worker_last_error",
		);
		return {
			workerStatus: workerBlocked
				? ("blocked" as const)
				: workerConditional
					? ("conditional" as const)
					: ("ready" as const),
		};
	}

	private async diagnoseAdminFlow(
		context: SiteDiagnosticContext,
		eventType: BackendUserNotificationEventType,
		key: Extract<
			NotificationDiagnosticFlowKey,
			"admin_comment_pending_email" | "admin_comment_approved_email"
		>,
	): Promise<NotificationDiagnosticFlow> {
		const common = this.commonBlockers(context);
		const blockers = [...common.blockers];
		const warnings = [...common.warnings];
		let conditional = common.warnings.length > 0;

		if (!context.settings.backendNotificationsEnabled) {
			blockers.push(
				issue(
					"backend_notifications_disabled",
					"站点后台用户通知总开关未启用。",
					"notifications.backend.enabled",
				),
			);
		}

		const configuredRecipients = await this.recipients.listSiteRecipients(
			context.siteId,
		);
		const enabledRecipients = configuredRecipients.filter(
			(recipient) => recipient.enabled,
		);
		if (enabledRecipients.length === 0) {
			blockers.push(
				issue(
					"no_enabled_backend_recipient",
					"站点没有已启用的后台通知接收人。",
					"notifications.backend.recipients",
				),
			);
		}

		const activeUsers = await this.recipients.listActiveSiteRecipientUsers({
			siteId: context.siteId,
			userIds: enabledRecipients.map((recipient) => recipient.userId),
		});
		const activeUserIds = new Set(activeUsers.map((user) => user.id));
		const recipients: NotificationDiagnosticRecipient[] = [];

		for (const recipient of configuredRecipients) {
			const recipientBlockers: NotificationDiagnosticIssue[] = [];
			const recipientWarnings: NotificationDiagnosticIssue[] = [];
			if (!recipient.enabled) {
				recipients.push({
					userId: recipient.userId,
					displayName: recipient.displayName,
					email: recipient.email,
					status: "blocked",
					notes: ["该接收人已停用。"],
				});
				continue;
			}

			if (!activeUserIds.has(recipient.userId)) {
				const inactive =
					recipient.status !== "active"
						? issue(
								"recipient_user_inactive",
								`接收人 ${recipient.displayName || recipient.username} 不是启用状态。`,
								recipientPath(recipient.userId),
							)
						: issue(
								"recipient_site_access_missing",
								`接收人 ${recipient.displayName || recipient.username} 已无站点访问权。`,
								recipientPath(recipient.userId),
							);
				recipientBlockers.push(inactive);
			}

			const eventRoutes = recipient.routes.filter(
				(route) => route.eventType === eventType,
			);
			const emailRoutes = eventRoutes.filter(
				(route) => route.channelConfig?.type === "email",
			);
			if (emailRoutes.length === 0) {
				recipientBlockers.push(
					issue(
						"email_event_route_missing",
						`接收人缺少 ${eventType} 的邮件 route。`,
						eventRoutePath(recipient.userId, eventType),
					),
				);
			} else {
				let usableRouteFound = false;
				const routeFailures: NotificationDiagnosticIssue[] = [];
				for (const route of emailRoutes) {
					if (!route.enabled) {
						routeFailures.push(
							issue(
								"email_event_route_disabled",
								`接收人的 ${eventType} 邮件 route 已停用。`,
								eventRoutePath(recipient.userId, eventType),
							),
						);
						continue;
					}
					if (!route.channelConfig) {
						routeFailures.push(
							issue(
								"email_channel_config_missing",
								"邮件 route 引用的通道配置不存在。",
								eventRoutePath(recipient.userId, eventType),
							),
						);
						continue;
					}
					if (!route.channelConfig.enabled) {
						routeFailures.push(
							issue(
								"email_channel_config_disabled",
								`邮件通道 ${route.channelName} 已停用。`,
								"notifications.channelConfigs.enabled",
							),
						);
						continue;
					}

					const preference = await this.preferences.getPreference({
						userId: recipient.userId,
						channel: "email",
						channelConfigRef: route.channelConfigId,
					});
					const paused =
						preference.pausedUntil &&
						preference.pausedUntil >
							(this.options.now?.() ?? new Date()).toISOString();
					if (!preference.enabled) {
						routeFailures.push(
							issue(
								"recipient_email_preference_disabled",
								"接收人的个人邮件通知偏好已关闭。",
								recipientPath(recipient.userId),
							),
						);
						continue;
					}
					if (paused) {
						routeFailures.push(
							issue(
								"recipient_email_preference_paused",
								"接收人的个人邮件通知当前处于暂停期。",
								recipientPath(recipient.userId),
							),
						);
						continue;
					}
					usableRouteFound = true;
					if (preference.digestMode !== "off") {
						recipientWarnings.push(
							issue(
								"recipient_email_digest_delayed",
								"接收人启用了摘要模式，邮件不会立即发送。",
								recipientPath(recipient.userId),
							),
						);
					}
				}
				if (!usableRouteFound) {
					recipientBlockers.push(...routeFailures);
				}
			}

			blockers.push(...recipientBlockers);
			warnings.push(...recipientWarnings);
			if (recipientWarnings.length > 0) {
				conditional = true;
			}
			recipients.push({
				userId: recipient.userId,
				displayName: recipient.displayName,
				email: recipient.email,
				status: statusFor(recipientBlockers, recipientWarnings.length > 0),
				notes: [...recipientBlockers, ...recipientWarnings].map(
					(item) => item.message,
				),
			});
		}

		return {
			key,
			status: statusFor(blockers, conditional),
			recipients,
			blockers,
			warnings,
		};
	}

	private async diagnoseCommenterFlow(
		context: SiteDiagnosticContext,
		commenterEmail?: string,
	): Promise<NotificationDiagnosticFlow> {
		const common = this.commonBlockers(context);
		const blockers = [...common.blockers];
		const warnings = [...common.warnings];
		let conditional = common.warnings.length > 0;

		if (!context.settings.commentsEnabled) {
			blockers.push(
				issue("comments_disabled", "站点评论功能未启用。", "comments.enabled"),
			);
		}
		if (context.settings.maxDepth <= 1) {
			blockers.push(
				issue(
					"comment_replies_disabled",
					"评论最大层级不允许回复。",
					"comments.maxDepth",
				),
			);
		}
		if (!context.settings.commenterReplyEmailEnabled) {
			blockers.push(
				issue(
					"commenter_reply_email_disabled",
					"评论者回复邮件能力未启用。",
					"notifications.commenter.replyEmailEnabled",
				),
			);
		}
		if (!context.settings.commenterReplyEmailDefaultChecked) {
			warnings.push(
				issue(
					"reply_email_default_unchecked",
					"公开评论框默认不勾选回复提醒；这不会阻止主动订阅。",
					"notifications.commenter.replyEmailDefaultChecked",
				),
			);
		}

		const recipients: NotificationDiagnosticRecipient[] = [];
		if (commenterEmail === undefined) {
			conditional = true;
			warnings.push(
				issue("commenter_email_required", "实际投递需要评论者提供有效邮箱。"),
				issue(
					"commenter_opt_in_required",
					"实际投递需要评论者显式订阅回复提醒。",
				),
				issue(
					"commenter_unsubscribe_check_required",
					"实际投递前需要检查评论者是否已经退订。",
				),
				issue(
					"commenter_reputation_check_required",
					"实际投递前需要检查邮箱是否处于 suppression。",
				),
				issue(
					"reply_actor_identity_check_required",
					"回复作者邮箱必须与原评论者不同。",
				),
			);
		} else {
			const email = normalizeNotificationEmail(commenterEmail);
			const recipientBlockers: NotificationDiagnosticIssue[] = [];
			const recipientWarnings: NotificationDiagnosticIssue[] = [];
			if (!isAcceptableNotificationEmail(email)) {
				recipientBlockers.push(
					issue(
						"commenter_email_invalid",
						"评论者邮箱不符合通知邮箱策略。",
						"commenterEmail",
					),
				);
			} else {
				const emailHash = hashNotificationEmail(email);
				const preference = emailHash
					? await this.commenterPreferences.getByEmailHash(
							context.siteId,
							emailHash,
						)
					: null;
				if (preference?.unsubscribedAt) {
					recipientBlockers.push(
						issue(
							"commenter_unsubscribed",
							"该评论者已明确退订回复邮件。",
							"commenterEmail",
						),
					);
				} else if (!preference?.notifyOnReply) {
					recipientWarnings.push(
						issue(
							"commenter_opt_in_required",
							"该邮箱尚未显式订阅回复提醒。",
							"commenterEmail",
						),
					);
				}
				if (
					await this.reputation.isSuppressed({
						siteId: context.siteId,
						email,
						nowIso: (this.options.now?.() ?? new Date()).toISOString(),
					})
				) {
					recipientBlockers.push(
						issue(
							"commenter_email_suppressed",
							"该邮箱当前处于投递 suppression。",
							"commenterEmail",
						),
					);
				}
				recipientWarnings.push(
					issue(
						"reply_actor_identity_check_required",
						"实际回复作者邮箱仍需与原评论者不同。",
					),
				);
			}

			blockers.push(...recipientBlockers);
			warnings.push(...recipientWarnings);
			conditional = true;
			recipients.push({
				email,
				status: statusFor(recipientBlockers, true),
				notes: [...recipientBlockers, ...recipientWarnings].map(
					(item) => item.message,
				),
			});
		}

		return {
			key: "commenter_reply_email",
			status: statusFor(blockers, conditional),
			recipients,
			blockers,
			warnings,
		};
	}
}
