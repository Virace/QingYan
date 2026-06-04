import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { applyDatabaseMigrations } from "../../src/db/migrations";
import { sitePageRegistry, sites } from "../../src/db/schema";
import { PageMetadataRefreshService } from "../../src/modules/page-registry/title-refresh-service";
import type { TaskRunnerContext } from "../../src/modules/tasks/task-runner-context";

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
	fetchHtml: (
		url: string,
		options: { timeoutMs: number; maxBytes: number },
	) => Promise<{ status: number; text: string }>,
) {
	return new PageMetadataRefreshService(fixture.db, {
		fetchHtml,
		now: () => new Date("2026-05-29T00:00:00.000Z"),
		settings: {
			batchSize: 50,
			timeoutMs: 8000,
			maxBytes: 512 * 1024,
		},
	});
}

describe("PageMetadataRefreshService", () => {
	it("refreshes a page title from same-origin HTML", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const service = createService(fixture, async (url) => {
			expect(url).toBe("https://example.com/posts/ok/");
			return {
				status: 200,
				text: "<html><head><title>Hello &amp; QingYan</title></head></html>",
			};
		});

		const result = await service.executeRefresh(
			{
				siteKey: "fangyuan",
				pageKeys: ["posts/ok/"],
				forceTitle: true,
				trigger: "manual",
			},
			createTaskContext(),
		);

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
		expect(result).toMatchObject({ processed: 1, updated: 1, failed: 0 });
	});

	it("marks 404 pages as not_found", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const service = createService(fixture, async () => ({
			status: 404,
			text: "",
		}));

		const result = await service.executeRefresh(
			{
				siteKey: "fangyuan",
				pageKeys: ["posts/missing/"],
				forceTitle: true,
				trigger: "manual",
			},
			createTaskContext(),
		);

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/missing/"));
		expect(page).toMatchObject({
			status: "not_found",
			titleRefreshStatusCode: 404,
			titleRefreshError: "http_404",
		});
		expect(result).toMatchObject({
			processed: 1,
			updated: 0,
			failed: 1,
			errors: [{ pageKey: "posts/missing/", message: "http_404" }],
		});
	});

	it("marks non-200 pages as unreachable", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const service = createService(fixture, async () => ({
			status: 500,
			text: "",
		}));

		const result = await service.executeRefresh(
			{
				siteKey: "fangyuan",
				pageKeys: ["posts/server-error/"],
				forceTitle: true,
				trigger: "manual",
			},
			createTaskContext(),
		);

		const [page] = await fixture.db
			.select()
			.from(sitePageRegistry)
			.where(eq(sitePageRegistry.pageKey, "posts/server-error/"));
		expect(page).toMatchObject({
			status: "unreachable",
			titleRefreshStatusCode: 500,
			titleRefreshError: "http_500",
		});
		expect(result).toMatchObject({
			processed: 1,
			updated: 0,
			failed: 1,
			errors: [{ pageKey: "posts/server-error/", message: "http_500" }],
		});
	});

	it("records errors without restoring protected statuses", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const service = createService(fixture, async () => {
			throw new Error("timeout");
		});

		await service.executeRefresh(
			{
				siteKey: "fangyuan",
				pageKeys: ["posts/trash/"],
				forceTitle: true,
				trigger: "manual",
			},
			createTaskContext(),
		);

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

	it("passes task timeout and max bytes to HTML fetch", async () => {
		const fixture = createFixture();
		await seedSiteAndPages(fixture);
		const seenOptions: Array<{ timeoutMs: number; maxBytes: number }> = [];
		const service = createService(fixture, async (_url, options) => {
			seenOptions.push(options);
			return {
				status: 200,
				text: "<title>Fresh</title>",
			};
		});

		await service.executeRefresh(
			{
				siteKey: "fangyuan",
				pageKeys: ["posts/ok/"],
				forceTitle: true,
				trigger: "manual",
				timeoutMs: 4500,
				maxBytes: 131072,
			},
			createTaskContext(),
		);

		expect(seenOptions).toEqual([{ timeoutMs: 4500, maxBytes: 131072 }]);
	});
});
