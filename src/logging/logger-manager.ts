import path from "node:path";

import { eq } from "drizzle-orm";

import type { AppConfig } from "../config/types";
import type { AppDatabase } from "../db/client";
import { systemSettings } from "../db/schema";
import {
	defaultSystemSettings,
	type SystemSettings,
} from "../modules/system-settings/definitions";
import { LogFileSink } from "./file-sink";
import {
	formatAccessJsonlLine,
	formatAccessTextLine,
	formatAppJsonlLine,
	formatAppTextLine,
} from "./formatters";
import { sanitizeLogData } from "./redaction";
import {
	logLevelPriority,
	type AccessLogRecord,
	type AppLogRecord,
	type LogRuntimeSettings,
} from "./types";

function normalizeLogDirectory(directory: string): string {
	return path.isAbsolute(directory)
		? directory
		: path.resolve(process.cwd(), directory);
}

function parseSystemSettingValue<T>(valueJson: string): T | undefined {
	try {
		return JSON.parse(valueJson) as T;
	} catch {
		return undefined;
	}
}

export class LoggerManager {
	private readonly logDirectory: string;
	private readonly sink: LogFileSink;
	private siteSettings: LogRuntimeSettings;
	private fileLoggingEnabled = true;

	private constructor(
		private readonly config: AppConfig,
		private readonly db: AppDatabase,
		private readonly stderr: NodeJS.WritableStream,
	) {
		this.logDirectory = normalizeLogDirectory(config.logging.directory);
		this.sink = new LogFileSink(this.logDirectory);
		this.siteSettings = {
			level: defaultSystemSettings.logging.level,
			retentionDays: defaultSystemSettings.logging.retentionDays,
		};
	}

	public static async create(input: {
		config: AppConfig;
		db: AppDatabase;
		stderr: NodeJS.WritableStream;
	}) {
		const manager = new LoggerManager(input.config, input.db, input.stderr);
		await manager.reloadRuntimeSettings();
		return manager;
	}

	public getRuntimeSettings(): LogRuntimeSettings {
		return {
			level: this.siteSettings.level,
			retentionDays: this.siteSettings.retentionDays,
		};
	}

	public getLogDirectory(): string {
		return this.logDirectory;
	}

	public async reloadRuntimeSettings(): Promise<void> {
		try {
			const rows = await this.db
				.select()
				.from(systemSettings)
				.where(eq(systemSettings.category, "logging"));
			const nextSettings = { ...this.siteSettings };

			for (const row of rows) {
				if (row.key === "level") {
					const value = parseSystemSettingValue<
						SystemSettings["logging"]["level"]
					>(row.valueJson);
					if (value) {
						nextSettings.level = value;
					}
				}

				if (row.key === "retentionDays") {
					const value = parseSystemSettingValue<number>(row.valueJson);
					if (typeof value === "number" && value > 0) {
						nextSettings.retentionDays = value;
					}
				}
			}

			this.siteSettings = nextSettings;
			this.fileLoggingEnabled = true;
		} catch (error) {
			this.siteSettings = {
				level: defaultSystemSettings.logging.level,
				retentionDays: defaultSystemSettings.logging.retentionDays,
			};
			this.stderr.write(
				`[qingyan-logging] failed to load runtime settings: ${String(error)}\n`,
			);
		}
	}

	public async logAccess(record: AccessLogRecord): Promise<void> {
		if (!this.shouldWrite(record.level)) {
			return;
		}

		const timestamp = record.ts ?? new Date().toISOString();
		await this.write({
			channel: "access",
			ts: timestamp,
			textLine: formatAccessTextLine({
				...record,
				ts: timestamp,
			}),
			jsonlLine: formatAccessJsonlLine({
				...record,
				ts: timestamp,
			}),
		});
	}

	public async logApp(record: AppLogRecord): Promise<void> {
		if (!this.shouldWrite(record.level)) {
			return;
		}

		const timestamp = record.ts ?? new Date().toISOString();
		const data = record.data ? sanitizeLogData(record.data) : undefined;
		await this.write({
			channel: "app",
			ts: timestamp,
			textLine: formatAppTextLine({
				...record,
				ts: timestamp,
				data,
			}),
			jsonlLine: formatAppJsonlLine({
				...record,
				ts: timestamp,
				data,
			}),
		});
	}

	private shouldWrite(level: AccessLogRecord["level"] | AppLogRecord["level"]) {
		return logLevelPriority[level] <= logLevelPriority[this.siteSettings.level];
	}

	private async write(input: {
		channel: "access" | "app";
		ts: string;
		textLine: string;
		jsonlLine: string;
	}) {
		if (!this.fileLoggingEnabled) {
			this.stderr.write(`${input.textLine}\n`);
			return;
		}

		try {
			await this.sink.write({
				channel: input.channel,
				ts: input.ts,
				textLine: input.textLine,
				jsonlLine: input.jsonlLine,
				retentionDays: this.siteSettings.retentionDays,
			});
		} catch (error) {
			this.fileLoggingEnabled = false;
			this.stderr.write(
				`[qingyan-logging] file sink disabled: ${String(error)}\n`,
			);
			this.stderr.write(`${input.textLine}\n`);
		}
	}
}
