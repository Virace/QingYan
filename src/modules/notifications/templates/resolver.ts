import type { NotificationDeliveryRecord } from "../../tasks/types";
import {
	NotificationTemplateError,
	type NotificationTemplateFormat,
} from "./renderer";
import type { NotificationTemplateRepository } from "./repository";

export class NotificationTemplateResolver {
	public constructor(
		private readonly templates: NotificationTemplateRepository,
	) {}

	public async resolve(
		delivery: NotificationDeliveryRecord,
		format?: NotificationTemplateFormat,
	) {
		let key = delivery.templateKey;
		const event =
			key === "backend_user.comment.pending"
				? "pending"
				: key === "backend_user.comment.approved"
					? "approved"
					: null;
		if (event) {
			key =
				delivery.channel === "email"
					? `backend_comment_${event}_email_${format === "html" ? "html" : "text"}`
					: delivery.channel === "webhook"
						? event === "pending"
							? "backend_comment_webhook_json"
							: "backend_comment_approved_webhook_json"
						: `backend_comment_${event}_wxpusher_text`;
		} else if (key === "commenter.reply_approved") {
			key = `commenter_reply_approved_email_${format === "html" ? "html" : "text"}`;
		}
		const template = await this.templates.get(key);
		if (!template)
			throw new NotificationTemplateError(
				`Unknown notification template: ${key}`,
			);
		return template;
	}
}
