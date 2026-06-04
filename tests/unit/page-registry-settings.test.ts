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
			authoritativeSourceIds: [],
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

	it("deduplicates positive integer source ids in stable order", () => {
		const settings = mergePageRegistrySettings(
			JSON.stringify({
				authoritativeSourceIds: [3, 2, 3, 0, -1, 2, 5, "6"],
			}),
		);

		expect(settings.authoritativeSourceIds).toEqual([3, 2, 5]);
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
				authoritativeSourceIds: [1, 1, 2],
				requireHealthySource: false,
				sourceFreshnessGraceSec: 0,
				unknownPageResponse: "forbidden",
				emergencyLockdown: true,
			},
		);

		expect(settings).toEqual({
			mode: "authoritative",
			authoritativeSourceIds: [1, 2],
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
