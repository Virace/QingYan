import { describe, expect, it } from "vitest";

import {
	compareReleaseVersions,
	parseReleaseVersion,
} from "../../src/modules/ops/release-version";

describe("release version parser", () => {
	it("parses v-prefixed and plain semver tags", () => {
		expect(parseReleaseVersion("v0.1.0")).toEqual({
			major: 0,
			minor: 1,
			patch: 0,
			normalized: "0.1.0",
		});
		expect(parseReleaseVersion("0.2.3")?.normalized).toBe("0.2.3");
	});

	it("rejects non-release tags", () => {
		expect(parseReleaseVersion("nightly")).toBeNull();
		expect(parseReleaseVersion("release-20260507")).toBeNull();
		expect(parseReleaseVersion("v1")).toBeNull();
		expect(parseReleaseVersion("v1.2")).toBeNull();
	});

	it("compares versions by major minor patch", () => {
		expect(compareReleaseVersions("0.2.0", "0.1.0")).toBe(1);
		expect(compareReleaseVersions("0.1.0", "0.1.0")).toBe(0);
		expect(compareReleaseVersions("0.0.9", "0.1.0")).toBe(-1);
	});
});
