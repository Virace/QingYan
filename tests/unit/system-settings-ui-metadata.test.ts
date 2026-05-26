import { describe, expect, it } from "vitest";

import {
	getSettingLabel,
	getSettingOptionLabel,
} from "../../src/modules/system-settings/ui-metadata";

describe("system settings UI metadata", () => {
	it("returns user-facing labels for known setting paths", () => {
		expect(getSettingLabel("systemSettings.ipRegion.cachePolicy")).toBe(
			"IP 数据库加载方式",
		);
		expect(getSettingLabel("admin.session.sameSite")).toBe(
			"后台 Cookie SameSite 策略",
		);
	});

	it("returns user-facing option labels for known enum values", () => {
		expect(
			getSettingOptionLabel(
				"systemSettings.ipRegion.cachePolicy",
				"vectorIndex",
			),
		).toBe("向量索引缓存");
		expect(
			getSettingOptionLabel(
				"systemSettings.captcha.recaptcha.variant",
				"score_based",
			),
		).toBe("分数判断");
	});

	it("falls back to stable technical text for unknown paths and values", () => {
		expect(getSettingLabel("systemSettings.unknown.value")).toBe(
			"unknown / value",
		);
		expect(getSettingOptionLabel("systemSettings.unknown.value", "raw")).toBe(
			"raw",
		);
	});
});
