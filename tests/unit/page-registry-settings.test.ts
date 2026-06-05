import { describe, expect, it } from "vitest";

import {
	defaultPageRegistrySettings,
	mergePageRegistrySettings,
	mergePageRegistrySettingsPatch,
	serializePageRegistrySettings,
} from "../../src/modules/shared/page-registry-settings";

describe("page registry settings", () => {
	it("returns the default shape", () => {
		expect(mergePageRegistrySettings()).toEqual({
			mode: "discovery",
			authoritativeSitemapUrls: [],
			unknownPageResponse: "inactive_payload",
			requireHealthySource: true,
			sourceFreshnessGraceSec: 7200,
			emergencyLockdown: false,
		});
		expect(defaultPageRegistrySettings).toEqual(mergePageRegistrySettings());
	});

	it("falls back to defaults for invalid JSON", () => {
		expect(mergePageRegistrySettings("{not-json")).toEqual(
			defaultPageRegistrySettings,
		);
	});

	it("normalizes authoritative sitemap urls", () => {
		const settings = mergePageRegistrySettings(
			JSON.stringify({
				mode: "authoritative",
				authoritativeSitemapUrls: [
					"https://example.com/sitemap-index.xml",
					"https://example.com/sitemap-index.xml",
					"ftp://example.com/bad.xml",
					"not-a-url",
					"https://example.com/post-sitemap.xml",
				],
			}),
		);

		expect(settings.authoritativeSitemapUrls).toEqual([
			"https://example.com/sitemap-index.xml",
			"https://example.com/post-sitemap.xml",
		]);
		expect(settings.requireHealthySource).toBe(true);
	});

	it("forces healthy source requirement in authoritative mode", () => {
		const settings = mergePageRegistrySettings(
			JSON.stringify({
				mode: "authoritative",
				requireHealthySource: false,
			}),
		);

		expect(settings).toMatchObject({
			mode: "authoritative",
			requireHealthySource: true,
		});
	});

	it("merges patches and serializes normalized settings", () => {
		const settings = mergePageRegistrySettingsPatch(
			defaultPageRegistrySettings,
			{
				mode: "authoritative",
				authoritativeSitemapUrls: [
					"https://example.com/sitemap.xml",
					"https://example.com/sitemap.xml",
				],
				requireHealthySource: false,
				sourceFreshnessGraceSec: 0,
				unknownPageResponse: "forbidden",
				emergencyLockdown: true,
			},
		);

		expect(settings).toEqual({
			mode: "authoritative",
			authoritativeSitemapUrls: ["https://example.com/sitemap.xml"],
			unknownPageResponse: "forbidden",
			requireHealthySource: true,
			sourceFreshnessGraceSec: 0,
			emergencyLockdown: true,
		});
		expect(JSON.parse(serializePageRegistrySettings(settings))).toEqual(
			settings,
		);
	});
});
