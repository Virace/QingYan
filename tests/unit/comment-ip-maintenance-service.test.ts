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
import { MaintenanceJobRepository } from "../../src/modules/ops/maintenance-job-repository";

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

describe("MaintenanceJobRepository", () => {
	it("creates and updates a maintenance job", async () => {
		const fixture = createFixture();
		const repository = new MaintenanceJobRepository(fixture.db);

		const job = await repository.create({
			type: "comment_ip_refresh",
			scope: { scope: "missing" },
		});

		expect(job.status).toBe("queued");

		await repository.markRunning(job.id, { total: 10, processed: 0 });
		await repository.markSucceeded(job.id, { refreshed: 3 });

		const saved = await repository.get(job.id);
		expect(saved).toMatchObject({
			id: job.id,
			type: "comment_ip_refresh",
			status: "succeeded",
		});
		expect(saved?.result).toEqual({ refreshed: 3 });
	});

	it("stores scheduling metadata and returns runnable jobs by concurrency key", async () => {
		const fixture = createFixture();
		const repository = new MaintenanceJobRepository(fixture.db);

		const delayed = await repository.create({
			type: "page_metadata_refresh",
			siteKey: "fangyuan",
			scope: { siteKey: "fangyuan" },
			runAfter: "2026-05-29T01:00:00.000Z",
			maxAttempts: 3,
			retryDelaySec: 60,
			concurrencyKey: "page-title:fangyuan",
		});
		const runnable = await repository.create({
			type: "page_metadata_refresh",
			siteKey: "fangyuan",
			scope: { siteKey: "fangyuan", pageKeys: ["posts/a/"] },
			runAfter: "2026-05-29T00:00:00.000Z",
			concurrencyKey: "page-title:fangyuan:posts/a/",
		});

		expect(delayed).toMatchObject({
			status: "delayed",
			siteKey: "fangyuan",
			attempts: 0,
			maxAttempts: 3,
			retryDelaySec: 60,
			concurrencyKey: "page-title:fangyuan",
		});
		await repository.markRunning(runnable.id, { processed: 0 });

		const jobs = await repository.listRunnable({
			nowIso: "2026-05-29T00:30:00.000Z",
			limit: 10,
			maxConcurrentTotal: 2,
			maxConcurrentByType: { page_metadata_refresh: 2 },
		});

		expect(jobs.map((job) => job.id)).not.toContain(delayed.id);
		expect(jobs.map((job) => job.id)).not.toContain(runnable.id);
	});

	it("marks failed jobs as retrying until max attempts is reached", async () => {
		const fixture = createFixture();
		const repository = new MaintenanceJobRepository(fixture.db);
		const job = await repository.create({
			type: "page_metadata_refresh",
			scope: { siteKey: "fangyuan" },
			maxAttempts: 2,
			retryDelaySec: 30,
		});

		await repository.markRunning(job.id, { processed: 0 });
		const retrying = await repository.markFailedOrRetry(job.id, {
			error: { message: "network" },
			nowIso: "2026-05-29T00:00:00.000Z",
		});

		expect(retrying).toMatchObject({
			status: "retrying",
			attempts: 1,
			error: { message: "network" },
			runAfter: "2026-05-29T00:00:30.000Z",
		});

		await repository.markRunning(job.id, { processed: 0 });
		const failed = await repository.markFailedOrRetry(job.id, {
			error: { message: "still failing" },
			nowIso: "2026-05-29T00:01:00.000Z",
		});

		expect(failed).toMatchObject({
			status: "failed",
			attempts: 2,
			error: { message: "still failing" },
		});
	});
});

describe("CommentIpMaintenanceService", () => {
	it("refreshes only missing IP locations when scope is missing", async () => {
		const fixture = createFixture();
		await seedCommentMetadata(fixture);
		const repository = new MaintenanceJobRepository(fixture.db);
		const service = new CommentIpMaintenanceService(fixture.db, repository, {
			resolveIp: () => ({
				country: "中国",
				region: "浙江省",
				city: "杭州市",
				isp: "移动",
				raw: "中国|浙江省|杭州市|移动",
			}),
		});

		const job = await service.createCommentIpRefreshJob({
			scope: "missing",
			ipVersions: ["v4"],
			siteKey: "fangyuan",
			batchSize: 10,
		});
		await service.runNextQueuedJob();

		const refreshed = await fixture.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, "c_missing"));
		const failed = await fixture.db
			.select()
			.from(commentRequestMetadata)
			.where(eq(commentRequestMetadata.commentId, "c_failed"));

		expect((await repository.getRequired(job.id)).status).toBe("succeeded");
		expect(refreshed[0]?.ipLocationDbHash).toBe("new_hash");
		expect(failed[0]?.ipLocationError).toBe("old_error");
	});

	it("refreshes all matching IP locations without reprocessing updated rows", async () => {
		const fixture = createFixture();
		await seedCommentMetadata(fixture);
		const repository = new MaintenanceJobRepository(fixture.db);
		const service = new CommentIpMaintenanceService(fixture.db, repository, {
			resolveIp: () => ({
				country: "中国",
				region: "浙江省",
				city: "杭州市",
				isp: "移动",
				raw: "中国|浙江省|杭州市|移动",
			}),
		});

		const job = await service.createCommentIpRefreshJob({
			scope: "all",
			ipVersions: ["v4"],
			siteKey: "fangyuan",
			batchSize: 1,
		});
		await service.runNextQueuedJob();

		expect((await repository.getRequired(job.id)).result).toMatchObject({
			processed: 3,
			refreshed: 3,
			failed: 0,
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
		const repository = new MaintenanceJobRepository(fixture.db);
		const service = new CommentIpMaintenanceService(fixture.db, repository, {
			resolveIp: () => ({
				country: "中国",
				region: "浙江省",
				city: "杭州市",
				isp: "移动",
				raw: "中国|浙江省|杭州市|移动",
			}),
		});

		const job = await service.createCommentIpRefreshJob({
			scope: "stale",
			ipVersions: ["v4"],
			siteKey: "fangyuan",
			batchSize: 10,
		});
		await service.runNextQueuedJob();

		expect((await repository.getRequired(job.id)).result).toMatchObject({
			processed: 2,
			refreshed: 2,
			failed: 0,
		});
	});
});
