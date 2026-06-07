import { describe, expect, it, vi } from "vitest";

import { createBuiltInTaskTypeRegistry } from "../../src/modules/tasks/built-in-task-types";
import type { TaskRunnerContext } from "../../src/modules/tasks/task-runner-context";

function createContext(
	overrides: Partial<TaskRunnerContext> = {},
): TaskRunnerContext {
	return {
		runId: "task_run_1",
		scheduledTaskId: "scheduled_task_1",
		actor: { type: "admin_user", id: "1" },
		services: {},
		log: {
			stdout: vi.fn(),
			stderr: vi.fn(),
			system: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			write: vi.fn(),
		},
		writeEvent: vi.fn(),
		updateProgress: vi.fn(),
		writeAudit: vi.fn(),
		now: () => new Date("2026-06-04T10:00:00.000Z"),
		signal: new AbortController().signal,
		...overrides,
	};
}

describe("maintenance task runner reuse wrappers", () => {
	it("delegates page source refresh to PageSourceRefreshService", async () => {
		const service = {
			executeRefresh: vi.fn().mockResolvedValue({ processed: 2 }),
		};
		const context = createContext({
			services: { pageSourceRefresh: service },
		});

		const result = await createBuiltInTaskTypeRegistry()
			.getRequired("page_source_refresh")
			.run(
				{
					siteKey: "fangyuan",
					sitemapUrls: ["https://example.com/sitemap.xml"],
					mode: "append",
					trigger: "scheduled",
				},
				context,
			);

		expect(service.executeRefresh).toHaveBeenCalledWith(
			{
				siteKey: "fangyuan",
				sitemapUrls: ["https://example.com/sitemap.xml"],
				mode: "append",
				trigger: "scheduled",
				timeoutMs: undefined,
				maxBytes: undefined,
			},
			context,
		);
		expect(context.writeEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "succeeded" }),
		);
		expect(result).toEqual({ processed: 2 });
	});

	it("checks page source refresh ownership before runner execution", async () => {
		const policy = {
			checkRefreshAllowed: vi.fn().mockResolvedValue("blocked" as const),
		};
		const context = createContext({
			scheduledTaskSystemKey: "ordinary:refresh",
			services: { pageSourceRefreshPolicy: policy },
		});
		const payload = {
			siteKey: "fangyuan",
			sitemapUrls: ["http://localhost:4321/sitemap.xml"],
			mode: "replace" as const,
			trigger: "scheduled" as const,
		};

		const precondition = await createBuiltInTaskTypeRegistry()
			.getRequired("page_source_refresh")
			.precondition?.(payload, context);

		expect(precondition).toBe("blocked");
		expect(policy.checkRefreshAllowed).toHaveBeenCalledWith({
			siteKey: "fangyuan",
			systemKey: "ordinary:refresh",
			payload,
		});
	});

	it("delegates title refresh to PageMetadataRefreshService", async () => {
		const service = {
			executeRefresh: vi.fn().mockResolvedValue({ updated: 1 }),
		};
		const context = createContext({
			services: { pageMetadataRefresh: service },
		});

		await createBuiltInTaskTypeRegistry()
			.getRequired("page_metadata_refresh")
			.run(
				{
					siteKey: "fangyuan",
					scope: "missing_only",
					pageKeys: ["/post/a"],
					trigger: "scheduled",
					batchSize: 20,
				},
				context,
			);

		expect(service.executeRefresh).toHaveBeenCalledWith(
			{
				siteKey: "fangyuan",
				pageKeys: ["/post/a"],
				onlyMissingTitle: true,
				forceTitle: false,
				trigger: "scheduled",
				batchSize: 20,
				timeoutMs: undefined,
				maxBytes: undefined,
			},
			context,
		);
	});

	it("delegates comment IP refresh and IP region update to CommentIpMaintenanceService", async () => {
		const service = {
			executeCommentIpRefresh: vi.fn().mockResolvedValue({ refreshed: 1 }),
			executeIpRegionUpdate: vi.fn().mockResolvedValue({ results: [] }),
		};
		const context = createContext({
			services: { commentIpMaintenance: service },
		});
		const registry = createBuiltInTaskTypeRegistry();

		await registry.getRequired("comment_ip_refresh").run(
			{
				siteKey: "fangyuan",
				scope: "stale",
				ipVersions: ["v4", "v6"],
				batchSize: 100,
			},
			context,
		);
		await registry.getRequired("ip_region_update").run(
			{
				ipVersions: ["v4"],
				timeoutMs: 30_000,
			},
			context,
		);

		expect(service.executeCommentIpRefresh).toHaveBeenCalledWith(
			{
				siteKey: "fangyuan",
				scope: "stale",
				ipVersions: ["v4", "v6"],
				batchSize: 100,
			},
			context,
		);
		expect(service.executeIpRegionUpdate).toHaveBeenCalledWith(
			{
				ipVersions: ["v4"],
				timeoutMs: 30_000,
			},
			context,
		);
	});

	it("records blocked when the required existing service is not injected", async () => {
		const context = createContext();

		await expect(
			createBuiltInTaskTypeRegistry()
				.getRequired("page_source_refresh")
				.run({ siteKey: "fangyuan" }, context),
		).rejects.toThrow(/Task service missing/);
		expect(context.writeEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: "blocked",
				data: { reason: "service_missing", service: "pageSourceRefresh" },
			}),
		);
	});
});
