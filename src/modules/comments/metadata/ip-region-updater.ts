import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
	copyFile,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import Ip2Region from "ts-ip2region2";

import type { AppDatabase } from "../../../db/client";
import {
	comments,
	ipRegionDatabaseState,
	ipRegionUpdateRuns,
} from "../../../db/schema";
import type { CommentMetadataSettings } from "../../shared/site-settings-defaults";
import { parseIpRegionText, type IpRegionSnapshot } from "./ip-region";

type IpRegionConfig = CommentMetadataSettings["ipRegion"];
export type IpVersion = "v4" | "v6";
export type IpRegionUpdateStatus = "success" | "skipped" | "failed";

export interface IpRegionUpdateResult {
	status: IpRegionUpdateStatus;
	sourceUrl?: string;
	previousHash?: string;
	nextHash?: string;
	refreshedComments: number;
	errorMessage?: string;
}

interface DownloadedDatabase {
	sourceUrl: string;
	filePath: string;
	fileHash: string;
}

export interface IpRegionUpdaterOptions {
	batchSize?: number;
	downloadDatabase?: (input: {
		sources: string[];
		targetPath: string;
	}) => Promise<DownloadedDatabase>;
	resolveIp?: (ip: string) => IpRegionSnapshot;
	verifyFile?: (filePath: string) => boolean;
}

function nowIso(): string {
	return new Date().toISOString();
}

export async function calculateFileHash(filePath: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(filePath))
		.digest("hex");
}

async function downloadWithFallback(
	input: {
		sources: string[];
		targetPath: string;
		verifyFile: (filePath: string) => boolean;
	},
	fetchImpl = fetch,
): Promise<DownloadedDatabase> {
	await mkdir(path.dirname(input.targetPath), { recursive: true });

	for (const sourceUrl of input.sources) {
		const tmpPath = `${input.targetPath}.${Date.now()}.tmp`;
		try {
			const response = await fetchImpl(sourceUrl);
			if (!response.ok) {
				continue;
			}

			await writeFile(tmpPath, Buffer.from(await response.arrayBuffer()));
			if (!input.verifyFile(tmpPath)) {
				await rm(tmpPath, { force: true });
				continue;
			}

			return {
				sourceUrl,
				filePath: tmpPath,
				fileHash: await calculateFileHash(tmpPath),
			};
		} catch {
			await rm(tmpPath, { force: true });
		}
	}

	throw new Error("all_sources_failed");
}

export class IpRegionUpdater {
	private readonly batchSize: number;

	public constructor(
		private readonly db: AppDatabase,
		private readonly options: IpRegionUpdaterOptions = {},
	) {
		this.batchSize = options.batchSize ?? 500;
	}

	public async update(input: {
		ipVersion: IpVersion;
		config: IpRegionConfig;
	}): Promise<IpRegionUpdateResult> {
		if (!input.config.enabled) {
			return this.record(input.ipVersion, {
				status: "skipped",
				refreshedComments: 0,
				errorMessage: "ip_region_disabled",
			});
		}

		try {
			return await this.updateEnabled(input.ipVersion, input.config);
		} catch (error) {
			return this.record(input.ipVersion, {
				status: "failed",
				refreshedComments: 0,
				errorMessage: error instanceof Error ? error.message : "update_failed",
			});
		}
	}

	private async updateEnabled(
		ipVersion: IpVersion,
		config: IpRegionConfig,
	): Promise<IpRegionUpdateResult> {
		const database = ipVersion === "v4" ? config.ipv4 : config.ipv6;
		const targetPath = path.resolve(process.cwd(), database.dbPath);
		const previous = await this.getState(ipVersion);
		const downloaded = await this.download(database.sources, targetPath);

		if (previous?.fileHash === downloaded.fileHash) {
			await rm(downloaded.filePath, { force: true });
			return this.record(ipVersion, {
				status: "skipped",
				sourceUrl: downloaded.sourceUrl,
				previousHash: previous.fileHash,
				nextHash: downloaded.fileHash,
				refreshedComments: 0,
			});
		}

		await this.activateDatabase(downloaded.filePath, targetPath);
		await this.upsertState({
			ipVersion,
			filePath: targetPath,
			fileHash: downloaded.fileHash,
			sourceUrl: downloaded.sourceUrl,
			cachePolicy: config.cachePolicy,
		});
		const refreshedComments = await this.refreshComments({
			ipVersion,
			dbPath: targetPath,
			dbHash: downloaded.fileHash,
			cachePolicy: config.cachePolicy,
		});

		return this.record(ipVersion, {
			status: "success",
			sourceUrl: downloaded.sourceUrl,
			previousHash: previous?.fileHash,
			nextHash: downloaded.fileHash,
			refreshedComments,
		});
	}

	private download(sources: string[], targetPath: string) {
		if (this.options.downloadDatabase) {
			return this.options.downloadDatabase({ sources, targetPath });
		}

		return downloadWithFallback({
			sources,
			targetPath,
			verifyFile: this.options.verifyFile ?? Ip2Region.verify,
		});
	}

	private async activateDatabase(sourcePath: string, targetPath: string) {
		await mkdir(path.dirname(targetPath), { recursive: true });
		const tmpPath = `${targetPath}.${Date.now()}.activate`;
		await copyFile(sourcePath, tmpPath);
		await rm(targetPath, { force: true });
		await rename(tmpPath, targetPath);
		await rm(sourcePath, { force: true });
	}

	private async getState(ipVersion: IpVersion) {
		const [state] = await this.db
			.select()
			.from(ipRegionDatabaseState)
			.where(eq(ipRegionDatabaseState.ipVersion, ipVersion))
			.limit(1);

		return state;
	}

	private async upsertState(input: {
		ipVersion: IpVersion;
		filePath: string;
		fileHash: string;
		sourceUrl: string;
		cachePolicy: string;
	}) {
		const timestamp = nowIso();
		await this.db
			.insert(ipRegionDatabaseState)
			.values({
				ipVersion: input.ipVersion,
				filePath: input.filePath,
				fileHash: input.fileHash,
				sourceUrl: input.sourceUrl,
				cachePolicy: input.cachePolicy,
				activatedAt: timestamp,
				updatedAt: timestamp,
			})
			.onConflictDoUpdate({
				target: ipRegionDatabaseState.ipVersion,
				set: {
					filePath: input.filePath,
					fileHash: input.fileHash,
					sourceUrl: input.sourceUrl,
					cachePolicy: input.cachePolicy,
					activatedAt: timestamp,
					updatedAt: timestamp,
				},
			});
	}

	private async refreshComments(input: {
		ipVersion: IpVersion;
		dbPath: string;
		dbHash: string;
		cachePolicy: IpRegionConfig["cachePolicy"];
	}): Promise<number> {
		if (!existsSync(input.dbPath) && !this.options.resolveIp) {
			return 0;
		}

		const searcher = this.options.resolveIp
			? null
			: new Ip2Region(input.dbPath, {
					ipVersion: input.ipVersion,
					cachePolicy: input.cachePolicy,
				});

		try {
			return await this.refreshWithResolver(input.dbHash, (ip) => {
				if (this.options.resolveIp) {
					return this.options.resolveIp(ip);
				}
				return parseIpRegionText(searcher?.search(ip).region ?? "");
			});
		} finally {
			searcher?.close();
		}
	}

	private async refreshWithResolver(
		dbHash: string,
		resolveIp: (ip: string) => IpRegionSnapshot,
	): Promise<number> {
		let refreshed = 0;
		for (;;) {
			const rows = await this.listRefreshBatch(dbHash);
			if (rows.length === 0) {
				return refreshed;
			}

			for (const row of rows) {
				const snapshot = resolveIp(row.authorIp);
				await this.updateCommentLocation(row.id, snapshot, dbHash);
				refreshed += 1;
			}

			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}

	private async listRefreshBatch(dbHash: string) {
		return this.db
			.select({
				id: comments.id,
				authorIp: comments.authorIp,
			})
			.from(comments)
			.where(
				and(
					isNotNull(comments.authorIp),
					sql`(${comments.authorIpLocationDbHash} IS NULL OR ${comments.authorIpLocationDbHash} != ${dbHash})`,
				),
			)
			.limit(this.batchSize) as Promise<
			Array<{ id: string; authorIp: string }>
		>;
	}

	private async updateCommentLocation(
		commentId: string,
		snapshot: IpRegionSnapshot,
		dbHash: string,
	) {
		await this.db
			.update(comments)
			.set({
				authorIpCountry: snapshot.country,
				authorIpRegion: snapshot.region,
				authorIpCity: snapshot.city,
				authorIpIsp: snapshot.isp,
				authorIpLocationRaw: snapshot.raw,
				authorIpLocationSource: "ip2region",
				authorIpLocationDbHash: dbHash,
				authorIpLocationUpdatedAt: nowIso(),
				authorIpLocationError: null,
			})
			.where(eq(comments.id, commentId));
	}

	private async record(
		ipVersion: IpVersion,
		input: IpRegionUpdateResult,
	): Promise<IpRegionUpdateResult> {
		const timestamp = nowIso();
		await this.db.insert(ipRegionUpdateRuns).values({
			ipVersion,
			sourceUrl: input.sourceUrl,
			status: input.status,
			previousHash: input.previousHash,
			nextHash: input.nextHash,
			refreshedComments: input.refreshedComments,
			errorMessage: input.errorMessage,
			createdAt: timestamp,
			updatedAt: timestamp,
			activatedAt: input.status === "success" ? timestamp : undefined,
			downloadedAt: input.nextHash ? timestamp : undefined,
		});

		return input;
	}
}
