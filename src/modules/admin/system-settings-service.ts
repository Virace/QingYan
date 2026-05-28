import type { LoggerManager } from "../../logging/logger-manager";
import type { AppConfig } from "../../config/types";
import {
	flattenSystemSettings,
	maskSystemSettings,
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
	admin?: SystemSettings["admin"];
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
	antiSpam?: {
		akismet: Omit<SystemSettings["antiSpam"]["akismet"], "apiKeyConfigured">;
	};
	requestId?: string;
};

export class AdminSystemSettingsService {
	public constructor(
		private readonly repository: AdminSystemSettingsRepository,
		private readonly loggerManager: LoggerManager,
		private readonly defaults?: SystemSettings,
	) {}

	public async getSettings() {
		const rows = (await this.repository.listAll()) as SystemSettingRow[];
		const settings = readSystemSettingsRows(rows, this.defaults);

		return {
			...maskSystemSettings(settings),
			logging: {
				...settings.logging,
				directory: this.loggerManager.getLogDirectory(),
			},
		};
	}

	public async updateSettings(input: AdminSystemSettingsInput) {
		const rows = (await this.repository.listAll()) as SystemSettingRow[];
		const current = readSystemSettingsRows(rows, this.defaults);
		const next: SystemSettings = {
			...current,
			admin: input.admin ?? current.admin,
			security: input.security ?? current.security,
			logging: input.logging,
			mail: input.mail
				? {
						enabled: input.mail.enabled,
						smtp: {
							...current.mail.smtp,
							...input.mail.smtp,
							password: input.mail.smtp.password ?? current.mail.smtp.password,
							passwordConfigured: Boolean(
								input.mail.smtp.password ?? current.mail.smtp.password,
							),
						},
					}
				: current.mail,
			captcha: input.captcha
				? {
						...current.captcha,
						provider: input.captcha.provider,
						image: input.captcha.image,
						turnstile: {
							...current.captcha.turnstile,
							...input.captcha.turnstile,
							secretKey:
								input.captcha.turnstile?.secretKey ??
								current.captcha.turnstile.secretKey,
							secretKeyConfigured: Boolean(
								input.captcha.turnstile?.secretKey ??
									current.captcha.turnstile.secretKey,
							),
						},
						hcaptcha: {
							...current.captcha.hcaptcha,
							...input.captcha.hcaptcha,
							secretKey:
								input.captcha.hcaptcha?.secretKey ??
								current.captcha.hcaptcha.secretKey,
							secretKeyConfigured: Boolean(
								input.captcha.hcaptcha?.secretKey ??
									current.captcha.hcaptcha.secretKey,
							),
						},
						recaptcha: {
							...current.captcha.recaptcha,
							...input.captcha.recaptcha,
							apiKey:
								input.captcha.recaptcha?.apiKey ??
								current.captcha.recaptcha.apiKey,
							apiKeyConfigured: Boolean(
								input.captcha.recaptcha?.apiKey ??
									current.captcha.recaptcha.apiKey,
							),
						},
						geetest: {
							...current.captcha.geetest,
							...input.captcha.geetest,
							captchaKey:
								input.captcha.geetest?.captchaKey ??
								current.captcha.geetest.captchaKey,
							captchaKeyConfigured: Boolean(
								input.captcha.geetest?.captchaKey ??
									current.captcha.geetest.captchaKey,
							),
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
			antiSpam: input.antiSpam
				? {
						akismet: {
							...current.antiSpam.akismet,
							...input.antiSpam.akismet,
							apiKey:
								input.antiSpam.akismet.apiKey ??
								current.antiSpam.akismet.apiKey,
							apiKeyConfigured: Boolean(
								input.antiSpam.akismet.apiKey ??
									current.antiSpam.akismet.apiKey,
							),
						},
					}
				: current.antiSpam,
		};

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
			data: input.logging,
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
