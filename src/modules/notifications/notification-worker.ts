import type { NotificationDeliveryRecord, TaskRunRecord } from "../tasks/types";
import type { TaskQueue } from "../tasks/types";
import type { TaskRunRepository } from "../tasks/task-run-repository";
import type { AppLogRecord } from "../../logging/types";
import {
	classifyChannelError,
	NotificationChannelError,
} from "./channels/error-classifier";
import type { NotificationChannelAdapter } from "./channels/types";
import {
	NotificationTemplateError,
	renderNotificationTemplate,
} from "./templates/renderer";

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
	};
	logApp?: (record: AppLogRecord) => Promise<void>;
};

type TemplatePayload = {
	templateContext?: Record<string, unknown>;
	subjectTemplate?: string;
	bodyTemplate?: string;
	format?: "html" | "text" | "json";
};

function asTemplatePayload(payload: unknown): TemplatePayload {
	return payload && typeof payload === "object"
		? (payload as TemplatePayload)
		: {};
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

		for (const task of tasks) {
			processed += 1;
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
			const attemptNumber = task.attempts + 1;
			const outcomes: Parameters<
				TaskRunRepository["completeNotificationAttempt"]
			>[0]["outcomes"] = [];
			const events: Parameters<
				TaskRunRepository["completeNotificationAttempt"]
			>[0]["events"] = [];
			const reputationUpdates: Array<() => Promise<unknown> | unknown> = [];

			for (const delivery of deliveries) {
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
					const format = payload.format ?? "text";
					const rendered = renderNotificationTemplate({
						format,
						subjectTemplate:
							payload.subjectTemplate ?? "[QingYan] Notification",
						bodyTemplate: payload.bodyTemplate ?? fallbackBody(delivery),
						context: payload.templateContext ??
							(await this.input.templateContextBuilder?.build({
								task,
								delivery,
							})) ?? {
								comment: { content: "QingYan notification" },
							},
					});
					const result = await adapter.send({
						to: delivery.recipientAddressSnapshot,
						subject: rendered.subject,
						body: rendered.body,
						format,
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
				await this.input.repository.completeNotificationAttempt({
					taskId: task.id,
					outcomes,
					next: { status: "retrying", error: temporaryError, runAfter },
					events,
					updatedAt: nowIso,
				});
				if (isEmailTask) {
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
				await this.input.repository.completeNotificationAttempt({
					taskId: task.id,
					outcomes,
					next: {
						status: "failed",
						error: terminalError ?? temporaryError,
					},
					events,
					updatedAt: nowIso,
				});
				if (isEmailTask) {
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
				await this.input.repository.completeNotificationAttempt({
					taskId: task.id,
					outcomes,
					next: { status: "succeeded", result: { sent, failed } },
					events,
					updatedAt: nowIso,
				});
				if (isEmailTask) {
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
			for (const updateReputation of reputationUpdates) {
				await Promise.resolve(updateReputation()).catch(() => undefined);
			}
		}

		return processed;
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
