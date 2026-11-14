import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { TaskEventLogRepository } from "../../src/modules/tasks/task-event-log-repository";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import {
	applyInitialMigration,
	createTestWorkspace,
	type TestWorkspace,
} from "../support/test-fixtures";

interface Fixture {
	workspace: TestWorkspace;
	close: ReturnType<typeof createDatabaseClients>["close"];
	taskRuns: TaskRunRepository;
	eventLogs: TaskEventLogRepository;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.close();
		await fixture.workspace.cleanup();
	}
});

async function createFixture(): Promise<Fixture> {
	const workspace = createTestWorkspace("qingyan-task-event-log-");
	await applyInitialMigration(workspace.databaseUrl);
	const clients = createDatabaseClients(workspace.databaseUrl);
	const fixture = {
		workspace,
		close: clients.close,
		taskRuns: new TaskRunRepository(clients.db),
		eventLogs: new TaskEventLogRepository(clients.db),
	};
	fixtures.push(fixture);
	return fixture;
}

describe("TaskEventLogRepository", () => {
	it("assigns ordered stream sequences and lists incremental log lines", async () => {
		const fixture = await createFixture();
		const run = await fixture.taskRuns.create({
			type: "worker_test",
			category: "maintenance",
			payload: { siteKey: "fangyuan" },
			payloadSummary: { label: "Worker test" },
			createdAt: "2026-06-04T10:00:00.000Z",
			updatedAt: "2026-06-04T10:00:00.000Z",
		});

		const first = await fixture.eventLogs.appendLogLine({
			taskRunId: run.id,
			stream: "system",
			level: "info",
			message: "starting",
			visibleToSiteAdmin: true,
			createdAt: "2026-06-04T10:00:01.000Z",
		});
		const second = await fixture.eventLogs.appendLogLine({
			taskRunId: run.id,
			stream: "stdout",
			level: "info",
			message: "processed page 1",
			data: { pageKey: "about" },
			visibleToSiteAdmin: true,
			createdAt: "2026-06-04T10:00:02.000Z",
		});
		await fixture.eventLogs.appendLogLine({
			taskRunId: run.id,
			stream: "stderr",
			level: "warn",
			message: "private diagnostic",
			visibleToSiteAdmin: false,
			createdAt: "2026-06-04T10:00:03.000Z",
		});

		expect(first).toMatchObject({
			sequence: 1,
			stream: "system",
			eventType: "log.system",
		});
		expect(second).toMatchObject({
			sequence: 2,
			stream: "stdout",
			eventType: "log.stdout",
			data: { pageKey: "about" },
		});

		const publicRows = await fixture.eventLogs.listForRunAfter({
			taskRunId: run.id,
			afterSequence: 1,
			limit: 10,
			includePrivate: false,
		});
		expect(publicRows).toMatchObject({
			nextSequence: 2,
			hasMore: false,
			items: [
				expect.objectContaining({
					sequence: 2,
					stream: "stdout",
					message: "processed page 1",
				}),
			],
		});

		const privateRows = await fixture.eventLogs.listForRunAfter({
			taskRunId: run.id,
			afterSequence: 0,
			limit: 2,
			includePrivate: true,
		});
		expect(privateRows).toMatchObject({
			nextSequence: 2,
			hasMore: true,
		});
		expect(privateRows.items.map((item) => item.sequence)).toEqual([1, 2]);
	});
	it("serializes concurrent writers through the parent task row", async () => {
		const { taskRuns, eventLogs } = await createFixture();
		const run = await taskRuns.create({
			type: "events",
			category: "maintenance",
			payload: {},
		});
		await Promise.all(
			Array.from({ length: 12 }, (_, index) =>
				eventLogs.append({
					taskRunId: run.id,
					eventType: "parallel",
					level: "info",
					message: String(index),
				}),
			),
		);
		const events = await eventLogs.listForRun({
			taskRunId: run.id,
			limit: 20,
			offset: 0,
			includePrivate: true,
		});
		expect(events.items.map((event) => event.sequence)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
	});
});
