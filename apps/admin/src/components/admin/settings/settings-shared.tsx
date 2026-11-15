import type {
	AdminSettings,
	AdminSystemSettings,
	NotificationChannelConfig,
} from "@/api/admin";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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
				security: { ...sanitized.security, rateLimit: undefined },
				logging: sanitized.logging,
			};
		case "rate-limit":
			return sanitized.security.rateLimit;
		case "mail":
			return sanitized.mail;
		case "notifications":
			return { ...sanitized.notifications, channelConfigs: undefined };
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

export function replaceSiteSettingsSection(
	draft: AdminSettings,
	settings: AdminSettings,
	section: SiteSettingsTab,
): AdminSettings {
	const next = { ...draft, [section]: structuredClone(settings[section]) };
	if (section === "engagement") next.pageFeedback = settings.pageFeedback;
	return next;
}

export const systemDraftSections = [...systemSettingsTabs, "channels"] as const;
export type SystemDraftSection = (typeof systemDraftSections)[number];

export function systemDraftPayload(
	section: SystemDraftSection,
	settings: AdminSystemSettings,
) {
	return section === "channels"
		? settings.notifications.channelConfigs
		: buildSystemSettingsSectionPayload(section, settings);
}

export function replaceSystemSettingsSection(
	draft: AdminSystemSettings,
	settings: AdminSystemSettings,
	section: SystemDraftSection,
): AdminSystemSettings {
	switch (section) {
		case "security":
			return {
				...draft,
				admin: structuredClone(settings.admin),
				logging: structuredClone(settings.logging),
				security: {
					...structuredClone(settings.security),
					rateLimit: draft.security.rateLimit,
				},
			};
		case "rate-limit":
			return {
				...draft,
				security: {
					...draft.security,
					rateLimit: structuredClone(settings.security.rateLimit),
				},
			};
		case "notifications":
			return {
				...draft,
				notifications: {
					...structuredClone(settings.notifications),
					channelConfigs: draft.notifications.channelConfigs,
				},
			};
		case "channels":
			return {
				...draft,
				notifications: {
					...draft.notifications,
					channelConfigs: structuredClone(
						settings.notifications.channelConfigs,
					),
				},
			};
		case "avatar":
			return {
				...draft,
				avatar: structuredClone(settings.avatar),
				publicApi: structuredClone(settings.publicApi),
			};
		case "ip-region":
			return { ...draft, ipRegion: structuredClone(settings.ipRegion) };
		case "anti-spam":
			return { ...draft, antiSpam: structuredClone(settings.antiSpam) };
		default:
			return { ...draft, [section]: structuredClone(settings[section]) };
	}
}

export function countSettingsChanges(saved: unknown, draft: unknown): number {
	if (isSameSettingsPayload(saved, draft)) return 0;
	if (
		saved &&
		draft &&
		typeof saved === "object" &&
		typeof draft === "object" &&
		!Array.isArray(saved) &&
		!Array.isArray(draft)
	) {
		const before = saved as Record<string, unknown>;
		const after = draft as Record<string, unknown>;
		return Array.from(
			new Set([...Object.keys(before), ...Object.keys(after)]),
		).reduce(
			(count, key) => count + countSettingsChanges(before[key], after[key]),
			0,
		);
	}
	return 1;
}

export function SettingsDraftActions({
	changeCount,
	totalDirtySections,
	pending,
	saveLabel,
	onDiscard,
	additionalChanges,
}: {
	changeCount: number;
	totalDirtySections: number;
	pending: boolean;
	saveLabel: string;
	onDiscard: () => void;
	additionalChanges?: string;
}) {
	return (
		<div
			className="sticky bottom-4 z-20 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3 md:col-span-2"
			data-settings-actions
		>
			<p className="min-w-0 text-sm" role="status">
				{changeCount > 0
					? `当前页签有 ${changeCount} 项未保存更改`
					: "当前设置已保存"}
				{totalDirtySections > (changeCount > 0 ? 1 : 0)
					? `，其他 ${totalDirtySections - (changeCount > 0 ? 1 : 0)} 个页签有未保存更改`
					: ""}
				{additionalChanges ? `；${additionalChanges}` : ""}
			</p>
			<div className="flex shrink-0 flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={!changeCount || pending}
					onClick={onDiscard}
				>
					放弃更改
				</Button>
				<Button type="submit" disabled={pending}>
					{pending ? "正在保存" : saveLabel}
				</Button>
			</div>
		</div>
	);
}

export function SettingsLoadError({
	message,
	pending,
	onRetry,
}: {
	message: string;
	pending: boolean;
	onRetry: () => void;
}) {
	return (
		<div
			className="grid justify-items-start gap-3 rounded-lg border p-4"
			role="alert"
		>
			<p className="text-sm">{message}</p>
			<Button variant="outline" disabled={pending} onClick={onRetry}>
				{pending ? "正在重试" : "重试"}
			</Button>
		</div>
	);
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
	window.history.replaceState(window.history.state, "", url);
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
