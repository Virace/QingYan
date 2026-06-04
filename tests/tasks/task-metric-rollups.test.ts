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
	sqlite: ReturnType<typeof createDatabaseClients>["sqlite"];
	rollups: TaskMetricRollupRepository;
}

const fixtures: Fixture[] = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.sqlite.close();
		fixture.workspace.cleanup();
	}
});

function createFixture(options?: { maxDimensionsPerBucket?: number }): Fixture {
	const workspace = createTestWorkspace("qingyan-task-metrics-");
	applyInitialMigration(workspace.databaseFile);
	const clients = createDatabaseClients(workspace.databaseFile);
	const fixture = {
		workspace,
		db: clients.db,
		sqlite: clients.sqlite,
		rollups: new TaskMetricRollupRepository(clients.db, options),
	};
	fixtures.push(fixture);
	return fixture;
}

describe("TaskMetricRollupRepository", () => {
	it("increments and sums 60-second and 300-second metric buckets", async () => {
		const { rollups } = createFixture();

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
		const { db, rollups } = createFixture({ maxDimensionsPerBucket: 2 });
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
		expect(rows.map((row) => row.dimensionJson)).toEqual(
			expect.arrayContaining([
				'{"method":"POST","statusGroup":"2xx"}',
				'{"method":"POST","statusGroup":"4xx"}',
				'{"overflow":true}',
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
});
