import { ApiError, type ApiFieldError } from "@/api/client";

export type SettingsFieldErrors = Record<string, ApiFieldError[]>;

export type SettingsErrorModel = {
	message: string;
	requestId?: string;
	code?: string;
	fields: ApiFieldError[];
	fieldsByPath: SettingsFieldErrors;
	raw: unknown;
};

const settingsErrorMessages: Record<string, string> = {
	VALIDATION_FAILED: "部分设置无效，请检查标出的项目后重新保存。",
	NOTIFICATION_CHANNEL_CONFIG_IN_USE:
		"这个目标仍被站点使用。请到“站点设置 > 通知”取消选择并保存，再回来删除。",
	FORBIDDEN: "当前账号没有修改权限，请联系管理员。",
	UNAUTHORIZED: "登录已过期，请重新登录后重试。",
	CSRF_INVALID: "登录状态已更新，请刷新页面后重试。",
	SMTP_NOT_CONFIGURED:
		"请先到“系统设置 > 邮件”完成并保存邮件服务器配置，再重试。",
};

function safeFieldMessage(field: ApiFieldError): string {
	if (field.path.endsWith(".commentVotes.enabled"))
		return "请重新选择评论投票开关，再保存。";
	if (field.path.endsWith(".pageLikes.enabled"))
		return "请重新选择页面点赞开关，再保存。";
	if (/channelConfigs\.\d+\.name$/u.test(field.path))
		return "请填写通知渠道名称。";
	if (/channelConfigs\.\d+\.config\.url$/u.test(field.path))
		return "请填写有效的 Webhook URL。";
	if (field.path.endsWith("smtp.port"))
		return "请填写有效的 SMTP 端口（1–65535）。";
	if (field.path.endsWith("smtp.host")) return "请填写邮件服务器地址。";
	if (field.path.endsWith("smtp.from")) return "请填写有效的发件人邮箱。";
	if (field.code === "too_small")
		return "此项内容不足或数值过小，请调整后保存。";
	if (field.code === "too_big") return "此项内容过长或数值过大，请调整后保存。";
	return "请检查此项设置，调整后重新保存。";
}

function fieldErrorsByPath(fields: ApiFieldError[]): SettingsFieldErrors {
	return fields.reduce<SettingsFieldErrors>((result, field) => {
		result[field.path] = [...(result[field.path] ?? []), field];
		return result;
	}, {});
}

export function buildSettingsErrorModel(
	error: unknown,
	fallback: string,
): SettingsErrorModel | null {
	if (!error) {
		return null;
	}
	if (error instanceof ApiError) {
		const fields = error.fields.map((field) => ({
			...field,
			message: safeFieldMessage(field),
		}));
		return {
			message: settingsErrorMessages[error.code ?? ""] ?? `${fallback}请重试。`,
			requestId: error.requestId,
			code: error.code,
			fields,
			fieldsByPath: fieldErrorsByPath(fields),
			raw: error.payload,
		};
	}
	if (error instanceof Error) {
		return {
			message: `${fallback}请检查连接后重试。`,
			fields: [],
			fieldsByPath: {},
			raw: error,
		};
	}
	if (typeof error === "string") {
		return {
			message: `${fallback}请重试。`,
			fields: [],
			fieldsByPath: {},
			raw: error,
		};
	}
	return {
		message: fallback,
		fields: [],
		fieldsByPath: {},
		raw: error,
	};
}

export function firstFieldError(
	model: SettingsErrorModel | null,
	path: string,
): string | undefined {
	return model?.fieldsByPath[path]?.[0]?.message;
}
