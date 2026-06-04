import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { applyDatabaseMigrations } from "../../src/db/migrations";
import {
	pageThreads,
	pendingPageCandidates,
	pendingPageViewSessions,
	sitePageRegistry,
	sitePageRegistrySourcePages,
	sites,
} from "../../src/db/schema";
import { PageSourceRefreshService } from "../../src/modules/page-registry/source-refresh-service";
import { PageSourceRepository } from "../../src/modules/page-registry/source-repository";
import type { TaskRunnerContext } from "../../src/modules/tasks/task-runner-context";

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
	fetchText: (
		url: string,
		options: { timeoutMs?: number; maxBytes?: number },
	) => Promise<string>,
) {
	const titleRefreshRuns: Array<{ siteKey: string; pageKeys: string[] }> = [];
	return {
		titleRefreshRuns,
		service: new PageSourceRefreshService(fixture.db, {
			fetchText,
			loadAllowedOriginsForSite: async () => ["https://example.com"],
			createTitleRefreshRun: async (input) => {
				titleRefreshRuns.push(input);
			},
		}),
	};
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
		const { service } = createService(fixture, async () =>
			[
				"<urlset>",
				"<url><loc>https://example.com/posts/a/</loc></url>",
				"<url><loc>https://example.com/posts/b/</loc></url>",
				"</urlset>",
			].join(""),
		);

		const result = await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sourceIds: [source.id],
				trigger: "manual",
			},
			createTaskContext(),
		);

		const pages = await fixture.db.select().from(sitePageRegistry);
		const sourcePages = await fixture.db
			.select()
			.from(sitePageRegistrySourcePages);

		expect(pages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					pageKey: "/posts/a/",
					pageUrl: "/posts/a/",
					status: "active",
				}),
				expect.objectContaining({
					pageKey: "/posts/b/",
					pageUrl: "/posts/b/",
					status: "active",
				}),
			]),
		);
		expect(sourcePages).toHaveLength(2);
		expect(result).toMatchObject({
			processed: 2,
			created: 2,
			updated: 0,
			stale: 0,
			skipped: 0,
			failed: 0,
		});
	});

	it("stores RSS item titles as registry title hints", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture, {
			sourceType: "rss",
			sourceUrl: "https://example.com/feed.xml",
		});
		const { service } = createService(
			fixture,
			async () =>
				"<rss><channel><item><title>Hello</title><link>https://example.com/hello/</link></item></channel></rss>",
		);

		await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sourceIds: [source.id],
				trigger: "manual",
			},
			createTaskContext(),
		);

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "/hello/"));

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
		const { service } = createService(fixture, async () => response);

		await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sourceIds: [source.id],
				trigger: "manual",
			},
			createTaskContext(),
		);
		response =
			"<urlset><url><loc>https://example.com/posts/keep/</loc></url></urlset>";

		const result = await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sourceIds: [source.id],
				trigger: "manual",
			},
			createTaskContext(),
		);

		const [missing] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "/posts/missing/"));

		expect(missing?.status).toBe("stale");
		expect(result).toMatchObject({ processed: 1, stale: 1 });
	});

	it("does not restore protected page statuses during refresh", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture);
		await fixture.db.insert(sitePageRegistry).values({
			siteId: 1,
			pageKey: "/posts/trash/",
			pageUrl: "/old/",
			title: "Old",
			status: "trash",
		});
		const { service } = createService(
			fixture,
			async () =>
				"<urlset><url><loc>https://example.com/posts/trash/</loc></url></urlset>",
		);

		const result = await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sourceIds: [source.id],
				trigger: "manual",
			},
			createTaskContext(),
		);

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "/posts/trash/"));

		expect(page).toMatchObject({
			pageUrl: "/posts/trash/",
			status: "trash",
		});
		expect(result).toMatchObject({ skipped: 1, created: 0 });
	});

	it("reports processed, updated, skipped, failed, and stale counters", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture, { mode: "replace" });
		const repository = new PageSourceRepository(fixture.db);
		const staleSeed = await repository.upsertRegistryPage({
			siteId: 1,
			pageKey: "/posts/stale-seed/",
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
			pageKey: "/posts/ignored/",
			pageUrl: "/posts/ignored/",
			status: "ignored",
		});
		const { service } = createService(fixture, async () =>
			[
				"<urlset>",
				"<url><loc>https://example.com/posts/stale-seed/</loc></url>",
				"<url><loc>https://example.com/posts/ignored/</loc></url>",
				"<url><loc>https://other.example.com/posts/bad/</loc></url>",
				"</urlset>",
			].join(""),
		);

		const result = await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sourceIds: [source.id],
				trigger: "manual",
			},
			createTaskContext(),
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
		expect(result).toMatchObject({
			processed: 3,
			created: 0,
			updated: 1,
			stale: 0,
			skipped: 1,
			failed: 1,
		});
	});

	it("returns due refresh inputs only for due enabled sources", async () => {
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
		const { service } = createService(fixture, async () => "<urlset />");

		const inputs = await service.listDueRefreshInputs(
			new Date("2026-05-29T01:00:00.000Z"),
		);

		expect(inputs).toEqual([
			{
				siteKey: "fangyuan",
				sourceIds: [dueSource.id],
				trigger: "scheduled",
			},
		]);
	});

	it("auto-approves pending unknown pages when a source confirms them", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture);
		await fixture.db.insert(pendingPageCandidates).values({
			siteKey: "fangyuan",
			pageKey: "/posts/source-confirmed/",
			pageUrl: "/posts/source-confirmed/",
			hitCount: 1,
			status: "pending",
		});
		await fixture.db.insert(pendingPageViewSessions).values({
			siteKey: "fangyuan",
			pageKey: "/posts/source-confirmed/",
			fingerprint: "visitor-a",
			hitCount: 1,
		});
		const { service } = createService(
			fixture,
			async () =>
				"<urlset><url><loc>https://example.com/posts/source-confirmed/</loc></url></urlset>",
		);

		const result = await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sourceIds: [source.id],
				trigger: "manual",
			},
			createTaskContext(),
		);

		const [candidate] = await fixture.db
			.select()
			.from(pendingPageCandidates)
			.where(eq(pendingPageCandidates.pageKey, "/posts/source-confirmed/"));
		const [thread] = await fixture.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "/posts/source-confirmed/"));

		expect(candidate).toMatchObject({ status: "approved" });
		expect(thread).toMatchObject({
			pageKey: "/posts/source-confirmed/",
			pageUrl: "/posts/source-confirmed/",
			pageViewCount: 1,
		});
		expect(result).toMatchObject({ approvedPending: 1 });
	});

	it("queues a lazy title refresh run for URL-only source entries", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture);
		const { service, titleRefreshRuns } = createService(
			fixture,
			async () =>
				"<urlset><url><loc>https://example.com/posts/title-later/</loc></url></urlset>",
		);

		await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sourceIds: [source.id],
				trigger: "manual",
			},
			createTaskContext(),
		);

		expect(titleRefreshRuns).toEqual([
			{
				siteKey: "fangyuan",
				pageKeys: ["/posts/title-later/"],
			},
		]);
	});

	it("passes task timeout and max bytes to source fetch", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const source = await createSource(fixture);
		const fetchCalls: Array<{
			url: string;
			options: { timeoutMs?: number; maxBytes?: number };
		}> = [];
		const { service } = createService(fixture, async (url, options) => {
			fetchCalls.push({ url, options });
			return "<urlset><url><loc>https://example.com/posts/options/</loc></url></urlset>";
		});

		await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sourceIds: [source.id],
				trigger: "manual",
				timeoutMs: 12_000,
				maxBytes: 1_048_576,
			},
			createTaskContext(),
		);

		expect(fetchCalls).toEqual([
			{
				url: "https://example.com/sitemap.xml",
				options: {
					timeoutMs: 12_000,
					maxBytes: 1_048_576,
				},
			},
		]);
	});
});
