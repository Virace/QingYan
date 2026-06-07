import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	adminUsers,
	delayedDeletions,
	sitePageRegistry,
	sites,
	systemSettings,
} from "../../src/db/schema";
import { DeletionPolicyService } from "../../src/modules/admin/deletion-policy-service";
import { createTestApp } from "../support/test-fixtures";

describe("DeletionPolicyService", () => {
	it("creates pending delayed deletion records when retention is positive", async () => {
		const fixture = await createTestApp();
		try {
			const [site] = await fixture.app.db
				.select()
				.from(sites)
				.where(eq(sites.siteKey, "fangyuan"));
			const [actor] = await fixture.app.db
				.select()
				.from(adminUsers)
				.where(eq(adminUsers.username, "admin"));
			if (!site || !actor) {
				throw new Error("Expected seeded site and admin");
			}

			const service = new DeletionPolicyService(fixture.app.db);
			const result = await service.requestDeletion({
				resourceType: "page",
				resourceId: "post:delayed",
				siteId: site.id,
				actorUserId: actor.id,
				metadata: {
					pageKey: "post:delayed",
				},
				now: new Date("2026-06-01T00:00:00.000Z"),
				hardDelete: async () => 1,
			});

			expect(result.mode).toBe("delayed");
			expect(result.record).toMatchObject({
				resourceType: "page",
				resourceId: "post:delayed",
				siteId: site.id,
				requestedByUserId: actor.id,
				requestedAt: "2026-06-01T00:00:00.000Z",
				hardDeleteAfter: "2026-06-16T00:00:00.000Z",
				status: "pending",
			});
			expect(JSON.parse(result.record?.metadataJson ?? "{}")).toEqual({
				pageKey: "post:delayed",
			});
		} finally {
			await fixture.cleanup();
		}
	});

	it("hard deletes immediately when retention is zero", async () => {
		const fixture = await createTestApp();
		try {
			const [site] = await fixture.app.db
				.select()
				.from(sites)
				.where(eq(sites.siteKey, "fangyuan"));
			const [actor] = await fixture.app.db
				.select()
				.from(adminUsers)
				.where(eq(adminUsers.username, "admin"));
			if (!site || !actor) {
				throw new Error("Expected seeded site and admin");
			}
			await fixture.app.db.insert(systemSettings).values({
				category: "admin",
				key: "deletion.retentionDays",
				valueJson: "0",
			});

			const service = new DeletionPolicyService(fixture.app.db);
			const result = await service.requestDeletion({
				resourceType: "page",
				resourceId: "post:immediate",
				siteId: site.id,
				actorUserId: actor.id,
				now: new Date("2026-06-01T00:00:00.000Z"),
				hardDelete: async () => 3,
			});

			expect(result).toMatchObject({
				mode: "immediate",
				hardDeletedCount: 3,
			});
			expect(result.record).toMatchObject({
				status: "hard_deleted",
				requestedAt: "2026-06-01T00:00:00.000Z",
				hardDeleteAfter: "2026-06-01T00:00:00.000Z",
				hardDeletedAt: "2026-06-01T00:00:00.000Z",
			});
		} finally {
			await fixture.cleanup();
		}
	});

	it("restores pending delayed deletions before the hard-delete deadline", async () => {
		const fixture = await createTestApp();
		try {
			const [site] = await fixture.app.db
				.select()
				.from(sites)
				.where(eq(sites.siteKey, "fangyuan"));
			const [actor] = await fixture.app.db
				.select()
				.from(adminUsers)
				.where(eq(adminUsers.username, "admin"));
			if (!site || !actor) {
				throw new Error("Expected seeded site and admin");
			}
			await fixture.app.db.insert(sitePageRegistry).values({
				siteId: site.id,
				pageKey: "post:restore",
				pageUrl: "/post/restore",
				status: "deleted",
				deletedAt: "2026-06-01T00:00:00.000Z",
			});
			const [record] = await fixture.app.db
				.insert(delayedDeletions)
				.values({
					resourceType: "page",
					resourceId: "post:restore",
					siteId: site.id,
					requestedByUserId: actor.id,
					requestedAt: "2026-06-01T00:00:00.000Z",
					hardDeleteAfter: "2026-06-16T00:00:00.000Z",
					status: "pending",
				})
				.returning();
			if (!record) {
				throw new Error("Expected delayed deletion record");
			}

			const service = new DeletionPolicyService(fixture.app.db);
			const restored = await service.restoreDeletion({
				id: record.id,
				actorUserId: actor.id,
				now: new Date("2026-06-02T00:00:00.000Z"),
				restore: async () => {
					await fixture.app.db
						.update(sitePageRegistry)
						.set({
							status: "active",
							deletedAt: null,
						})
						.where(eq(sitePageRegistry.pageKey, "post:restore"));
					return 1;
				},
			});

			expect(restored).toMatchObject({
				status: "restored",
				restoredByUserId: actor.id,
				restoredAt: "2026-06-02T00:00:00.000Z",
			});
			const [page] = await fixture.app.db
				.select()
				.from(sitePageRegistry)
				.where(eq(sitePageRegistry.pageKey, "post:restore"));
			expect(page).toMatchObject({
				status: "active",
				deletedAt: null,
			});
		} finally {
			await fixture.cleanup();
		}
	});

	it("hard deletes due pending records and ignores restored records", async () => {
		const fixture = await createTestApp();
		try {
			const [site] = await fixture.app.db
				.select()
				.from(sites)
				.where(eq(sites.siteKey, "fangyuan"));
			const [actor] = await fixture.app.db
				.select()
				.from(adminUsers)
				.where(eq(adminUsers.username, "admin"));
			if (!site || !actor) {
				throw new Error("Expected seeded site and admin");
			}
			await fixture.app.db.insert(delayedDeletions).values([
				{
					resourceType: "page",
					resourceId: "post:due",
					siteId: site.id,
					requestedByUserId: actor.id,
					requestedAt: "2026-05-01T00:00:00.000Z",
					hardDeleteAfter: "2026-05-16T00:00:00.000Z",
					status: "pending",
				},
				{
					resourceType: "page",
					resourceId: "post:restored",
					siteId: site.id,
					requestedByUserId: actor.id,
					requestedAt: "2026-05-01T00:00:00.000Z",
					hardDeleteAfter: "2026-05-16T00:00:00.000Z",
					restoredByUserId: actor.id,
					restoredAt: "2026-05-02T00:00:00.000Z",
					status: "restored",
				},
			]);

			const hardDeleted: string[] = [];
			const service = new DeletionPolicyService(fixture.app.db);
			const result = await service.runDueHardDeletes({
				now: new Date("2026-06-01T00:00:00.000Z"),
				hardDelete: async (record) => {
					hardDeleted.push(record.resourceId);
					return 1;
				},
			});

			expect(result).toMatchObject({
				processedCount: 1,
				hardDeletedCount: 1,
				hardDeletedAt: "2026-06-01T00:00:00.000Z",
			});
			expect(result.records).toEqual([
				expect.objectContaining({
					resourceType: "page",
					resourceId: "post:due",
					requestedByUserId: actor.id,
					requestedAt: "2026-05-01T00:00:00.000Z",
					hardDeletedCount: 1,
				}),
			]);
			expect(hardDeleted).toEqual(["post:due"]);
			const rows = await fixture.app.db.select().from(delayedDeletions);
			expect(rows.map((row) => [row.resourceId, row.status])).toEqual(
				expect.arrayContaining([
					["post:due", "hard_deleted"],
					["post:restored", "restored"],
				]),
			);
		} finally {
			await fixture.cleanup();
		}
	});
});
