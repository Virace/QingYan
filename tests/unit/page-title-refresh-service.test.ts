import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { applyDatabaseMigrations } from "../../src/db/migrations";
import { maintenanceJobs, sitePageRegistry, sites } from "../../src/db/schema";
import { MaintenanceJobRepository } from "../../src/modules/ops/maintenance-job-repository";
import { PageMetadataRefreshService } from "../../src/modules/page-registry/title-refresh-service";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

function createFixture() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-title-refresh-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const clients = createDatabaseClients(databaseFile);
	applyDatabaseMigrations(clients.sqlite);
	cleanups.push(() => {
		clients.sqlite.close();
		rmSync(directory, { recursive: true, force: true });
	});
	return clients;
}

async function seedSiteAndPages(fixture: ReturnType<typeof createFixture>) {
	await fixture.db.insert(sites).values({
		id: 1,
		siteKey: "fangyuan",
		name: "FangYuan",
		allowedOriginsJson: JSON.stringify(["https://example.com"]),
		createdAt: "2026-05-29T00:00:00.000Z",
		updatedAt: "2026-05-29T00:00:00.000Z",
	});
	await fixture.db.insert(sitePageRegistry).values([
		{
			siteId: 1,
			pageKey: "posts/ok/",
			pageUrl: "/posts/ok/",
			title: null,
			status: "active",
		},
		{
			siteId: 1,
			pageKey: "posts/missing/",
			pageUrl: "/posts/missing/",
			title: null,
			status: "active",
		},
		{
			siteId: 1,
			pageKey: "posts/server-error/",
			pageUrl: "/posts/server-error/",
			title: null,
			status: "active",
		},
		{
			siteId: 1,
			pageKey: "posts/trash/",
			pageUrl: "/posts/trash/",
			title: "Old Trash",
			status: "trash",
		},
	]);
}

function createService(
	fixture: ReturnType<typeof createFixture>,
	fetchHtml: (url: string) => Promise<{ status: number; text: string }>,
) {
	const jobs = new MaintenanceJobRepository(fixture.db);
	return {
		jobs,
		service: new PageMetadataRefreshService(fixture.db, jobs, {
			fetchHtml,
			now: () => new Date("2026-05-29T00:00:00.000Z"),
			settings: {
				batchSize: 50,
				timeoutMs: 8000,
				maxBytes: 512 * 1024,
			},
		}),
	};
}

describe("PageMetadataRefreshService", () => {
	it("refreshes a page title from same-origin HTML", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const { service, jobs } = createService(fixture, async (url) => {
			expect(url).toBe("https://example.com/posts/ok/");
			return {
				status: 200,
				text: "<html><head><title>Hello &amp; QingYan</title></head></html>",
			};
		});

		const job = await service.createRefreshJob({
			siteKey: "fangyuan",
			pageKeys: ["posts/ok/"],
			forceTitle: true,
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/ok/"));
		expect(page).toMatchObject({
			title: "Hello & QingYan",
			status: "active",
			titleRefreshStatusCode: 200,
			titleRefreshError: null,
			titleRefreshedAt: "2026-05-29T00:00:00.000Z",
		});
		expect(await jobs.getRequired(job.id)).toMatchObject({
			status: "succeeded",
			result: { processed: 1, updated: 1, failed: 0 },
		});
	});

	it("marks 404 pages as not_found", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const { service, jobs } = createService(fixture, async () => ({
			status: 404,
			text: "",
		}));

		const job = await service.createRefreshJob({
			siteKey: "fangyuan",
			pageKeys: ["posts/missing/"],
			forceTitle: true,
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/missing/"));
		expect(page).toMatchObject({
			status: "not_found",
			titleRefreshStatusCode: 404,
			titleRefreshError: "http_404",
		});
		expect(await jobs.getRequired(job.id)).toMatchObject({
			status: "succeeded",
			result: {
				processed: 1,
				updated: 0,
				failed: 1,
				errors: [{ pageKey: "posts/missing/", message: "http_404" }],
			},
		});
	});

	it("marks non-200 pages as unreachable", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const { service, jobs } = createService(fixture, async () => ({
			status: 500,
			text: "",
		}));

		const job = await service.createRefreshJob({
			siteKey: "fangyuan",
			pageKeys: ["posts/server-error/"],
			forceTitle: true,
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/server-error/"));
		expect(page).toMatchObject({
			status: "unreachable",
			titleRefreshStatusCode: 500,
			titleRefreshError: "http_500",
		});
		expect(await jobs.getRequired(job.id)).toMatchObject({
			status: "succeeded",
			result: {
				processed: 1,
				updated: 0,
				failed: 1,
				errors: [{ pageKey: "posts/server-error/", message: "http_500" }],
			},
		});
	});

	it("records errors without restoring protected statuses", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const { service } = createService(fixture, async () => {
			throw new Error("timeout");
		});

		await service.createRefreshJob({
			siteKey: "fangyuan",
			pageKeys: ["posts/trash/"],
			forceTitle: true,
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/trash/"));
		expect(page).toMatchObject({
			status: "trash",
			title: "Old Trash",
			titleRefreshStatusCode: null,
			titleRefreshError: "timeout",
		});
	});

	it("creates durable page metadata refresh jobs", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const { service } = createService(fixture, async () => ({
			status: 200,
			text: "<title>Ignored</title>",
		}));

		const job = await service.createRefreshJob({
			siteKey: "fangyuan",
			onlyMissingTitle: true,
			trigger: "manual",
			runAfter: "2026-05-29T00:30:00.000Z",
			maxAttempts: 3,
			retryDelaySec: 90,
		});

		const [row] = await fixture.db
			.select()
			.from(maintenanceJobs)
			.where(eq(maintenanceJobs.id, job.id));
		expect(row).toMatchObject({
			type: "page_metadata_refresh",
			status: "delayed",
			siteKey: "fangyuan",
			runAfter: "2026-05-29T00:30:00.000Z",
			maxAttempts: 3,
			retryDelaySec: 90,
			concurrencyKey: "page-title:fangyuan",
		});
	});
});
