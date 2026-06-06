import { describe, expect, it } from "vitest";

import { createBuiltInTaskTypeRegistry } from "../../src/modules/tasks/built-in-task-types";

describe("built-in task type registry", () => {
	it("lists built-in task types as backend-owned definitions", () => {
		const registry = createBuiltInTaskTypeRegistry();

		expect(registry.list().map((definition) => definition.type)).toEqual([
			"page_source_refresh",
			"page_metadata_refresh",
			"comment_ip_refresh",
			"ip_region_update",
			"backup",
			"site_settings_action",
			"blacklist_automation",
			"daily_site_digest",
		]);
		expect(registry.getRequired("page_source_refresh")).toMatchObject({
			label: "页面来源刷新",
			category: "maintenance",
			scope: "site",
			schedule: {
				manual: true,
				cron: true,
				condition: true,
			},
			dangerous: false,
			reuse: {
				service: "PageSourceRefreshService",
				method: "executeRefresh",
				file: "src/modules/page-registry/source-refresh-service.ts",
			},
		});
	});

	it("validates canonical sitemap URL payloads through the page source schema", () => {
		const registry = createBuiltInTaskTypeRegistry();

		expect(
			registry.validatePayload("page_source_refresh", {
				siteKey: "fangyuan",
				sitemapUrls: ["https://example.com/sitemap-index.xml"],
				mode: "replace",
			}),
		).toEqual({
			siteKey: "fangyuan",
			sitemapUrls: ["https://example.com/sitemap-index.xml"],
			mode: "replace",
			trigger: "scheduled",
		});
	});

	it("validates legacy sourceIds compatibility through the page source schema", () => {
		const registry = createBuiltInTaskTypeRegistry();

		expect(
			registry.validatePayload("page_source_refresh", {
				siteKey: "fangyuan",
				sourceIds: [1, 2],
				mode: "replace",
				timeoutMs: 10_000,
				maxBytes: 512_000,
			}),
		).toEqual({
			siteKey: "fangyuan",
			sourceIds: [1, 2],
			mode: "replace",
			trigger: "scheduled",
			timeoutMs: 10_000,
			maxBytes: 512_000,
		});
		expect(() =>
			registry.validatePayload("page_source_refresh", {
				siteKey: "fangyuan",
				sourceIds: ["not-a-number"],
			}),
		).toThrow(/Invalid task payload/);
	});

	it("validates non-page-source payloads through each task type schema", () => {
		const registry = createBuiltInTaskTypeRegistry();

		expect(() =>
			registry.validatePayload("ip_region_update", {
				ipVersions: ["v4", "v7"],
			}),
		).toThrow(/Invalid task payload/);
	});

	it("rejects caller-controlled backup output directories", () => {
		const registry = createBuiltInTaskTypeRegistry();

		expect(() =>
			registry.validatePayload("backup", {
				scope: "site",
				siteKey: "fangyuan",
				outputDirectory: "C:\\Windows\\Temp",
			}),
		).toThrow(/Invalid task payload/);
		expect(() =>
			registry.validatePayload("backup", {
				scope: "site",
				siteKey: "fangyuan",
				outputDirectory: "../outside",
			}),
		).toThrow(/Invalid task payload/);
		expect(
			registry.validatePayload("backup", {
				scope: "site",
				siteKey: "fangyuan",
				include: {
					siteSettings: true,
					pageThreads: true,
					comments: true,
				},
				retentionCount: 5,
			}),
		).toEqual({
			scope: "site",
			siteKey: "fangyuan",
			include: {
				siteSettings: true,
				pageThreads: true,
				comments: true,
			},
			retentionCount: 5,
		});
	});

	it("documents reuse boundaries for every registered task type", () => {
		const registry = createBuiltInTaskTypeRegistry();

		for (const definition of registry.list()) {
			expect(definition.reuse).toMatchObject({
				service: expect.any(String),
				method: expect.any(String),
				file: expect.stringMatching(/^src\/modules\//),
			});
			expect(definition.payloadSchema).toBeTruthy();
			expect(definition.defaultPolicy).toEqual(
				expect.objectContaining({
					maxAttempts: expect.any(Number),
					retryDelaySec: expect.any(Number),
				}),
			);
		}
	});

	it("does not expose arbitrary script, command, or SQL task types", () => {
		const registry = createBuiltInTaskTypeRegistry();
		const typeKeys = registry.list().map((definition) => definition.type);

		expect(typeKeys).not.toEqual(
			expect.arrayContaining([
				"script",
				"shell",
				"python",
				"javascript",
				"sql",
				"command",
				"container_command",
			]),
		);
		expect(() => registry.getRequired("shell")).toThrow(/Unknown task type/);
	});
});
