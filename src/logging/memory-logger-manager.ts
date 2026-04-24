import type { AppConfig } from "../config/types";
import type { LoggerManager } from "./logger-manager";
import type { AccessLogRecord, AppLogRecord } from "./types";

export function createMemoryLoggerManager(config: AppConfig): LoggerManager {
	return {
		getRuntimeSettings() {
			return {
				level: config.logging.defaults.level,
				retentionDays: config.logging.defaults.retentionDays,
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
