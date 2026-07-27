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
import { CommenterPreferencesRepository } from "./commenter-preferences-repository";
import {
	hashNotificationEmail,
	isAcceptableNotificationEmail,
	normalizeNotificationEmail,
} from "./email-address-policy";
import { EmailReputationRepository } from "./email-reputation-repository";
import type { NotificationRuntimeState } from "./notification-runtime";
import {
	type SiteBackendNotificationEventType,
	SiteNotificationEventsRepository,
} from "./site-notification-events-repository";

export type DiagnosticStatus =
	| "ready"
	| "not_sending"
	| "conditional"
	| "blocked";

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
	if (statuses.includes("ready")) {
		return "ready";
	}
	return "not_sending";
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

export class NotificationDiagnosticsService {
	private readonly systemSettings: RuntimeSystemSettingsService;
	private readonly events: SiteNotificationEventsRepository;
	private readonly preferences: BackendUserNotificationPreferencesRepository;
	private readonly commenterPreferences: CommenterPreferencesRepository;
	private readonly reputation: EmailReputationRepository;

	public constructor(
		private readonly db: AppDatabase,
		private readonly options: DiagnosticsOptions = {},
	) {
		this.systemSettings = new RuntimeSystemSettingsService(db);
		this.events = new SiteNotificationEventsRepository(db);
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
					: flow.status === "not_sending"
						? "not_sending"
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
		eventType: SiteBackendNotificationEventType,
		key: Extract<
			NotificationDiagnosticFlowKey,
			"admin_comment_pending_email" | "admin_comment_approved_email"
		>,
	): Promise<NotificationDiagnosticFlow> {
		const siteEvents = await this.events.listSiteEvents(context.siteId);
		const event = siteEvents.find((item) => item.eventType === eventType);
		const configuredRecipients = event?.recipients ?? [];
		const configuredExternalIds = event?.externalChannelConfigIds ?? [];
		const hasEmailRecipients = configuredRecipients.length > 0;
		if (!context.settings.backendNotificationsEnabled || !hasEmailRecipients) {
			return {
				key,
				status: "not_sending",
				recipients: configuredRecipients.map((recipient) => ({
					userId: recipient.userId,
					displayName: recipient.displayName,
					email: recipient.email,
					status: "not_sending",
					notes: [
						context.settings.backendNotificationsEnabled
							? "当前通知类型没有选择接收人。"
							: "站点人员通知当前已关闭。",
					],
				})),
				blockers: [],
				warnings: [
					issue(
						context.settings.backendNotificationsEnabled
							? "event_has_no_targets"
							: "backend_notifications_disabled",
						context.settings.backendNotificationsEnabled
							? "当前通知类型没有选择接收人，因此不会发送。"
							: "站点人员通知当前已关闭。",
					),
				],
			};
		}

		const common = this.commonBlockers(context);
		const mailBlockerCodes = new Set([
			"system_mail_disabled",
			"smtp_host_missing",
			"smtp_from_missing",
		]);
		const blockers =
			configuredRecipients.length > 0
				? [...common.blockers]
				: common.blockers.filter(
						(blocker) => !mailBlockerCodes.has(blocker.code),
					);
		const warnings = [...common.warnings];
		let conditional = common.warnings.length > 0;
		const activeUsers = await this.events.listActiveEmailRecipients({
			siteId: context.siteId,
			eventType,
		});
		const activeUserIds = new Set(activeUsers.map((user) => user.userId));
		const recipients: NotificationDiagnosticRecipient[] = [];

		for (const recipient of configuredRecipients) {
			const recipientBlockers: NotificationDiagnosticIssue[] = [];
			const recipientWarnings: NotificationDiagnosticIssue[] = [];
			if (!activeUserIds.has(recipient.userId)) {
				recipientBlockers.push(
					issue(
						recipient.status !== "active"
							? "event_email_recipient_inactive"
							: "event_email_recipient_site_access_missing",
						recipient.status !== "active"
							? "选择的接收人当前不可用。"
							: "选择的接收人已无当前站点的访问权限。",
					),
				);
			}

			const preference = await this.preferences.getPreference({
				userId: recipient.userId,
				channel: "email",
				channelConfigRef: "email:default",
			});
			const paused =
				preference.pausedUntil &&
				preference.pausedUntil >
					(this.options.now?.() ?? new Date()).toISOString();
			if (!preference.enabled) {
				recipientWarnings.push(
					issue(
						"recipient_email_preference_disabled",
						"接收人关闭了自己的邮件通知，因此暂时不会收到这类邮件。",
					),
				);
			} else if (paused) {
				recipientWarnings.push(
					issue(
						"recipient_email_preference_paused",
						"接收人的邮件通知当前处于暂停期。",
					),
				);
			} else if (preference.digestMode !== "off") {
				recipientWarnings.push(
					issue(
						"recipient_email_digest_delayed",
						"接收人启用了摘要模式，邮件不会立即发送。",
					),
				);
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

		const availableExternalIds = new Set(
			(event?.externalChannels ?? [])
				.filter((config) => config.enabled)
				.map((config) => config.id),
		);
		for (const channelConfigId of configuredExternalIds) {
			if (!availableExternalIds.has(channelConfigId)) {
				warnings.push(
					issue(
						"event_external_target_unavailable",
						"选择的其他接收目标当前不可用，请重新选择或到系统设置中启用它。",
					),
				);
				conditional = true;
			}
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
