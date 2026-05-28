import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import {
	commentRequestMetadata,
	comments,
	ipRegionDatabaseState,
	ipRegionUpdateRuns,
	pageThreads,
	sites,
} from "../../src/db/schema";
import {
	calculateFileHash,
	IpRegionUpdater,
} from "../../src/modules/comments/metadata/ip-region-updater";
import { IpRegionAutoUpdateScheduler } from "../../src/modules/comments/metadata/ip-region-scheduler";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { RuntimeSystemSettingsService } from "../../src/modules/system-settings/service";
import { applyInitialMigration } from "../support/test-fixtures";
import { defaultSystemSettings } from "../../src/modules/system-settings/definitions";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

async function createFixture() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-ip-region-"));
	const databaseFile = path.join(directory, "qingyan.db");
	applyInitialMigration(databaseFile);
	const clients = createDatabaseClients(databaseFile);
	cleanups.push(() => {
		clients.sqlite.close();
		rmSync(directory, { recursive: true, force: true });
	});

	return {
		...clients,
		directory,
		config: defaultSystemSettings.ipRegion,
	};
}

async function createDownloadedFile(directory: string, content: string) {
	const filePath = path.join(directory, `downloaded-${content}.xdb`);
	await writeFile(filePath, content);

	return {
		sourceUrl: `https://example.com/${content}.xdb`,
		filePath,
		fileHash: await calculateFileHash(filePath),
	};
}

describe("IpRegionUpdater", () => {
	it("defaults ip region download sources to Gitee before GitHub", () => {
		expect(defaultSystemSettings.ipRegion.ipv4.sources[0]).toContain(
			"gitee.com",
		);
		expect(defaultSystemSettings.ipRegion.ipv4.sources[1]).toContain(
			"raw.githubusercontent.com",
		);
		expect(defaultSystemSettings.ipRegion.ipv6.sources[0]).toContain(
			"gitee.com",
		);
		expect(defaultSystemSettings.ipRegion.ipv6.sources[1]).toContain(
			"raw.githubusercontent.com",
		);
	});

	it("records skipped runs when ip region is disabled", async () => {
		const fixture = await createFixture();
		if (!fixture.config) {
			throw new Error("Expected ip region config");
		}

		const result = await new IpRegionUpdater(fixture.db).update({
			ipVersion: "v4",
			config: {
				...fixture.config,
				enabled: false,
			},
		});

		expect(result).toMatchObject({
			status: "skipped",
			refreshedComments: 0,
			errorMessage: "ip_region_disabled",
		});
		const [run] = await fixture.db.select().from(ipRegionUpdateRuns);
		expect(run).toMatchObject({
			ipVersion: "v4",
			status: "skipped",
			errorMessage: "ip_region_disabled",
		});
	});

	it("records skipped runs when downloaded hash is unchanged", async () => {
		const fixture = await createFixture();
		if (!fixture.config) {
			throw new Error("Expected ip region config");
		}
		const downloaded = await createDownloadedFile(fixture.directory, "same");
		await fixture.db.insert(ipRegionDatabaseState).values({
			ipVersion: "v4",
			filePath: path.join(fixture.directory, "active.xdb"),
			fileHash: downloaded.fileHash,
			sourceUrl: "https://example.com/old.xdb",
			cachePolicy: "vectorIndex",
			activatedAt: "2026-05-05T00:00:00.000Z",
			updatedAt: "2026-05-05T00:00:00.000Z",
		});

		const result = await new IpRegionUpdater(fixture.db, {
			downloadDatabase: async () => downloaded,
		}).update({
			ipVersion: "v4",
			config: {
				...fixture.config,
				enabled: true,
				ipv4: {
					...fixture.config.ipv4,
					dbPath: path.join(fixture.directory, "active-same.xdb"),
				},
			},
		});

		expect(result).toMatchObject({
			status: "skipped",
			previousHash: downloaded.fileHash,
			nextHash: downloaded.fileHash,
			refreshedComments: 0,
		});
	});

	it("activates changed databases and refreshes comments in batches", async () => {
		const fixture = await createFixture();
		if (!fixture.config) {
			throw new Error("Expected ip region config");
		}
		const downloaded = await createDownloadedFile(fixture.directory, "next");
		await fixture.db.insert(sites).values({
			siteKey: "fangyuan",
			name: "FangYuan",
			allowedOriginsJson: "[]",
		});
		await fixture.db.insert(pageThreads).values({
			siteId: 1,
			pageKey: "post:ip-region",
			pageTitle: "IP Region",
			pageUrl: "/posts/ip-region/",
		});
		await fixture.db.insert(comments).values([
			{
				id: "c_refresh",
				siteId: 1,
				pageThreadId: 1,
				status: "approved",
				authorName: "Alice",
				contentRaw: "refresh me",
			},
			{
				id: "c_without_ip",
				siteId: 1,
				pageThreadId: 1,
				status: "approved",
				authorName: "Bob",
				contentRaw: "skip me",
			},
		]);
		await fixture.db.insert(commentRequestMetadata).values({
			commentId: "c_refresh",
			authorIp: "203.0.113.8",
		});

		const result = await new IpRegionUpdater(fixture.db, {
			batchSize: 1,
			downloadDatabase: async () => downloaded,
			resolveIp: () => ({
				country: "中国",
				region: "广东省",
				city: "深圳市",
				isp: "移动",
				raw: "中国|广东省|深圳市|移动|CN",
			}),
		}).update({
			ipVersion: "v4",
			config: {
				...fixture.config,
				enabled: true,
				ipv4: {
					...fixture.config.ipv4,
					dbPath: path.join(fixture.directory, "active-next.xdb"),
				},
			},
		});

		expect(result).toMatchObject({
			status: "success",
			nextHash: downloaded.fileHash,
			refreshedComments: 1,
		});
		const [comment] = await fixture.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, "c_refresh"));
		expect(comment).toMatchObject({
			ipCountry: "中国",
			ipRegion: "广东省",
			ipCity: "深圳市",
			ipLocationDbHash: downloaded.fileHash,
			ipLocationSource: "ip2region",
		});
		const [withoutIp] = await fixture.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, "c_without_ip"));
		expect(withoutIp).toBeUndefined();
	});

	it("loads scheduler update config from database-owned system settings", async () => {
		const fixture = await createFixture();
		if (!fixture.config) {
			throw new Error("Expected ip region config");
		}
		const repository = new AdminSystemSettingsRepository(fixture.db);
		const dbPath = path.join(fixture.directory, "scheduler-v4.xdb");
		await repository.upsert("ipRegion", "enabled", true);
		await repository.upsert("ipRegion", "autoUpdate.enabled", true);
		await repository.upsert("ipRegion", "ipv4.dbPath", dbPath);
		await repository.upsert("ipRegion", "ipv4.sources", [
			"https://example.com/scheduler-v4.xdb",
		]);
		await repository.upsert("ipRegion", "ipv6.sources", [
			"https://example.com/scheduler-v6.xdb",
		]);

		const updateCalls: Array<{
			ipVersion: "v4" | "v6";
			config: typeof fixture.config;
		}> = [];
		const scheduler = new IpRegionAutoUpdateScheduler(
			fixture.db,
			() => new RuntimeSystemSettingsService(fixture.db).getIpRegionSettings(),
			{
				updater: {
					update: async (input) => {
						updateCalls.push(input);
						return {
							status: "failed",
							refreshedComments: 0,
							errorMessage: "all_sources_failed",
						};
					},
				},
			},
		);

		await scheduler.runNow();

		expect(updateCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					ipVersion: "v4",
					config: expect.objectContaining({
						enabled: true,
						autoUpdate: expect.objectContaining({ enabled: true }),
						ipv4: expect.objectContaining({
							dbPath,
							sources: ["https://example.com/scheduler-v4.xdb"],
						}),
					}),
				}),
				expect.objectContaining({
					ipVersion: "v6",
					config: expect.objectContaining({
						enabled: true,
						autoUpdate: expect.objectContaining({ enabled: true }),
						ipv6: expect.objectContaining({
							sources: ["https://example.com/scheduler-v6.xdb"],
						}),
					}),
				}),
			]),
		);
	});
});
