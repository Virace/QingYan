import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import type { LogChannel } from "./types";

const DEFAULT_LOG_DATE_TIME_ZONE = "Asia/Shanghai";

function parseDateKey(dateKey: string): number | null {
	const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
	if (!matched) {
		return null;
	}
	const [, year, month, day] = matched;
	const timestamp = new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
	).getTime();
	return Number.isNaN(timestamp) ? null : timestamp;
}

function resolveLogDateTimeZone(): string {
	return (
		process.env.QINGYAN_LOG_DATE_TIME_ZONE ??
		process.env.TZ ??
		DEFAULT_LOG_DATE_TIME_ZONE
	);
}

function formatLocalDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function formatLogDateKey(isoTimestamp: string): string {
	const date = new Date(isoTimestamp);
	if (Number.isNaN(date.getTime())) {
		return isoTimestamp.slice(0, 10);
	}
	const fallbackDateKey = formatLocalDateKey(date);
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: resolveLogDateTimeZone(),
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(date);
		const year = parts.find((part) => part.type === "year")?.value;
		const month = parts.find((part) => part.type === "month")?.value;
		const day = parts.find((part) => part.type === "day")?.value;
		if (year && month && day) {
			return `${year}-${month}-${day}`;
		}
	} catch {
		return fallbackDateKey;
	}
	return fallbackDateKey;
}

export class LogFileSink {
	private writeQueue = Promise.resolve();
	private lastCleanupDate: string | undefined;

	public constructor(private readonly rootDirectory: string) {}

	public async write(input: {
		channel: LogChannel;
		ts: string;
		textLine: string;
		jsonlLine: string;
		retentionDays: number;
	}) {
		const dateKey = formatLogDateKey(input.ts);
		const channelDirectory = path.join(this.rootDirectory, input.channel);
		await mkdir(channelDirectory, { recursive: true });

		this.writeQueue = this.writeQueue.then(async () => {
			await appendFile(
				path.join(channelDirectory, `${dateKey}.log`),
				`${input.textLine}\n`,
				"utf-8",
			);
			await appendFile(
				path.join(channelDirectory, `${dateKey}.jsonl`),
				`${input.jsonlLine}\n`,
				"utf-8",
			);
		});
		await this.writeQueue;

		if (this.lastCleanupDate !== dateKey) {
			await this.cleanupExpiredFiles(dateKey, input.retentionDays);
			this.lastCleanupDate = dateKey;
		}
	}

	private async cleanupExpiredFiles(dateKey: string, retentionDays: number) {
		const currentDate = parseDateKey(dateKey);
		if (currentDate === null) {
			return;
		}

		for (const channel of ["access", "app"] as const) {
			const channelDirectory = path.join(this.rootDirectory, channel);
			try {
				const fileNames = await readdir(channelDirectory);
				for (const fileName of fileNames) {
					const matched = fileName.match(/^(\d{4}-\d{2}-\d{2})\.(log|jsonl)$/);
					if (!matched?.[1]) {
						continue;
					}

					const fileDate = parseDateKey(matched[1]);
					if (fileDate === null) {
						continue;
					}

					const ageDays = Math.floor(
						(currentDate - fileDate) / (24 * 60 * 60 * 1000),
					);
					if (ageDays <= retentionDays) {
						continue;
					}

					await rm(path.join(channelDirectory, fileName), { force: true });
				}
			} catch {
				// Missing channel directory is acceptable before the first write.
			}
		}
	}
}
