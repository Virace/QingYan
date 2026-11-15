import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { taskMetricRollups } from "../../src/db/schema";
import { TaskMetricRollupRepository } from "../../src/modules/tasks/task-metric-rollup-repository";
import {
	applyInitialMigration,
	createTestWorkspace,
	type TestWorkspace,
} from "../support/test-fixtures";

interface Fixture {
	workspace: TestWorkspace;
	db: ReturnType<typeof createDatabaseClients>["db"];
	close: ReturnType<typeof createDatabaseClients>["close"];
	rollups: TaskMetricRollupRepository;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.close();
		await fixture.workspace.cleanup();
	}
});

async function createFixture(options?: {
	maxDimensionsPerBucket?: number;
}): Promise<Fixture> {
	const workspace = createTestWorkspace("qingyan-task-metrics-");
	await applyInitialMigration(workspace.databaseUrl);
	const clients = createDatabaseClients(workspace.databaseUrl);
	const fixture = {
		workspace,
		db: clients.db,
		close: clients.close,
		rollups: new TaskMetricRollupRepository(clients.db, options),
	};
	fixtures.push(fixture);
	return fixture;
}

describe("TaskMetricRollupRepository", () => {
	it("increments and sums 60-second and 300-second metric buckets", async () => {
		const { rollups } = await createFixture();

		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "request.failed",
			value: 2,
			at: new Date("2026-06-04T10:00:21.000Z"),
		});
		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "request.failed",
			value: 3,
			at: new Date("2026-06-04T10:00:59.000Z"),
		});
		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "request.failed",
			value: 7,
			bucketSizeSec: 300,
			at: new Date("2026-06-04T10:04:59.000Z"),
		});

		await expect(
			rollups.sumWindow({
				siteKey: "fangyuan",
				metricKey: "request.failed",
				windowSec: 120,
				now: new Date("2026-06-04T10:01:00.000Z"),
			}),
		).resolves.toMatchObject({
			value: 5,
			sampleCount: 2,
			bucketSizeSec: 60,
		});
		await expect(
			rollups.sumWindow({
				siteKey: "fangyuan",
				metricKey: "request.failed",
				windowSec: 300,
				bucketSizeSec: 300,
				now: new Date("2026-06-04T10:05:00.000Z"),
			}),
		).resolves.toMatchObject({
			value: 7,
			sampleCount: 1,
			bucketSizeSec: 300,
		});
	});

	it("normalizes dimensions and caps new high-cardinality dimensions per bucket", async () => {
		const { db, rollups } = await createFixture({ maxDimensionsPerBucket: 2 });
		const at = new Date("2026-06-04T10:00:00.000Z");

		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "public.write",
			dimensions: { statusGroup: "2xx", method: "POST" },
			at,
		});
		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "public.write",
			dimensions: { method: "POST", statusGroup: "2xx" },
			at,
		});
		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "public.write",
			dimensions: { method: "POST", statusGroup: "4xx" },
			at,
		});
		await rollups.increment({
			siteKey: "fangyuan",
			metricKey: "public.write",
			dimensions: { method: "POST", statusGroup: "5xx" },
			at,
		});
		const rows = await db.select().from(taskMetricRollups);

		expect(rows).toHaveLength(3);
		expect(rows.map((row) => JSON.parse(row.dimensionJson))).toEqual(
			expect.arrayContaining([
				{ method: "POST", statusGroup: "2xx" },
				{ method: "POST", statusGroup: "4xx" },
				{ overflow: true },
			]),
		);
		await expect(
			rollups.sumWindow({
				siteKey: "fangyuan",
				metricKey: "public.write",
				windowSec: 60,
				dimensions: { statusGroup: "2xx", method: "POST" },
				now: at,
			}),
		).resolves.toMatchObject({ value: 2, sampleCount: 2 });
	});
	it("caps concurrent new dimensions while preserving double values and sample totals", async () => {
		const { db, rollups } = await createFixture({ maxDimensionsPerBucket: 2 });
		const at = new Date("2026-06-04T10:00:00.000Z");
		await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				rollups.increment({
					siteKey: "unknown-site",
					metricKey: "parallel",
					at,
					dimensions: { index },
					value: 0.125,
					sampleCount: 2,
				}),
			),
		);
		const rows = await db.select().from(taskMetricRollups);
		expect(rows).toHaveLength(3);
		expect(
			rows.filter((row) => JSON.parse(row.dimensionJson).overflow === true),
		).toHaveLength(1);
		expect(rows.every((row) => row.dimensionHash.length === 32)).toBe(true);
		expect(
			await rollups.sumWindow({
				siteKey: "unknown-site",
				metricKey: "parallel",
				windowSec: 60,
				now: at,
			}),
		).toMatchObject({ value: 2.5, sampleCount: 40 });
	});

	it("keeps global, literal sentinel, and unknown site scopes distinct", async () => {
		const { rollups } = await createFixture();
		const at = new Date("2026-06-04T10:00:00.000Z");
		for (const [siteKey, value] of [
			[null, 1],
			["__global__", 2],
			["missing", 3],
		] as const) {
			await rollups.increment({ siteKey, metricKey: "scope", value, at });
		}
		for (const [siteKey, value] of [
			[null, 1],
			["__global__", 2],
			["missing", 3],
		] as const) {
			expect(
				await rollups.sumWindow({
					siteKey,
					metricKey: "scope",
					windowSec: 60,
					now: at,
				}),
			).toMatchObject({ value, sampleCount: 1 });
		}
	});
});
