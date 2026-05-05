import type { LoggerManager } from "../../logging/logger-manager";
import type { LogLevel } from "../../logging/types";
import type { AdminSystemSettingsRepository } from "./system-settings-repository";

export class AdminSystemSettingsService {
	public constructor(
		private readonly repository: AdminSystemSettingsRepository,
		private readonly loggerManager: LoggerManager,
	) {}

	public async getSettings() {
		const siteSettings = this.loggerManager.getRuntimeSettings();

		return {
			logging: {
				level: siteSettings.level,
				retentionDays: siteSettings.retentionDays,
				directory: this.loggerManager.getLogDirectory(),
			},
		};
	}

	public async updateSettings(input: {
		logging: {
			level: LogLevel;
			retentionDays: number;
		};
		requestId?: string;
	}) {
		await this.repository.upsert("logging", "level", input.logging.level);
		await this.repository.upsert(
			"logging",
			"retentionDays",
			input.logging.retentionDays,
		);
		await this.loggerManager.reloadRuntimeSettings();
		await this.loggerManager.logApp({
			level: "info",
			channel: "app",
			event: "system.logging.updated",
			requestId: input.requestId,
			message: "日志系统设置已更新",
			data: input.logging,
		});

		return this.getSettings();
	}
}
