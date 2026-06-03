import type { LoggerManager } from "../../logging/logger-manager";
import type { AppConfig } from "../../config/types";
import {
	flattenSystemSettings,
	maskSystemSettings,
	preserveConfiguredSecrets,
	readSystemSettingsRows,
	type SystemSettingRow,
} from "../system-settings/codec";
import type { SystemSettings } from "../system-settings/definitions";
import { createSystemSettingsDefaults } from "../system-settings/definitions";
import {
	normalizeExternalAvatarBaseUrl,
	validateExternalAvatarQuery,
} from "../comments/gravatar";
import type { AdminSystemSettingsRepository } from "./system-settings-repository";

type AdminSystemSettingsInput = {
	admin?: {
		session?: SystemSettings["admin"]["session"];
		emailVerification?: SystemSettings["admin"]["emailVerification"];
		deletion?: SystemSettings["admin"]["deletion"];
	};
	security?: SystemSettings["security"];
	logging: SystemSettings["logging"];
	mail?: {
		enabled: boolean;
		smtp: {
			host: string;
			port: number;
			secure: boolean;
			username: string;
			password?: string;
			from: string;
		};
	};
	notifications?: {
		delivery?: Partial<SystemSettings["notifications"]["delivery"]>;
		webhook?: {
			enabled?: boolean;
			url?: string;
			secret?: string;
		};
		wxpusher?: {
			enabled?: boolean;
			appToken?: string;
			apiUrl?: string;
		};
	};
	captcha?: {
		provider: SystemSettings["captcha"]["provider"];
		image: SystemSettings["captcha"]["image"];
		turnstile?: Omit<
			SystemSettings["captcha"]["turnstile"],
			"secretKeyConfigured"
		>;
		hcaptcha?: Omit<
			SystemSettings["captcha"]["hcaptcha"],
			"secretKeyConfigured"
		>;
		recaptcha?: Omit<
			SystemSettings["captcha"]["recaptcha"],
			"apiKeyConfigured"
		>;
		geetest?: Omit<
			SystemSettings["captcha"]["geetest"],
			"captchaKeyConfigured"
		>;
	};
	ipRegion?: SystemSettings["ipRegion"];
	avatar?: SystemSettings["avatar"];
	publicApi?: SystemSettings["publicApi"];
	antiSpam?: {
		akismet: Omit<SystemSettings["antiSpam"]["akismet"], "apiKeyConfigured">;
	};
	requestId?: string;
	actorUserId?: number;
};

export type AdminSystemSettingsSection =
	| "security"
	| "rate-limit"
	| "mail"
	| "notifications"
	| "captcha"
	| "avatar"
	| "ip-region"
	| "anti-spam";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecordPatch<T>(current: T, patch: unknown): T {
	if (!isRecord(current) || !isRecord(patch)) {
		return patch as T;
	}

	const next: Record<string, unknown> = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		next[key] = mergeRecordPatch(next[key], value);
	}
	return next as T;
}

export class AdminSystemSettingsService {
	public constructor(
		private readonly repository: AdminSystemSettingsRepository,
		private readonly loggerManager: LoggerManager,
		private readonly defaults?: SystemSettings,
	) {}

	private async readCurrentSettings() {
		const rows = (await this.repository.listAll()) as SystemSettingRow[];
		return readSystemSettingsRows(rows, this.defaults);
	}

	public async getSettings() {
		const settings = await this.readCurrentSettings();

		return {
			...maskSystemSettings(settings),
			logging: {
				...settings.logging,
				directory: this.loggerManager.getLogDirectory(),
			},
		};
	}

	public async buildSectionPatchInput(
		section: AdminSystemSettingsSection,
		patch: Record<string, unknown>,
	): Promise<AdminSystemSettingsInput> {
		const current = await this.readCurrentSettings();
		const next = structuredClone(current);

		switch (section) {
			case "security":
				next.admin = patch.admin
					? mergeRecordPatch(next.admin, patch.admin)
					: next.admin;
				next.security = patch.security
					? mergeRecordPatch(next.security, patch.security)
					: mergeRecordPatch(next.security, patch);
				next.logging = patch.logging
					? mergeRecordPatch(next.logging, patch.logging)
					: next.logging;
				break;
			case "rate-limit":
				next.security = {
					...next.security,
					rateLimit: mergeRecordPatch(next.security.rateLimit, patch),
				};
				break;
			case "mail":
				next.mail = mergeRecordPatch(next.mail, patch);
				break;
			case "notifications":
				next.notifications = mergeRecordPatch(next.notifications, patch);
				break;
			case "captcha":
				next.captcha = mergeRecordPatch(next.captcha, patch);
				break;
			case "avatar":
				next.avatar = patch.avatar
					? mergeRecordPatch(next.avatar, patch.avatar)
					: mergeRecordPatch(next.avatar, patch);
				next.publicApi = patch.publicApi
					? mergeRecordPatch(next.publicApi, patch.publicApi)
					: next.publicApi;
				break;
			case "ip-region":
				next.ipRegion = mergeRecordPatch(next.ipRegion, patch);
				break;
			case "anti-spam":
				next.antiSpam = mergeRecordPatch(next.antiSpam, patch);
				break;
		}

		return next;
	}

	public async updateSettings(input: AdminSystemSettingsInput) {
		const current = await this.readCurrentSettings();
		const patch: SystemSettings = {
			...current,
			admin: input.admin
				? {
						...current.admin,
						...input.admin,
					}
				: current.admin,
			security: input.security ?? current.security,
			logging: input.logging,
			mail: input.mail
				? {
						enabled: input.mail.enabled,
						smtp: {
							...current.mail.smtp,
							...input.mail.smtp,
						},
					}
				: current.mail,
			notifications: input.notifications
				? {
						delivery: {
							...current.notifications.delivery,
							...input.notifications.delivery,
						},
						webhook: {
							...current.notifications.webhook,
							...input.notifications.webhook,
						},
						wxpusher: {
							...current.notifications.wxpusher,
							...input.notifications.wxpusher,
						},
					}
				: current.notifications,
			captcha: input.captcha
				? {
						...current.captcha,
						provider: input.captcha.provider,
						image: input.captcha.image,
						turnstile: {
							...current.captcha.turnstile,
							...input.captcha.turnstile,
						},
						hcaptcha: {
							...current.captcha.hcaptcha,
							...input.captcha.hcaptcha,
						},
						recaptcha: {
							...current.captcha.recaptcha,
							...input.captcha.recaptcha,
						},
						geetest: {
							...current.captcha.geetest,
							...input.captcha.geetest,
						},
					}
				: current.captcha,
			ipRegion: input.ipRegion ?? current.ipRegion,
			avatar: input.avatar
				? {
						external: {
							enabled: input.avatar.external.enabled,
							baseUrl: normalizeExternalAvatarBaseUrl(
								input.avatar.external.baseUrl,
							),
							hashAlgorithm: input.avatar.external.hashAlgorithm,
							query: validateExternalAvatarQuery(input.avatar.external.query),
						},
						display: {
							shape: input.avatar.display.shape,
							sizePx: input.avatar.display.sizePx,
						},
					}
				: current.avatar,
			publicApi: input.publicApi ?? current.publicApi,
			antiSpam: input.antiSpam
				? {
						akismet: {
							...current.antiSpam.akismet,
							...input.antiSpam.akismet,
						},
					}
				: current.antiSpam,
		};
		const next = preserveConfiguredSecrets(current, patch);

		for (const row of flattenSystemSettings(next)) {
			await this.repository.upsert(row.category, row.key, row.value);
		}
		await this.loggerManager.reloadRuntimeSettings();
		await this.loggerManager.logApp({
			level: "info",
			channel: "app",
			event: "system.logging.updated",
			requestId: input.requestId,
			message: "系统设置已更新",
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			data: input.logging,
		});
		await this.repository.writeAudit({
			actorType: input.actorUserId ? "admin_user" : "system",
			actorId: input.actorUserId ? String(input.actorUserId) : undefined,
			action: "system.settings.updated",
			targetType: "system_settings",
			targetId: "global",
			payload: {
				admin: input.admin,
				security: input.security,
				logging: input.logging,
				mail: input.mail ? maskSystemSettings(next).mail : undefined,
				notifications: maskSystemSettings(next).notifications,
				captcha: input.captcha,
				ipRegion: input.ipRegion,
				avatar: input.avatar,
				publicApi: input.publicApi,
				antiSpam: input.antiSpam,
			},
		});

		return this.getSettings();
	}
}

export function createAdminSystemSettingsDefaults(
	config: AppConfig,
): SystemSettings {
	return createSystemSettingsDefaults({
		adminSession: {
			ttlMinutes: config.admin.session.ttlMinutes,
		},
		security: config.security,
	});
}
