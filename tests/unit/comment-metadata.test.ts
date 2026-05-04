import { describe, expect, it } from "vitest";

import {
	createUnknownDeviceSnapshot,
	parseDeviceSnapshot,
} from "../../src/modules/comments/metadata/device";
import {
	formatLocationLabel,
	parseIpRegionText,
} from "../../src/modules/comments/metadata/ip-region";

describe("comment metadata helpers", () => {
	it("parses ip2region text into nullable snapshot fields", () => {
		expect(parseIpRegionText("中国|广东省|深圳市|移动|CN")).toMatchObject({
			country: "中国",
			region: "广东省",
			city: "深圳市",
			isp: "移动",
			raw: "中国|广东省|深圳市|移动|CN",
		});
		expect(parseIpRegionText("0|0||0|")).toMatchObject({
			country: null,
			region: null,
			city: null,
			isp: null,
		});
	});

	it("formats location labels by configured precision", () => {
		const snapshot = parseIpRegionText("中国|广东省|深圳市|移动|CN");

		expect(formatLocationLabel(snapshot, "country")).toBe("中国");
		expect(formatLocationLabel(snapshot, "province")).toBe("广东");
		expect(formatLocationLabel(snapshot, "city")).toBe("广东深圳");
		expect(
			formatLocationLabel(
				{ country: "美国", region: "加利福尼亚州", city: "洛杉矶" },
				"province",
			),
		).toBe("美国");
		expect(
			formatLocationLabel(
				{ country: "中国", region: "广东省", city: null },
				"city",
			),
		).toBe("广东");
	});

	it("creates a stable unknown device snapshot when parser is unavailable", () => {
		expect(createUnknownDeviceSnapshot("parser unavailable")).toEqual({
			browser: "unknown",
			os: "unknown",
			type: "unknown",
			icon: "unknown",
			source: "unavailable",
			parserVersion: "none",
			error: "parser unavailable",
		});
	});

	it("parses user agent into QingYan device enums", () => {
		expect(
			parseDeviceSnapshot(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			),
		).toMatchObject({
			browser: "chrome",
			os: "windows",
			type: "desktop",
			icon: "chrome",
			source: "ua-parser-js",
			error: null,
		});
		expect(parseDeviceSnapshot("Googlebot/2.1")).toMatchObject({
			type: "bot",
			icon: "bot",
		});
	});
});
