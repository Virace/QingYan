import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type {
	AdminSettings,
	AdminSystemSettings,
	NotificationChannelConfig,
} from "@/api/admin";

import {
	readSettingsTabFromSearch,
	writeSettingsTabToSearch,
} from "../content/notification-ui-model";
import type { buildSettingsErrorModel } from "./settings-error-model";
import { buildSiteNotificationPayload } from "./site-notification-events-model";
export const siteSettingsTabs = [
	"comments",
	"engagement",
	"notifications",
	"pageRegistry",
] as const;
export type SiteSettingsTab = (typeof siteSettingsTabs)[number];

export const systemSettingsTabs = [
	"security",
	"rate-limit",
	"mail",
	"notifications",
	"captcha",
	"avatar",
	"ip-region",
	"anti-spam",
] as const;
export type SystemSettingsTab = (typeof systemSettingsTabs)[number];

export function parseSitemapUrlList(value: string) {
	return Array.from(
		new Set(
			value
				.split(/[\s,]+/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	);
}

export function buildSiteSettingsSectionPayload(
	section: SiteSettingsTab,
	draft: AdminSettings,
) {
	if (section === "comments") {
		return draft.comments;
	}
	if (section === "engagement") {
		return draft.engagement;
	}
	if (section === "pageRegistry") {
		return draft.pageRegistry;
	}
	return buildSiteNotificationPayload(draft.notifications);
}

export function buildSystemSettingsSectionPayload(
	section: SystemSettingsTab,
	draft: AdminSystemSettings,
) {
	const sanitized = withoutEmptySecrets(draft);
	switch (section) {
		case "security":
			return {
				admin: sanitized.admin,
				security: sanitized.security,
				logging: sanitized.logging,
			};
		case "rate-limit":
			return sanitized.security.rateLimit;
		case "mail":
			return sanitized.mail;
		case "notifications":
			return sanitized.notifications;
		case "captcha":
			return sanitized.captcha;
		case "avatar":
			return {
				avatar: sanitized.avatar,
				publicApi: sanitized.publicApi,
			};
		case "ip-region":
			return sanitized.ipRegion;
		case "anti-spam":
			return sanitized.antiSpam;
	}
}

export function isSameSettingsPayload(current: unknown, next: unknown) {
	return JSON.stringify(current) === JSON.stringify(next);
}

export const siteSectionSaveLabels: Record<SiteSettingsTab, string> = {
	comments: "保存评论设置",
	engagement: "保存访客与计数设置",
	notifications: "保存站点通知设置",
	pageRegistry: "保存页面注册设置",
};

export const systemSectionSaveLabels: Record<SystemSettingsTab, string> = {
	security: "保存后台与安全设置",
	"rate-limit": "保存限流设置",
	mail: "保存邮件设置",
	notifications: "保存发送服务设置",
	captcha: "保存验证码设置",
	avatar: "保存头像与公开接口设置",
	"ip-region": "保存 IP 地域设置",
	"anti-spam": "保存反垃圾设置",
};

export function initialSettingsTab<T extends string>(
	param: string,
	allowed: readonly T[],
	fallback: T,
) {
	if (typeof window === "undefined") {
		return fallback;
	}
	return readSettingsTabFromSearch(window.location.search, {
		param,
		allowed,
		fallback,
	});
}

export function replaceSettingsTabQuery(param: string, value: string) {
	if (typeof window === "undefined") {
		return;
	}
	const url = new URL(window.location.href);
	url.search = writeSettingsTabToSearch(url.search, { param, value });
	window.history.replaceState(null, "", url);
}

export function SettingsSaveError({
	model,
	fallback,
}: {
	model: ReturnType<typeof buildSettingsErrorModel>;
	fallback: string;
}) {
	if (!model) {
		return null;
	}
	const fieldMessages = Array.from(
		new Set(model.fields.map((field) => field.message.trim()).filter(Boolean)),
	);
	return (
		<Alert variant="destructive" className="md:col-span-2">
			<AlertTitle>{fallback}</AlertTitle>
			<AlertDescription>
				<p>{model.message}</p>
				{fieldMessages.length > 0 ? (
					<ul className="mt-2 list-disc pl-5">
						{fieldMessages.map((message) => (
							<li key={message}>{message}</li>
						))}
					</ul>
				) : null}
			</AlertDescription>
		</Alert>
	);
}

export function configStringValue(
	config: NotificationChannelConfig,
	key: string,
): string {
	const value = config.config[key];
	return typeof value === "string" ? value : "";
}

export function secretStringValue(
	config: NotificationChannelConfig,
	key: string,
): string {
	const value = config.secretConfig?.[key];
	return typeof value === "string" ? value : "";
}

export function withoutEmptySecrets(
	settings: AdminSystemSettings,
): AdminSystemSettings {
	const next = structuredClone(settings);
	if (next.mail.smtp.password === "") {
		delete next.mail.smtp.password;
	}
	if (next.captcha.turnstile.secretKey === "") {
		delete next.captcha.turnstile.secretKey;
	}
	if (next.captcha.hcaptcha.secretKey === "") {
		delete next.captcha.hcaptcha.secretKey;
	}
	if (next.captcha.recaptcha.apiKey === "") {
		delete next.captcha.recaptcha.apiKey;
	}
	if (next.captcha.geetest.captchaKey === "") {
		delete next.captcha.geetest.captchaKey;
	}
	if (next.antiSpam.akismet.apiKey === "") {
		delete next.antiSpam.akismet.apiKey;
	}
	if (next.notifications.webhook.secret === "") {
		delete next.notifications.webhook.secret;
	}
	if (next.notifications.wxpusher.appToken === "") {
		delete next.notifications.wxpusher.appToken;
	}
	next.notifications.channelConfigs = next.notifications.channelConfigs.map(
		(config) => {
			const secretConfig = { ...(config.secretConfig ?? {}) };
			if (secretConfig.secret === "") {
				delete secretConfig.secret;
			}
			if (secretConfig.appToken === "") {
				delete secretConfig.appToken;
			}
			return {
				...config,
				secretConfig,
			};
		},
	);

	return next;
}

export function secretPlaceholder(configured: boolean) {
	return configured ? "已配置，留空则保留" : "";
}
