import path from "node:path";

import { eq } from "drizzle-orm";

import type { AppConfig } from "../config/types";
import type { AppDatabase } from "../db/client";
import { systemSettings } from "../db/schema";
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
	private runtimeSettings: LogRuntimeSettings;
	private fileLoggingEnabled = true;

	private constructor(
		private readonly config: AppConfig,
		private readonly db: AppDatabase,
		private readonly stderr: NodeJS.WritableStream,
	) {
		this.logDirectory = normalizeLogDirectory(config.logging.directory);
		this.sink = new LogFileSink(this.logDirectory);
		this.runtimeSettings = {
			level: config.logging.defaults.level,
			retentionDays: config.logging.defaults.retentionDays,
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
			level: this.runtimeSettings.level,
			retentionDays: this.runtimeSettings.retentionDays,
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
			const nextSettings = { ...this.runtimeSettings };

			for (const row of rows) {
				if (row.key === "level") {
					const value = parseSystemSettingValue<
						AppConfig["logging"]["defaults"]["level"]
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

			this.runtimeSettings = nextSettings;
			this.fileLoggingEnabled = true;
		} catch (error) {
			this.runtimeSettings = {
				level: this.config.logging.defaults.level,
				retentionDays: this.config.logging.defaults.retentionDays,
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

		const ts = record.ts ?? new Date().toISOString();
		await this.write({
			channel: "access",
			ts,
			textLine: formatAccessTextLine({
				...record,
				ts,
			}),
			jsonlLine: formatAccessJsonlLine({
				...record,
				ts,
			}),
		});
	}

	public async logApp(record: AppLogRecord): Promise<void> {
		if (!this.shouldWrite(record.level)) {
			return;
		}

		const ts = record.ts ?? new Date().toISOString();
		const data = record.data ? sanitizeLogData(record.data) : undefined;
		await this.write({
			channel: "app",
			ts,
			textLine: formatAppTextLine({
				...record,
				ts,
				data,
			}),
			jsonlLine: formatAppJsonlLine({
				...record,
				ts,
				data,
			}),
		});
	}

	private shouldWrite(level: AccessLogRecord["level"] | AppLogRecord["level"]) {
		return (
			logLevelPriority[level] <= logLevelPriority[this.runtimeSettings.level]
		);
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
				retentionDays: this.runtimeSettings.retentionDays,
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
