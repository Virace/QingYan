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
import { PageRegistryService } from "../../src/modules/page-registry/service";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

function createFixture() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-page-registry-"));
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
		createdAt: "2026-05-30T00:00:00.000Z",
		updatedAt: "2026-05-30T00:00:00.000Z",
	});
}

async function seedPendingCandidate(
	fixture: ReturnType<typeof createFixture>,
	pageKey: string,
) {
	await fixture.db.insert(pendingPageCandidates).values({
		siteKey: "fangyuan",
		pageKey,
		pageUrl: `/${pageKey}`,
		hitCount: 3,
		status: "pending",
	});
	await fixture.db.insert(pendingPageViewSessions).values([
		{
			siteKey: "fangyuan",
			pageKey,
			fingerprint: `${pageKey}:a`,
		},
		{
			siteKey: "fangyuan",
			pageKey,
			fingerprint: `${pageKey}:b`,
		},
		{
			siteKey: "fangyuan",
			pageKey,
			fingerprint: `${pageKey}:c`,
		},
	]);
}

describe("PageRegistryService.reconcileRegisteredPendingCandidates", () => {
	it("merges registered pending PV into an official page thread once", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		await fixture.db.insert(sitePageRegistry).values({
			siteId: 1,
			pageKey: "posts/registered-pending/",
			pageUrl: "/posts/registered-pending/",
			status: "active",
		});
		await seedPendingCandidate(fixture, "posts/registered-pending/");
		const service = new PageRegistryService(fixture.db);

		const summary = await service.reconcileRegisteredPendingCandidates({
			siteKey: "fangyuan",
		});

		expect(summary).toEqual({
			matchedCandidates: 1,
			createdThreads: 1,
			reusedThreads: 0,
			mergedPendingPv: 3,
			approvedCandidates: 1,
		});
		const [thread] = await fixture.db.select().from(pageThreads);
		expect(thread).toMatchObject({
			siteId: 1,
			pageKey: "posts/registered-pending/",
			pageUrl: "/posts/registered-pending/",
			pageViewCount: 3,
		});
		const [candidate] = await fixture.db
			.select()
			.from(pendingPageCandidates)
			.where(eq(pendingPageCandidates.pageKey, "posts/registered-pending/"));
		expect(candidate?.status).toBe("approved");

		const secondSummary = await service.reconcileRegisteredPendingCandidates({
			siteKey: "fangyuan",
		});
		expect(secondSummary).toEqual({
			matchedCandidates: 0,
			createdThreads: 0,
			reusedThreads: 0,
			mergedPendingPv: 0,
			approvedCandidates: 0,
		});
		const [updatedThread] = await fixture.db.select().from(pageThreads);
		expect(updatedThread?.pageViewCount).toBe(3);
	});

	it("does not reconcile pending candidates without an active or stale registry page", async () => {
		const fixture = createFixture();
		await seedSite(fixture);
		await seedPendingCandidate(fixture, "posts/missing-registry/");
		await fixture.db.insert(sitePageRegistry).values({
			siteId: 1,
			pageKey: "posts/ignored-registry/",
			pageUrl: "/posts/ignored-registry/",
			status: "ignored",
		});
		await seedPendingCandidate(fixture, "posts/ignored-registry/");
		const service = new PageRegistryService(fixture.db);

		const summary = await service.reconcileRegisteredPendingCandidates({
			siteKey: "fangyuan",
		});

		expect(summary).toEqual({
			matchedCandidates: 0,
			createdThreads: 0,
			reusedThreads: 0,
			mergedPendingPv: 0,
			approvedCandidates: 0,
		});
		expect(await fixture.db.select().from(pageThreads)).toEqual([]);
		const candidates = await fixture.db.select().from(pendingPageCandidates);
		expect(candidates.map((candidate) => candidate.status)).toEqual([
			"pending",
			"pending",
		]);
	});
});
