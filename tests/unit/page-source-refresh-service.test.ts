import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { applyDatabaseMigrations } from "../../src/db/migrations";
import {
	maintenanceJobs,
	pageThreads,
	pendingPageCandidates,
	pendingPageViewSessions,
	sitePageRegistry,
	sitePageRegistrySourcePages,
	sites,
} from "../../src/db/schema";
import { MaintenanceJobRepository } from "../../src/modules/ops/maintenance-job-repository";
import { PageSourceRefreshService } from "../../src/modules/page-registry/source-refresh-service";
import { PageSourceRepository } from "../../src/modules/page-registry/source-repository";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

function createFixture() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-page-source-"));
	const databaseFile = path.join(directory, "qingyan.db");
	const clients = createDatabaseClients(databaseFile);
	applyDatabaseMigrations(clients.sqlite);
	cleanups.push(() => {
		clients.sqlite.close();
		rmSync(directory, { recursive: true, force: true });
	});
	return clients;
}

async function seedSite(fixture: ReturnType<typeof createFixture>) {
	await fixture.db.insert(sites).values({
		id: 1,
		siteKey: "fangyuan",
		name: "FangYuan",
		allowedOriginsJson: JSON.stringify(["https://example.com"]),
		createdAt: "2026-05-29T00:00:00.000Z",
		updatedAt: "2026-05-29T00:00:00.000Z",
	});
}

function createService(
	fixture: ReturnType<typeof createFixture>,
	fetchText: (url: string) => Promise<string>,
) {
	const jobs = new MaintenanceJobRepository(fixture.db);
	return new PageSourceRefreshService(fixture.db, jobs, {
		fetchText,
		loadAllowedOriginsForSite: async () => ["https://example.com"],
		createTitleRefreshJob: async (input) => {
			await jobs.create({
				type: "page_metadata_refresh",
				siteKey: input.siteKey,
				scope: {
					siteKey: input.siteKey,
					pageKeys: input.pageKeys,
					onlyMissingTitle: true,
					trigger: "source_refresh",
				},
				concurrencyKey: `page-title:${input.siteKey}`,
			});
		},
	});
}

async function createSource(
	fixture: ReturnType<typeof createFixture>,
	input: {
		sourceType?: "sitemap" | "rss" | "atom";
		sourceUrl?: string;
		mode?: "append" | "replace";
	} = {},
) {
	const repository = new PageSourceRepository(fixture.db);
	return repository.createSource({
		siteId: 1,
		sourceType: input.sourceType ?? "sitemap",
		sourceUrl: input.sourceUrl ?? "https://example.com/sitemap.xml",
		enabled: true,
		mode: input.mode ?? "append",
	});
}

describe("PageSourceRefreshService", () => {
	it("creates active registry pages from sitemap entries", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture);
		const service = createService(fixture, async () =>
			[
				"<urlset>",
				"<url><loc>https://example.com/posts/a/</loc></url>",
				"<url><loc>https://example.com/posts/b/</loc></url>",
				"</urlset>",
			].join(""),
		);

		const job = await service.createRefreshJob({
			siteKey: "fangyuan",
			sourceIds: [source.id],
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const pages = await fixture.db.select().from(sitePageRegistry);
		const sourcePages = await fixture.db
			.select()
			.from(sitePageRegistrySourcePages);

		expect(pages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					pageKey: "posts/a/",
					pageUrl: "/posts/a/",
					status: "active",
				}),
				expect.objectContaining({
					pageKey: "posts/b/",
					pageUrl: "/posts/b/",
					status: "active",
				}),
			]),
		);
		expect(sourcePages).toHaveLength(2);
		expect(
			await new MaintenanceJobRepository(fixture.db).getRequired(job.id),
		).toMatchObject({
			status: "succeeded",
			result: {
				processed: 2,
				created: 2,
				updated: 0,
				stale: 0,
				skipped: 0,
				failed: 0,
			},
		});
	});

	it("stores RSS item titles as registry title hints", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture, {
			sourceType: "rss",
			sourceUrl: "https://example.com/feed.xml",
		});
		const service = createService(
			fixture,
			async () =>
				"<rss><channel><item><title>Hello</title><link>https://example.com/hello/</link></item></channel></rss>",
		);

		await service.createRefreshJob({
			siteKey: "fangyuan",
			sourceIds: [source.id],
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "hello/"));

		expect(page).toMatchObject({
			pageUrl: "/hello/",
			title: "Hello",
			status: "active",
		});
	});

	it("marks missing source-owned pages as stale in replace mode", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture, { mode: "replace" });
		let response = [
			"<urlset>",
			"<url><loc>https://example.com/posts/keep/</loc></url>",
			"<url><loc>https://example.com/posts/missing/</loc></url>",
			"</urlset>",
		].join("");
		const service = createService(fixture, async () => response);

		await service.createRefreshJob({
			siteKey: "fangyuan",
			sourceIds: [source.id],
			trigger: "manual",
		});
		await service.runNextQueuedJob();
		response =
			"<urlset><url><loc>https://example.com/posts/keep/</loc></url></urlset>";

		const secondJob = await service.createRefreshJob({
			siteKey: "fangyuan",
			sourceIds: [source.id],
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const [missing] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/missing/"));

		expect(missing?.status).toBe("stale");
		expect(
			await new MaintenanceJobRepository(fixture.db).getRequired(secondJob.id),
		).toMatchObject({
			result: expect.objectContaining({ processed: 1, stale: 1 }),
		});
	});

	it("does not restore protected page statuses during refresh", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture);
		await fixture.db.insert(sitePageRegistry).values({
			siteId: 1,
			pageKey: "posts/trash/",
			pageUrl: "/old/",
			title: "Old",
			status: "trash",
		});
		const service = createService(
			fixture,
			async () =>
				"<urlset><url><loc>https://example.com/posts/trash/</loc></url></urlset>",
		);

		const job = await service.createRefreshJob({
			siteKey: "fangyuan",
			sourceIds: [source.id],
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/trash/"));

		expect(page).toMatchObject({
			pageUrl: "/posts/trash/",
			status: "trash",
		});
		expect(
			await new MaintenanceJobRepository(fixture.db).getRequired(job.id),
		).toMatchObject({
			result: expect.objectContaining({ skipped: 1, created: 0 }),
		});
	});

	it("reports processed, updated, skipped, failed, and stale counters", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture, { mode: "replace" });
		const repository = new PageSourceRepository(fixture.db);
		const staleSeed = await repository.upsertRegistryPage({
			siteId: 1,
			pageKey: "posts/stale-seed/",
			pageUrl: "/posts/stale-seed/",
			nowIso: "2026-05-29T00:00:00.000Z",
		});
		await repository.attachSourcePage({
			sourceId: source.id,
			pageRegistryId: staleSeed.page.id,
			nowIso: "2026-05-29T00:00:00.000Z",
		});
		await fixture.db.insert(sitePageRegistry).values({
			siteId: 1,
			pageKey: "posts/ignored/",
			pageUrl: "/posts/ignored/",
			status: "ignored",
		});
		const service = createService(fixture, async () =>
			[
				"<urlset>",
				"<url><loc>https://example.com/posts/stale-seed/</loc></url>",
				"<url><loc>https://example.com/posts/ignored/</loc></url>",
				"<url><loc>https://other.example.com/posts/bad/</loc></url>",
				"</urlset>",
			].join(""),
		);

		const job = await service.createRefreshJob({
			siteKey: "fangyuan",
			sourceIds: [source.id],
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const saved = await new MaintenanceJobRepository(fixture.db).getRequired(
			job.id,
		);
		const [owned] = await fixture.db
			.select()
			.from(sitePageRegistrySourcePages)
			.where(
				and(
					eq(sitePageRegistrySourcePages.sourceId, source.id),
					eq(sitePageRegistrySourcePages.pageRegistryId, staleSeed.page.id),
				),
			);

		expect(owned).toBeDefined();
		expect(saved.progress).toMatchObject({
			phase: "refreshing",
			processed: 3,
			updated: 1,
			skipped: 1,
			failed: 1,
		});
		expect(saved.result).toMatchObject({
			processed: 3,
			created: 0,
			updated: 1,
			stale: 0,
			skipped: 1,
			failed: 1,
		});
	});

	it("creates scheduled jobs only for due enabled sources", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const repository = new PageSourceRepository(fixture.db);
		const dueSource = await createSource(fixture, {
			sourceUrl: "https://example.com/due-sitemap.xml",
		});
		const futureSource = await createSource(fixture, {
			sourceUrl: "https://example.com/future-sitemap.xml",
		});
		await repository.updateSource({
			sourceId: dueSource.id,
			patch: { nextRefreshAt: "2026-05-29T00:00:00.000Z" },
		});
		await repository.updateSource({
			sourceId: futureSource.id,
			patch: { nextRefreshAt: "2026-05-29T02:00:00.000Z" },
		});
		const service = createService(fixture, async () => "<urlset />");

		const jobs = await service.runDueSources(
			new Date("2026-05-29T01:00:00.000Z"),
		);

		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.type).toBe("page_source_refresh");
		expect(jobs[0]?.scope).toMatchObject({
			siteKey: "fangyuan",
			sourceIds: [dueSource.id],
			trigger: "scheduled",
		});
	});

	it("auto-approves pending unknown pages when a source confirms them", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture);
		await fixture.db.insert(pendingPageCandidates).values({
			siteKey: "fangyuan",
			pageKey: "posts/source-confirmed/",
			pageUrl: "/posts/source-confirmed/",
			hitCount: 1,
			status: "pending",
		});
		await fixture.db.insert(pendingPageViewSessions).values({
			siteKey: "fangyuan",
			pageKey: "posts/source-confirmed/",
			fingerprint: "visitor-a",
			hitCount: 1,
		});
		const service = createService(
			fixture,
			async () =>
				"<urlset><url><loc>https://example.com/posts/source-confirmed/</loc></url></urlset>",
		);

		const job = await service.createRefreshJob({
			siteKey: "fangyuan",
			sourceIds: [source.id],
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const [candidate] = await fixture.db
			.select()
			.from(pendingPageCandidates)
			.where(eq(pendingPageCandidates.pageKey, "posts/source-confirmed/"));
		const [thread] = await fixture.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "posts/source-confirmed/"));
		const saved = await new MaintenanceJobRepository(fixture.db).getRequired(
			job.id,
		);

		expect(candidate).toMatchObject({ status: "approved" });
		expect(thread).toMatchObject({
			pageKey: "posts/source-confirmed/",
			pageUrl: "/posts/source-confirmed/",
			pageViewCount: 1,
		});
		expect(saved.result).toMatchObject({ approvedPending: 1 });
	});

	it("queues a lazy title refresh job for URL-only source entries", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture);
		const service = createService(
			fixture,
			async () =>
				"<urlset><url><loc>https://example.com/posts/title-later/</loc></url></urlset>",
		);

		await service.createRefreshJob({
			siteKey: "fangyuan",
			sourceIds: [source.id],
			trigger: "manual",
		});
		await service.runNextQueuedJob();

		const jobs = await fixture.db.select().from(maintenanceJobs);
		expect(jobs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "page_metadata_refresh",
					status: "queued",
					siteKey: "fangyuan",
					concurrencyKey: "page-title:fangyuan",
				}),
			]),
		);
		const titleJob = jobs.find((job) => job.type === "page_metadata_refresh");
		expect(titleJob ? JSON.parse(titleJob.scopeJson) : null).toMatchObject({
			siteKey: "fangyuan",
			pageKeys: ["posts/title-later/"],
			onlyMissingTitle: true,
			trigger: "source_refresh",
		});
	});
});
