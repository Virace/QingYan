import type { AppConfig } from "../config/types";
import { defaultSystemSettings } from "../modules/system-settings/definitions";
import type { LoggerManager } from "./logger-manager";
import type { AccessLogRecord, AppLogRecord } from "./types";

export function createMemoryLoggerManager(config: AppConfig): LoggerManager {
	return {
		getRuntimeSettings() {
			return {
				level: defaultSystemSettings.logging.level,
				retentionDays: defaultSystemSettings.logging.retentionDays,
			};
		},
		getLogDirectory() {
			return config.logging.directory;
		},
		async reloadRuntimeSettings() {},
		async logAccess(_record: AccessLogRecord) {},
		async logApp(_record: AppLogRecord) {},
	} as LoggerManager;
}
