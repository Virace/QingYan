import type { NotificationDeliveryRecord, TaskRunRecord } from "../tasks/types";
import type { TaskQueue } from "../tasks/types";
import type { TaskRunRepository } from "../tasks/task-run-repository";
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
	adapters: Record<string, NotificationChannelAdapter | undefined>;
	reputation?: ReputationRecorder;
	retryDelaySec?: number;
	templateContextBuilder?: {
		build(input: {
			task: TaskRunRecord;
			delivery: NotificationDeliveryRecord;
		}): Promise<Record<string, unknown>>;
	};
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
		});
		let processed = 0;

		for (const task of tasks.filter(
			(item) => item.category === "notification",
		)) {
			processed += 1;
			const deliveries = await this.input.repository.listDeliveriesForTask(
				task.id,
			);
			let sent = 0;
			let failed = 0;
			let temporaryError: unknown = null;
			let terminalError: unknown = null;

			for (const delivery of deliveries) {
				const adapter = this.input.adapters[delivery.channel];
				if (!adapter) {
					terminalError = new NotificationChannelError(
						"config",
						`Notification channel is not configured: ${delivery.channel}`,
					);
					await this.input.repository.markDeliveryFailed({
						id: delivery.id,
						error: classifyChannelError(terminalError),
					});
					failed += 1;
					continue;
				}

				try {
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
					await this.input.repository.markDeliverySent({
						id: delivery.id,
						providerMessageId: result.providerMessageId,
						sentAt: nowIso,
					});
					if (delivery.recipientType === "commenter") {
						await this.input.reputation?.recordSuccess?.({
							siteId: task.siteId,
							email: delivery.recipientAddressSnapshot,
							nowIso,
						});
					}
					sent += 1;
				} catch (error) {
					const channelError =
						error instanceof NotificationTemplateError
							? new NotificationChannelError("template", error.message)
							: error;
					const classified = classifyChannelError(channelError);
					await this.input.repository.markDeliveryFailed({
						id: delivery.id,
						error: classified,
					});
					if (
						classified.affectsRecipientReputation &&
						delivery.recipientType === "commenter"
					) {
						await this.input.reputation?.recordRecipientFailure({
							siteId: task.siteId,
							email: delivery.recipientAddressSnapshot,
							reason: classified.message,
							nowIso,
						});
					}
					if (classified.terminal) {
						terminalError = classified;
					} else {
						temporaryError = classified;
					}
					failed += 1;
				}
			}

			if (temporaryError && task.attempts + 1 < task.maxAttempts) {
				const runAfter = new Date(
					now.getTime() + (this.input.retryDelaySec ?? 300) * 1000,
				).toISOString();
				await this.input.queue.retry(task.id, temporaryError, runAfter);
			} else if (failed > 0) {
				await this.input.queue.fail(task.id, terminalError ?? temporaryError);
			} else {
				await this.input.queue.ack(task.id, { sent, failed });
			}
		}

		return processed;
	}
}
