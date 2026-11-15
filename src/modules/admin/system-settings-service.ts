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
import { adminSystemSettingsBodySchema } from "./schemas";
import { toValidationFields } from "./validation-fields";
import { ValidationFailedError } from "../shared/errors";
import {
	type NotificationChannelConfigInput,
	NotificationChannelConfigsRepository,
} from "../notifications/channel-configs-repository";

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
		channelConfigs?: (Omit<NotificationChannelConfigInput, "type"> & {
			type: "email" | NotificationChannelConfigInput["type"];
		})[];
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

const SECTION_CATEGORIES: Record<
	AdminSystemSettingsSection,
	(keyof SystemSettings)[]
> = {
	security: ["admin", "security", "logging"],
	"rate-limit": ["security"],
	mail: ["mail"],
	notifications: ["notifications"],
	captcha: ["captcha"],
	avatar: ["avatar", "publicApi"],
	"ip-region": ["ipRegion"],
	"anti-spam": ["antiSpam"],
};

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

	private buildSectionPatchInput(
		current: SystemSettings,
		section: AdminSystemSettingsSection,
		patch: Record<string, unknown>,
	): AdminSystemSettingsInput {
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

		return {
			logging: next.logging,
			...Object.fromEntries(
				SECTION_CATEGORIES[section].map((category) => [
					category,
					next[category],
				]),
			),
		};
	}

	public async updateSettings(input: AdminSystemSettingsInput) {
		return this.saveSettings(() => input, input);
	}

	public async updateSectionSettings(
		section: AdminSystemSettingsSection,
		patch: Record<string, unknown>,
		context: Pick<AdminSystemSettingsInput, "requestId" | "actorUserId">,
	) {
		return this.saveSettings(
			(current) => this.buildSectionPatchInput(current, section, patch),
			context,
		);
	}

	private async saveSettings(
		buildInput: (current: SystemSettings) => AdminSystemSettingsInput,
		context: Pick<AdminSystemSettingsInput, "requestId" | "actorUserId">,
	) {
		const savedInput = await this.repository.transaction(
			async (repository, tx) => {
				const rows = (await repository.listAll()) as SystemSettingRow[];
				const current = readSystemSettingsRows(rows, this.defaults);
				const rawInput = buildInput(current);
				const parsed = adminSystemSettingsBodySchema.safeParse(rawInput);
				if (!parsed.success) {
					throw new ValidationFailedError(
						toValidationFields(parsed.error.issues, rawInput),
					);
				}
				const input = { ...parsed.data, ...context };
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
								commentFormat:
									input.mail.commentFormat ?? current.mail.commentFormat,
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
									query: validateExternalAvatarQuery(
										input.avatar.external.query,
									),
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

				const currentValues = new Map(
					flattenSystemSettings(current).map((row) => [
						`${row.category}.${row.key}`,
						JSON.stringify(row.value),
					]),
				);
				for (const row of flattenSystemSettings(next)) {
					if (
						currentValues.get(`${row.category}.${row.key}`) !==
						JSON.stringify(row.value)
					) {
						await repository.upsert(row.category, row.key, row.value);
					}
				}
				if (input.notifications?.channelConfigs) {
					await new NotificationChannelConfigsRepository(tx).replacePersisted(
						input.notifications.channelConfigs.filter(
							(config): config is NotificationChannelConfigInput =>
								config.type !== "email",
						),
					);
				}
				await repository.writeAudit({
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
						captcha: input.captcha
							? maskSystemSettings(next).captcha
							: undefined,
						ipRegion: input.ipRegion,
						avatar: input.avatar,
						publicApi: input.publicApi,
						antiSpam: input.antiSpam
							? maskSystemSettings(next).antiSpam
							: undefined,
					},
				});
				return input;
			},
		);
		await this.loggerManager.reloadRuntimeSettings();
		await this.loggerManager.logApp({
			level: "info",
			channel: "app",
			event: "system.logging.updated",
			requestId: context.requestId,
			message: "系统设置已更新",
			actorType: context.actorUserId ? "admin_user" : "system",
			actorId: context.actorUserId ? String(context.actorUserId) : undefined,
			data: savedInput.logging,
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
