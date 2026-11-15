import type { AuthenticatedAdminSession } from "../admin/session-service";
import { AppError } from "../shared/errors";
import type { RuntimeSystemSettingsService } from "../system-settings/service";
import type { TaskRunRepository } from "../tasks/task-run-repository";
import {
	EmailNotificationChannel,
	type EmailSender,
} from "./channels/email-channel";
import {
	classifySmtpError,
	createNodemailerSmtpSender,
	sanitizeSmtpError,
	type ClassifiedSmtpError,
} from "./channels/smtp-sender";

type MailTestInput = {
	recipient?: string;
	session: AuthenticatedAdminSession;
	sender?: EmailSender;
};

function mailTestNotTestable(fields: Array<{ path: string; message: string }>) {
	return new AppError(
		400,
		"NOTIFICATION_CHANNEL_NOT_TESTABLE",
		"通知通道当前不可测试。",
		{
			channelConfigId: "email:default",
			channelType: "email",
			fields,
		},
	);
}

function mailTestFailed(input: {
	taskId: string;
	deliveryId: string;
	recipient: string;
	error: ClassifiedSmtpError;
}) {
	return new AppError(502, "MAIL_TEST_FAILED", "邮件测试发送失败。", {
		taskId: input.taskId,
		deliveryId: input.deliveryId,
		channel: "email",
		recipient: input.recipient,
		errorKind: input.error.kind,
		message: input.error.message,
	});
}

export class MailTestService {
	public constructor(
		private readonly repository: TaskRunRepository,
		private readonly systemSettings: RuntimeSystemSettingsService,
	) {}

	public async send(input: MailTestInput) {
		const settings = await this.systemSettings.getSettings();
		const fields: Array<{ path: string; message: string }> = [];
		if (!settings.mail.enabled) {
			fields.push({
				path: "mail.enabled",
				message: "系统邮件未启用，不能发送测试邮件。",
			});
		}
		if (!settings.mail.smtp.host.trim()) {
			fields.push({
				path: "mail.smtp.host",
				message: "SMTP Host 不能为空。",
			});
		}
		if (!settings.mail.smtp.from.trim()) {
			fields.push({
				path: "mail.smtp.from",
				message: "SMTP 发件人不能为空。",
			});
		}
		if (fields.length > 0) {
			throw mailTestNotTestable(fields);
		}

		const recipient = input.recipient ?? input.session.user.email;
		const { task, delivery } =
			await this.repository.createNotificationTaskWithDelivery({
				task: {
					type: "mail_test",
					category: "notification",
					payload: {
						channel: "email",
						channelConfigId: "email:default",
						templateContext: {
							site: { name: "QingYan" },
						},
						subjectTemplate: "[QingYan] 邮件测试",
						bodyTemplate: "这是一封 QingYan SMTP 测试邮件。",
						format: "text",
					},
					payloadSummary: {
						channel: "email",
						channelConfigId: "email:default",
						channelConfigName: "默认邮件",
						recipientType: "test",
						recipientAddressSnapshot: recipient,
					},
					actorType: "admin_user",
					actorId: String(input.session.user.id),
					maxAttempts: 1,
				},
				delivery: {
					channel: "email",
					channelConfigRef: "email:default",
					channelConfigNameSnapshot: "默认邮件",
					recipientType: "test",
					recipientUserId: input.session.user.id,
					recipientAddressSnapshot: recipient,
					recipientIdentityKey: recipient,
					eventFamily: "mail_test",
					templateKey: "mail_test",
				},
			});

		const claim = await this.repository.markRunning(task.id);
		if (!claim?.claimToken)
			throw new AppError(
				409,
				"MAIL_TEST_ALREADY_CLAIMED",
				"邮件测试已开始，请查看投递结果。",
			);
		const channel = new EmailNotificationChannel(
			settings.mail,
			input.sender ?? createNodemailerSmtpSender(settings.mail.smtp),
		);
		let result: Awaited<ReturnType<EmailNotificationChannel["send"]>>;
		try {
			result = await channel.send({
				to: recipient,
				subject: "[QingYan] 邮件测试",
				body: "这是一封 QingYan SMTP 测试邮件。",
				format: "text",
			});
		} catch (error) {
			const classified = sanitizeSmtpError(
				classifySmtpError(error),
				settings.mail.smtp.password,
			);
			await this.repository.completeNotificationAttempt({
				taskId: task.id,
				claimToken: claim.claimToken,
				outcomes: [
					{ deliveryId: delivery.id, status: "failed", error: classified },
				],
				next: { status: "failed", error: classified },
				events: [
					{
						eventType: "notification.email.failed",
						level: "error",
						message: "测试邮件投递失败。",
					},
				],
			});
			throw mailTestFailed({
				taskId: task.id,
				deliveryId: delivery.id,
				recipient,
				error: classified,
			});
		}
		await this.repository.completeNotificationAttempt({
			taskId: task.id,
			claimToken: claim.claimToken,
			outcomes: [
				{
					deliveryId: delivery.id,
					status: "sent",
					providerMessageId: result.providerMessageId,
					sentAt: new Date().toISOString(),
				},
			],
			next: {
				status: "succeeded",
				result: {
					status: "sent",
					deliveryId: delivery.id,
					channel: "email",
					recipient,
					providerMessageId: result.providerMessageId ?? null,
				},
			},
			events: [
				{
					eventType: "notification.email.accepted",
					level: "info",
					message: "邮件服务商已接受测试邮件。",
				},
			],
		});
		return {
			status: "sent" as const,
			taskId: task.id,
			deliveryId: delivery.id,
			channel: "email" as const,
			recipient,
			providerMessageId: result.providerMessageId ?? undefined,
			message: "测试邮件已发送。",
		};
	}
}
