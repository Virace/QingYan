import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { applyDatabaseMigrations } from "../../src/db/migrations";
import {
	commentRequestMetadata,
	comments,
	ipRegionDatabaseState,
	pageThreads,
	sites,
} from "../../src/db/schema";
import { CommentIpMaintenanceService } from "../../src/modules/comments/metadata/comment-ip-maintenance-service";
import type { TaskRunnerContext } from "../../src/modules/tasks/task-runner-context";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

function createFixture() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-maintenance-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const clients = createDatabaseClients(databaseFile);
	applyDatabaseMigrations(clients.sqlite);
	cleanups.push(() => {
		clients.sqlite.close();
		rmSync(directory, { recursive: true, force: true });
	});
	return clients;
}

function createTaskContext(): Pick<
	TaskRunnerContext,
	"log" | "updateProgress" | "signal"
> {
	return {
		log: {
			stdout: async () => undefined,
			stderr: async () => undefined,
			system: async () => undefined,
			info: async () => undefined,
			warn: async () => undefined,
			error: async () => undefined,
			debug: async () => undefined,
			write: async () => undefined,
		},
		updateProgress: async () => undefined,
	};
}

async function seedCommentMetadata(fixture: ReturnType<typeof createFixture>) {
	await fixture.db.insert(sites).values({
		id: 1,
		siteKey: "fangyuan",
		name: "FangYuan",
		allowedOriginsJson: "[]",
		createdAt: "2026-05-29T00:00:00.000Z",
		updatedAt: "2026-05-29T00:00:00.000Z",
	});
	await fixture.db.insert(pageThreads).values({
		id: 1,
		siteId: 1,
		pageKey: "post:test",
		pageUrl: "/post/test",
	});
	await fixture.db.insert(comments).values([
		{
			id: "c_missing",
			siteId: 1,
			pageThreadId: 1,
			status: "approved",
			authorName: "A",
			contentRaw: "A",
		},
		{
			id: "c_failed",
			siteId: 1,
			pageThreadId: 1,
			status: "approved",
			authorName: "B",
			contentRaw: "B",
		},
		{
			id: "c_stale",
			siteId: 1,
			pageThreadId: 1,
			status: "approved",
			authorName: "C",
			contentRaw: "C",
		},
	]);
	await fixture.db.insert(commentRequestMetadata).values([
		{ commentId: "c_missing", authorIp: "203.0.113.1" },
		{
			commentId: "c_failed",
			authorIp: "203.0.113.2",
			ipLocationError: "old_error",
			ipLocationUpdatedAt: "2026-01-01T00:00:00.000Z",
		},
		{
			commentId: "c_stale",
			authorIp: "203.0.113.3",
			ipLocationDbHash: "old_hash",
			ipLocationUpdatedAt: "2026-01-01T00:00:00.000Z",
		},
	]);
	await fixture.db.insert(ipRegionDatabaseState).values({
		ipVersion: "v4",
		filePath: "./data/ip2region_v4.xdb",
		fileHash: "new_hash",
		sourceUrl: "test",
		cachePolicy: "file",
		activatedAt: "2026-05-29T00:00:00.000Z",
		updatedAt: "2026-05-29T00:00:00.000Z",
	});
}

function createLocationService(fixture: ReturnType<typeof createFixture>) {
	return new CommentIpMaintenanceService(fixture.db, {
		resolveIp: () => ({
			country: "中国",
			region: "浙江省",
			city: "杭州市",
			isp: "移动",
			raw: "中国|浙江省|杭州市|移动",
		}),
	});
}

describe("CommentIpMaintenanceService", () => {
	it("refreshes only missing IP locations when scope is missing", async () => {
		const fixture = createFixture();
		await seedCommentMetadata(fixture);
		const service = createLocationService(fixture);

		const result = await service.executeCommentIpRefresh(
			{
				scope: "missing",
				ipVersions: ["v4"],
				siteKey: "fangyuan",
				batchSize: 10,
			},
			createTaskContext(),
		);

		const refreshed = await fixture.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, "c_missing"));
		const failed = await fixture.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, "c_failed"));

		expect(result).toMatchObject({ processed: 1, refreshed: 1, failed: 0 });
		expect(refreshed[0]?.ipLocationDbHash).toBe("new_hash");
		expect(failed[0]?.ipLocationError).toBe("old_error");
	});

	it("refreshes all matching IP locations without reprocessing updated rows", async () => {
		const fixture = createFixture();
		await seedCommentMetadata(fixture);
		const service = createLocationService(fixture);

		const result = await service.executeCommentIpRefresh(
			{
				scope: "all",
				ipVersions: ["v4"],
				siteKey: "fangyuan",
				batchSize: 1,
			},
			createTaskContext(),
		);

		expect(result).toMatchObject({
			processed: 3,
			refreshed: 3,
			failed: 0,
		});
	});

	it("passes IP update task timeout to the updater", async () => {
		const fixture = createFixture();
		await seedCommentMetadata(fixture);
		const updates: Array<{
			ipVersion: string;
			timeoutMs?: number;
		}> = [];
		const service = new CommentIpMaintenanceService(fixture.db, {
			loadIpRegionSettings: async () => ({
				enabled: true,
				cachePolicy: "file",
				precision: "city",
				autoUpdate: { enabled: false, schedule: "monthly" },
				ipv4: {
					dbPath: "./data/ip2region_v4.xdb",
					sources: ["https://example.com/v4.xdb"],
				},
				ipv6: {
					dbPath: "./data/ip2region_v6.xdb",
					sources: ["https://example.com/v6.xdb"],
				},
			}),
			updater: {
				update: async (input) => {
					updates.push({
						ipVersion: input.ipVersion,
						timeoutMs: input.timeoutMs,
					});
					return {
						status: "skipped",
						refreshedComments: 0,
					};
				},
			},
		});

		const result = await service.executeIpRegionUpdate(
			{
				ipVersions: ["v4"],
				timeoutMs: 15_000,
			},
			createTaskContext(),
		);

		expect(updates).toEqual([{ ipVersion: "v4", timeoutMs: 15_000 }]);
		expect(result).toMatchObject({
			results: [
				{
					ipVersion: "v4",
					result: { status: "skipped", refreshedComments: 0 },
				},
			],
		});
	});

	it("treats missing database hash as stale when location was already updated", async () => {
		const fixture = createFixture();
		await seedCommentMetadata(fixture);
		await fixture.db
			.update(commentRequestMetadata)
			.set({
				ipLocationUpdatedAt: "2026-01-01T00:00:00.000Z",
				ipLocationDbHash: null,
			})
			.where(eq(commentRequestMetadata.commentId, "c_missing"));
		await fixture.db
			.update(commentRequestMetadata)
			.set({
				ipLocationDbHash: "new_hash",
			})
			.where(eq(commentRequestMetadata.commentId, "c_failed"));
		const service = createLocationService(fixture);

		const result = await service.executeCommentIpRefresh(
			{
				scope: "stale",
				ipVersions: ["v4"],
				siteKey: "fangyuan",
				batchSize: 10,
			},
			createTaskContext(),
		);

		expect(result).toMatchObject({
			processed: 2,
			refreshed: 2,
			failed: 0,
		});
	});
});
