import type { AppLogRecord } from "../../logging/types";
import type { TaskRunRepository } from "../tasks/task-run-repository";
import type {
	NotificationDeliveryRecord,
	TaskQueue,
	TaskRunRecord,
} from "../tasks/types";
import {
	classifyChannelError,
	NotificationChannelError,
} from "./channels/error-classifier";
import type { NotificationChannelAdapter } from "./channels/types";
import {
	NotificationTemplateError,
	renderNotificationTemplate,
} from "./templates/renderer";
import type { NotificationTemplateResolver } from "./templates/resolver";
import type { CommentNotificationIntent } from "./comment-notification-intent";

type ReputationRecorder = {
	recordRecipientFailure(input: {
		siteId?: number | null;
		email: string;
		reason: string;
		nowIso?: string;
	}): Promise<unknown> | unknown;
	recordSuccess?(input: {
		siteId?: number | null;
		email: string;
		nowIso?: string;
	}): Promise<unknown> | unknown;
};

type NotificationWorkerInput = {
	queue: TaskQueue;
	repository: TaskRunRepository;
	adapters?: Record<string, NotificationChannelAdapter | undefined>;
	adapterFactory?: {
		resolve(
			delivery: NotificationDeliveryRecord,
		): Promise<NotificationChannelAdapter | undefined>;
	};
	reputation?: ReputationRecorder;
	retryDelaySec?: number;
	templateContextBuilder?: {
		build(input: {
			task: TaskRunRecord;
			delivery: NotificationDeliveryRecord;
		}): Promise<Record<string, unknown>>;
		buildTransient?(input: {
			task: TaskRunRecord;
			delivery: NotificationDeliveryRecord;
		}): Promise<Record<string, unknown>>;
	};
	templates?: NotificationTemplateResolver;
	loadEmailFormat?: () => Promise<"html" | "text">;
	planCommentNotification?: (
		input: CommentNotificationIntent,
	) => Promise<unknown>;
	logApp?: (record: AppLogRecord) => Promise<void>;
};

type PreparedTemplate = {
	subjectTemplate?: string | null;
	bodyTemplate: string;
	format: "html" | "text" | "json";
	context: Record<string, unknown>;
};

type TemplatePayload = {
	templateContext?: Record<string, unknown>;
	subjectTemplate?: string;
	bodyTemplate?: string;
	format?: "html" | "text" | "json";
	preparedDeliveries?: Record<string, PreparedTemplate>;
};

function asTemplatePayload(payload: unknown): TemplatePayload {
	return payload && typeof payload === "object"
		? (payload as TemplatePayload)
		: {};
}

function renderPreparedTemplate(
	prepared: PreparedTemplate,
	transient: Record<string, unknown>,
) {
	return renderNotificationTemplate({
		...prepared,
		context: {
			...prepared.context,
			links: {
				...((prepared.context.links as Record<string, unknown>) ?? {}),
				...transient,
			},
		},
	});
}

function fallbackBody(delivery: NotificationDeliveryRecord): string {
	if (delivery.templateKey === "channel_test") {
		return "这是一条 QingYan 通知通道测试消息。";
	}
	if (delivery.templateKey === "commenter.reply_approved") {
		return "{{comment.authorLabel}} 在 {{page.title}} 回复了你：\n{{comment.content}}\n\n查看页面：{{page.url}}\n\n如需退订可点击：{{links.unsubscribe}}";
	}
	return "{{comment.content}}";
}

export class NotificationWorker {
	public constructor(private readonly input: NotificationWorkerInput) {}

	public async runNextNotificationTask(options: { limit: number; now?: Date }) {
		const now = options.now ?? new Date();
		const nowIso = now.toISOString();
		const tasks = await this.input.queue.claim("notification-worker", {
			limit: options.limit,
			nowIso,
			includeCategories: ["notification"],
		});
		let processed = 0;
		let plannedIntent = false;

		for (const task of tasks) {
			processed += 1;
			if (task.type === "comment_notification_intent") {
				await this.processIntent(task, now);
				plannedIntent = true;
				continue;
			}
			const deliveries = await this.input.repository.listDeliveriesForTask(
				task.id,
			);
			const taskSummary = asTemplatePayload(task.payloadSummary) as Record<
				string,
				unknown
			>;
			const isEmailTask =
				deliveries.length > 0
					? deliveries.every((delivery) => delivery.channel === "email")
					: taskSummary.channel === "email";
			const taskEventPrefix = isEmailTask
				? "notification.email"
				: "notification.delivery";
			let sent = 0;
			let failed = 0;
			let temporaryError: unknown = null;
			let terminalError: unknown = null;
			let applied = false;
			const attemptNumber = task.attempts + 1;
			const outcomes: Parameters<
				TaskRunRepository["completeNotificationAttempt"]
			>[0]["outcomes"] = [];
			const events: Parameters<
				TaskRunRepository["completeNotificationAttempt"]
			>[0]["events"] = [];
			const reputationUpdates: Array<() => Promise<unknown> | unknown> = [];

			for (const delivery of deliveries) {
				if (!(await this.input.repository.ownsClaim(task.id, task.claimToken)))
					break;
				if (delivery.status === "sent" && delivery.sentAt) {
					sent += 1;
					continue;
				}
				const deliveryEventPrefix =
					delivery.channel === "email"
						? "notification.email"
						: "notification.delivery";
				events.push({
					eventType: `${deliveryEventPrefix}.attempt_started`,
					level: "info",
					message: `开始第 ${attemptNumber} 次投递。`,
					data: {
						attempt: attemptNumber,
						maxAttempts: task.maxAttempts,
						channel: delivery.channel,
					},
				});
				try {
					const adapter = this.input.adapterFactory
						? await this.input.adapterFactory.resolve(delivery)
						: this.input.adapters?.[delivery.channel];
					if (!adapter) {
						throw new NotificationChannelError(
							"config",
							`Notification channel is not configured: ${delivery.channel}`,
						);
					}
					const payload = asTemplatePayload(task.payload);
					let prepared = payload.preparedDeliveries?.[delivery.id];
					let transient: Record<string, unknown> = {};
					let initialRendered:
						| ReturnType<typeof renderNotificationTemplate>
						| undefined;
					if (!prepared) {
						const selectedFormat =
							payload.format ??
							(delivery.channel === "email"
								? await this.input.loadEmailFormat?.()
								: undefined);
						const template =
							!payload.bodyTemplate && this.input.templates
								? await this.input.templates.resolve(delivery, selectedFormat)
								: undefined;
						const format = template?.format ?? selectedFormat ?? "text";
						const context = payload.templateContext ??
							(await this.input.templateContextBuilder?.build({
								task,
								delivery,
							})) ?? { comment: { content: "QingYan notification" } };
						const savedContext = structuredClone(context);
						if (
							savedContext.links &&
							typeof savedContext.links === "object" &&
							"unsubscribe" in savedContext.links
						) {
							transient = { unsubscribe: savedContext.links.unsubscribe };
							delete savedContext.links.unsubscribe;
						}
						prepared = {
							format,
							subjectTemplate:
								payload.subjectTemplate ??
								template?.subjectTemplate ??
								"[QingYan] Notification",
							bodyTemplate:
								payload.bodyTemplate ??
								template?.bodyTemplate ??
								fallbackBody(delivery),
							context: savedContext,
						};
						initialRendered = renderPreparedTemplate(prepared, transient);
						payload.preparedDeliveries = {
							...payload.preparedDeliveries,
							[delivery.id]: prepared,
						};
						if (
							!(await this.input.repository.saveNotificationPayload(
								task.id,
								task.claimToken,
								{ ...(task.payload as Record<string, unknown>), ...payload },
							))
						)
							break;
						task.payload = {
							...(task.payload as Record<string, unknown>),
							...payload,
						};
					} else {
						transient =
							(await this.input.templateContextBuilder?.buildTransient?.({
								task,
								delivery,
							})) ?? {};
					}
					const rendered =
						initialRendered ?? renderPreparedTemplate(prepared, transient);
					const result = await adapter.send({
						to: delivery.recipientAddressSnapshot,
						subject: rendered.subject,
						body: rendered.body,
						format: prepared.format,
					});
					outcomes.push({
						deliveryId: delivery.id,
						status: "sent",
						providerMessageId: result.providerMessageId,
						sentAt: nowIso,
					});
					if (delivery.recipientType === "commenter") {
						reputationUpdates.push(() =>
							this.input.reputation?.recordSuccess?.({
								siteId: task.siteId,
								email: delivery.recipientAddressSnapshot,
								nowIso,
							}),
						);
					}
					events.push({
						eventType: `${deliveryEventPrefix}.accepted`,
						level: "info",
						message:
							delivery.channel === "email"
								? "邮件服务商已接受发送请求。"
								: "通知服务已接受投递请求。",
						data: { attempt: attemptNumber, channel: delivery.channel },
					});
					sent += 1;
				} catch (error) {
					const channelError =
						error instanceof NotificationTemplateError
							? new NotificationChannelError("template", error.message)
							: error;
					const classified = classifyChannelError(channelError);
					outcomes.push({
						deliveryId: delivery.id,
						status: "failed",
						error: classified,
					});
					if (
						classified.affectsRecipientReputation &&
						delivery.recipientType === "commenter"
					) {
						reputationUpdates.push(() =>
							this.input.reputation?.recordRecipientFailure({
								siteId: task.siteId,
								email: delivery.recipientAddressSnapshot,
								reason: classified.message,
								nowIso,
							}),
						);
					}
					if (classified.terminal) {
						terminalError = classified;
					} else {
						temporaryError = classified;
					}
					events.push({
						eventType: `${deliveryEventPrefix}.attempt_failed`,
						level: classified.terminal ? "error" : "warn",
						message: classified.terminal
							? `${delivery.channel === "email" ? "邮件" : "通知"}投递终止失败。`
							: `${delivery.channel === "email" ? "邮件" : "通知"}发送暂时失败。`,
						data: {
							attempt: attemptNumber,
							errorKind: classified.kind,
							channel: delivery.channel,
						},
					});
					failed += 1;
				}
			}

			if (deliveries.length === 0) {
				terminalError = {
					kind: "config",
					message: "Notification task has no delivery.",
					terminal: true,
					affectsRecipientReputation: false,
				};
				failed = 1;
				events.push({
					eventType: `${taskEventPrefix}.delivery_missing`,
					level: "error",
					message: "通知任务没有生成实际邮件投递。",
					data: { errorKind: "config" },
				});
			}

			if (
				!terminalError &&
				temporaryError &&
				task.attempts + 1 < task.maxAttempts
			) {
				const runAfter = new Date(
					now.getTime() + (this.input.retryDelaySec ?? 300) * 1000,
				).toISOString();
				events.push({
					eventType: `${taskEventPrefix}.retry_scheduled`,
					level: "warn",
					message: `已安排第 ${attemptNumber + 1} 次重试。`,
					data: {
						nextAttempt: attemptNumber + 1,
						maxAttempts: task.maxAttempts,
						runAfter,
					},
				});
				const completed =
					await this.input.repository.completeNotificationAttempt({
						taskId: task.id,
						claimToken: task.claimToken,
						outcomes,
						next: { status: "retrying", error: temporaryError, runAfter },
						events,
						updatedAt: nowIso,
					});
				applied = completed.applied;
				if (applied && isEmailTask) {
					await this.writeApplicationLog(task, {
						event: "notification.email.retry_scheduled",
						level: "warn",
						message: "邮件发送暂时失败，系统已安排重试。",
						data: {
							attempt: attemptNumber,
							maxAttempts: task.maxAttempts,
							sentCount: sent,
							failedCount: failed,
						},
					});
				}
			} else if (failed > 0) {
				events.push({
					eventType: `${taskEventPrefix}.failed`,
					level: "error",
					message: `${isEmailTask ? "邮件" : "通知"}投递已终止失败。`,
					data: {
						attempt: attemptNumber,
						failedCount: failed,
					},
				});
				const completed =
					await this.input.repository.completeNotificationAttempt({
						taskId: task.id,
						claimToken: task.claimToken,
						outcomes,
						next: {
							status: "failed",
							error: terminalError ?? temporaryError,
						},
						events,
						updatedAt: nowIso,
					});
				applied = completed.applied;
				if (applied && isEmailTask) {
					await this.writeApplicationLog(task, {
						event: "notification.email.failed",
						level: "error",
						message: "邮件投递已终止失败。",
						data: {
							attempt: attemptNumber,
							sentCount: sent,
							failedCount: failed,
						},
					});
				}
			} else {
				const completed =
					await this.input.repository.completeNotificationAttempt({
						taskId: task.id,
						claimToken: task.claimToken,
						outcomes,
						next: { status: "succeeded", result: { sent, failed } },
						events,
						updatedAt: nowIso,
					});
				applied = completed.applied;
				if (applied && isEmailTask) {
					await this.writeApplicationLog(task, {
						event: "notification.email.sent",
						level: "info",
						message: "邮件服务商已接受发送请求。",
						data: {
							attempt: attemptNumber,
							sentCount: sent,
							failedCount: failed,
						},
					});
				}
			}
			for (const updateReputation of applied ? reputationUpdates : []) {
				await Promise.resolve(updateReputation()).catch(() => undefined);
			}
			if (applied)
				await this.input.repository.finalizeScheduledTaskRun(task.id);
		}

		if (plannedIntent && processed < options.limit)
			processed += await this.runNextNotificationTask({
				limit: options.limit - processed,
				now,
			});
		return processed;
	}

	private async processIntent(task: TaskRunRecord, now: Date) {
		try {
			if (!this.input.planCommentNotification)
				throw new Error("Comment notification planner is not configured");
			await this.input.planCommentNotification(
				task.payload as CommentNotificationIntent,
			);
			await this.input.repository.completeNotificationAttempt({
				taskId: task.id,
				claimToken: task.claimToken,
				outcomes: [],
				next: { status: "succeeded", result: { planned: true } },
				events: [
					{
						eventType: "notification.email.planned",
						level: "info",
						message: "评论通知已完成收件规划。",
					},
				],
				updatedAt: now.toISOString(),
			});
		} catch (cause) {
			const error = {
				code: "COMMENT_NOTIFICATION_PLANNING_FAILED",
				message: "评论通知暂未完成规划。",
			};
			await this.writeApplicationLog(task, {
				event: "notification.email.failed",
				level: "error",
				message: "评论通知暂未完成规划，已保留重试记录。",
				data: {
					stage: "planning",
					attempt: task.attempts + 1,
					errorName: cause instanceof Error ? cause.name : "UnknownError",
					errorCode:
						cause &&
						typeof cause === "object" &&
						"code" in cause &&
						typeof cause.code === "string"
							? cause.code
							: undefined,
				},
			});
			await this.input.repository.completeNotificationAttempt({
				taskId: task.id,
				claimToken: task.claimToken,
				outcomes: [],
				next:
					task.attempts + 1 < task.maxAttempts
						? {
								status: "retrying",
								error,
								runAfter: new Date(now.getTime() + 15_000).toISOString(),
							}
						: { status: "failed", error },
				events: [
					{
						eventType: "notification.email.planning_failed",
						level: "error",
						message: "评论通知尚未完成收件规划。",
						data: { attempt: task.attempts + 1 },
					},
				],
				updatedAt: now.toISOString(),
			});
		}
	}

	private async writeApplicationLog(
		task: TaskRunRecord,
		input: Pick<AppLogRecord, "event" | "level" | "message" | "data">,
	) {
		if (!this.input.logApp) {
			return;
		}
		const summary = asTemplatePayload(task.payloadSummary) as Record<
			string,
			unknown
		>;
		try {
			await this.input.logApp({
				channel: "app",
				...input,
				siteKey: task.siteKey ?? undefined,
				targetType: task.subjectType ?? "task",
				targetId: task.subjectId ?? undefined,
				data: {
					...input.data,
					flow: typeof summary.flow === "string" ? summary.flow : undefined,
				},
			});
		} catch {
			await this.input
				.logApp({
					channel: "app",
					event: "notification.email.log_write_failed",
					level: "error",
					siteKey: task.siteKey ?? undefined,
					targetType: task.subjectType ?? "task",
					targetId: task.subjectId ?? undefined,
					message: "邮件投递日志写入失败。",
					data: { originalEvent: input.event },
				})
				.catch(() => undefined);
		}
	}
}
