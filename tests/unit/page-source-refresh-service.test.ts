import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { applyDatabaseMigrations } from "../../src/db/migrations";
import {
	pageThreads,
	pendingPageCandidates,
	pendingPageViewSessions,
	sitePageRegistry,
	sites,
} from "../../src/db/schema";
import { PageSourceRefreshService } from "../../src/modules/page-registry/source-refresh-service";
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

function createTaskContext(
	logs: string[] = [],
): Pick<TaskRunnerContext, "log" | "updateProgress" | "signal"> {
	return {
		log: {
			stdout: async () => undefined,
			stderr: async () => undefined,
			system: async () => undefined,
			info: async (message) => {
				logs.push(message);
			},
			warn: async (message) => {
				logs.push(message);
			},
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
		options: {
			allowedOrigins: string[];
			timeoutMs?: number;
			maxBytes?: number;
		},
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

async function runRefresh(
	service: PageSourceRefreshService,
	input: {
		sitemapUrls?: string[];
		mode?: "append" | "replace";
		timeoutMs?: number;
		maxBytes?: number;
	} = {},
) {
	return service.executeRefresh(
		{
			siteKey: "fangyuan",
			sitemapUrls: input.sitemapUrls ?? ["https://example.com/sitemap.xml"],
			mode: input.mode ?? "replace",
			trigger: "manual",
			timeoutMs: input.timeoutMs,
			maxBytes: input.maxBytes,
		},
		createTaskContext(),
	);
}

describe("PageSourceRefreshService", () => {
	it("creates active registry pages from sitemap URL payloads", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const fetchCalls: string[] = [];
		const { service } = createService(fixture, async (url) => {
			fetchCalls.push(url);
			return [
				"<urlset>",
				"<url><loc>https://example.com/posts/a/</loc></url>",
				"<url><loc>https://example.com/posts/b/</loc></url>",
				"</urlset>",
			].join("");
		});

		const result = await runRefresh(service);

		const pages = await fixture.db.select().from(sitePageRegistry);
		expect(fetchCalls).toEqual(["https://example.com/sitemap.xml"]);
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
		expect(result).toMatchObject({
			processed: 2,
			created: 2,
			updated: 0,
			stale: 0,
			skipped: 0,
			failed: 0,
		});
	});

	it("rejects sitemap URLs outside allowed origins before fetch", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const fetchCalls: string[] = [];
		const { service } = createService(fixture, async (url) => {
			fetchCalls.push(url);
			return "<urlset />";
		});

		await expect(
			runRefresh(service, {
				sitemapUrls: ["http://169.254.169.254/latest/meta-data"],
			}),
		).rejects.toThrow("Sitemap URL is outside allowed origins");
		expect(fetchCalls).toEqual([]);
	});

	it("creates active registry pages from sitemap index child sitemaps", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const fetchCalls: Array<{
			url: string;
			options: {
				allowedOrigins: string[];
				timeoutMs?: number;
				maxBytes?: number;
			};
		}> = [];
		const { service } = createService(fixture, async (url, options) => {
			fetchCalls.push({ url, options });
			if (url === "https://example.com/sitemap-index.xml") {
				return [
					"<sitemapindex>",
					"<sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap>",
					"<sitemap><loc>https://example.com/page-sitemap.xml</loc></sitemap>",
					"</sitemapindex>",
				].join("");
			}
			if (url === "https://example.com/post-sitemap.xml") {
				return "<urlset><url><loc>https://example.com/posts/a/</loc></url></urlset>";
			}
			if (url === "https://example.com/page-sitemap.xml") {
				return "<urlset><url><loc>https://example.com/about/</loc></url></urlset>";
			}
			throw new Error(`Unexpected fetch URL: ${url}`);
		});

		const result = await runRefresh(service, {
			sitemapUrls: ["https://example.com/sitemap-index.xml"],
			timeoutMs: 12_000,
			maxBytes: 1_048_576,
		});

		const pages = await fixture.db.select().from(sitePageRegistry);
		expect(pages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					pageKey: "/posts/a/",
					pageUrl: "/posts/a/",
					status: "active",
				}),
				expect.objectContaining({
					pageKey: "/about/",
					pageUrl: "/about/",
					status: "active",
				}),
			]),
		);
		expect(fetchCalls).toEqual([
			{
				url: "https://example.com/sitemap-index.xml",
				options: {
					allowedOrigins: ["https://example.com"],
					timeoutMs: 12_000,
					maxBytes: 1_048_576,
				},
			},
			{
				url: "https://example.com/post-sitemap.xml",
				options: {
					allowedOrigins: ["https://example.com"],
					timeoutMs: 12_000,
					maxBytes: 1_048_576,
				},
			},
			{
				url: "https://example.com/page-sitemap.xml",
				options: {
					allowedOrigins: ["https://example.com"],
					timeoutMs: 12_000,
					maxBytes: 1_048_576,
				},
			},
		]);
		expect(result).toMatchObject({
			processed: 2,
			created: 2,
			updated: 0,
			stale: 0,
			skipped: 0,
			failed: 0,
		});
	});

	it("rejects sitemap index child URLs outside allowed origins", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const fetchCalls: string[] = [];
		const { service } = createService(fixture, async (url) => {
			fetchCalls.push(url);
			if (url === "https://example.com/sitemap-index.xml") {
				return [
					"<sitemapindex>",
					"<sitemap><loc>https://evil.example/sitemap.xml</loc></sitemap>",
					"</sitemapindex>",
				].join("");
			}
			return "<urlset />";
		});

		await expect(
			runRefresh(service, {
				sitemapUrls: ["https://example.com/sitemap-index.xml"],
			}),
		).rejects.toThrow("Sitemap URL is outside allowed origins");
		expect(fetchCalls).toEqual(["https://example.com/sitemap-index.xml"]);
	});

	it("marks missing site pages as stale in replace mode", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		let response = [
			"<urlset>",
			"<url><loc>https://example.com/posts/keep/</loc></url>",
			"<url><loc>https://example.com/posts/missing/</loc></url>",
			"</urlset>",
		].join("");
		const { service } = createService(fixture, async () => response);

		await runRefresh(service);
		response =
			"<urlset><url><loc>https://example.com/posts/keep/</loc></url></urlset>";

		const result = await runRefresh(service);

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

		const result = await runRefresh(service);

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
		await fixture.db.insert(sitePageRegistry).values([
			{
				siteId: 1,
				pageKey: "/posts/stale-seed/",
				pageUrl: "/posts/stale-seed/",
				status: "active",
			},
			{
				siteId: 1,
				pageKey: "/posts/ignored/",
				pageUrl: "/posts/ignored/",
				status: "ignored",
			},
			{
				siteId: 1,
				pageKey: "/posts/missing/",
				pageUrl: "/posts/missing/",
				status: "active",
			},
		]);
		const { service } = createService(fixture, async () =>
			[
				"<urlset>",
				"<url><loc>https://example.com/posts/stale-seed/</loc></url>",
				"<url><loc>https://example.com/posts/ignored/</loc></url>",
				"<url><loc>https://other.example.com/posts/bad/</loc></url>",
				"</urlset>",
			].join(""),
		);

		const result = await runRefresh(service);

		expect(result).toMatchObject({
			processed: 3,
			created: 0,
			updated: 1,
			stale: 1,
			skipped: 1,
			failed: 1,
		});
	});

	it("writes visible refresh counter details into task log messages", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		await fixture.db.insert(sitePageRegistry).values({
			siteId: 1,
			pageKey: "/posts/existing/",
			pageUrl: "/posts/existing/",
			status: "active",
		});
		await fixture.db.insert(pendingPageCandidates).values({
			siteKey: "fangyuan",
			pageKey: "/posts/pending/",
			pageUrl: "/posts/pending/",
			hitCount: 1,
			status: "pending",
		});
		const logs: string[] = [];
		const { service } = createService(fixture, async () =>
			[
				"<urlset>",
				"<url><loc>https://example.com/posts/existing/</loc></url>",
				"<url><loc>https://example.com/posts/new/</loc></url>",
				"<url><loc>https://example.com/posts/pending/</loc></url>",
				"<url><loc>https://other.example.com/posts/bad/</loc></url>",
				"</urlset>",
			].join(""),
		);

		await service.executeRefresh(
			{
				siteKey: "fangyuan",
				sitemapUrls: ["https://example.com/sitemap.xml"],
				mode: "replace",
				trigger: "manual",
			},
			createTaskContext(logs),
		);

		expect(logs).toContain(
			"页面来源结果：处理 4，新增 2，更新 1，过期 0，跳过 0，失败 1，放行待处理 1。",
		);
		expect(logs).toContain(
			"页面来源刷新完成：处理 4，新增 2，更新 1，过期 0，跳过 0，失败 1，放行待处理 1。",
		);
		expect(logs).toContain(
			"页面来源存在失败条目：https://example.com/sitemap.xml，失败 1。",
		);
	});

	it("does not synthesize due refresh inputs without scheduled source records", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const { service } = createService(fixture, async () => "<urlset />");

		const inputs = await service.listDueRefreshInputs(
			new Date("2026-05-29T01:00:00.000Z"),
		);

		expect(inputs).toEqual([]);
	});

	it("auto-approves pending unknown pages when sitemap confirms them", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
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

		const result = await runRefresh(service);

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

	it("queues a lazy title refresh run for entries without title hints", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const { service, titleRefreshRuns } = createService(
			fixture,
			async () =>
				"<urlset><url><loc>https://example.com/posts/title-later/</loc></url></urlset>",
		);

		await runRefresh(service);

		expect(titleRefreshRuns).toEqual([
			{
				siteKey: "fangyuan",
				pageKeys: ["/posts/title-later/"],
			},
		]);
	});

	it("passes task timeout and max bytes to sitemap fetch", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		const fetchCalls: Array<{
			url: string;
			options: {
				allowedOrigins: string[];
				timeoutMs?: number;
				maxBytes?: number;
			};
		}> = [];
		const { service } = createService(fixture, async (url, options) => {
			fetchCalls.push({ url, options });
			return "<urlset><url><loc>https://example.com/posts/options/</loc></url></urlset>";
		});

		await runRefresh(service, {
			timeoutMs: 12_000,
			maxBytes: 1_048_576,
		});

		expect(fetchCalls).toEqual([
			{
				url: "https://example.com/sitemap.xml",
				options: {
					allowedOrigins: ["https://example.com"],
					timeoutMs: 12_000,
					maxBytes: 1_048_576,
				},
			},
		]);
	});
});
