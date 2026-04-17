import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import type { LogChannel } from "./types";

function parseDateKey(dateKey: string): number | null {
	const timestamp = Date.parse(`${dateKey}T00:00:00.000Z`);
	return Number.isNaN(timestamp) ? null : timestamp;
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
		const dateKey = input.ts.slice(0, 10);
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
