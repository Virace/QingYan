import { describe, expect, it } from "vitest";

import {
	flattenSystemSettings,
	maskSystemSettings,
	readSystemSettingsRows,
} from "../../src/modules/system-settings/codec";
import { defaultSystemSettings } from "../../src/modules/system-settings/definitions";

describe("system settings ownership", () => {
	it("loads defaults and overlays database rows", () => {
		const settings = readSystemSettingsRows([
			{ category: "logging", key: "level", valueJson: '"debug"' },
			{ category: "mail", key: "smtp.password", valueJson: '"smtp-secret"' },
		]);

		expect(settings.logging.level).toBe("debug");
		expect(settings.logging.retentionDays).toBe(
			defaultSystemSettings.logging.retentionDays,
		);
		expect(settings.mail.smtp.password).toBe("smtp-secret");
	});

	it("flattens typed settings into database upsert rows", () => {
		const rows = flattenSystemSettings(defaultSystemSettings);
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: "admin",
					key: "session.ttlMinutes",
					value: 4320,
					secret: false,
				}),
				expect.objectContaining({
					category: "logging",
					key: "level",
					value: "info",
					secret: false,
				}),
				expect.objectContaining({
					category: "mail",
					key: "smtp.password",
					secret: true,
				}),
			]),
		);
	});

	it("masks secrets for admin and export responses", () => {
		const settings = structuredClone(defaultSystemSettings);
		settings.mail.smtp.password = "smtp-secret";
		settings.captcha.turnstile.secretKey = "turnstile-secret";

		const masked = maskSystemSettings(settings);

		expect(masked.mail.smtp.password).toBeUndefined();
		expect(masked.mail.smtp.passwordConfigured).toBe(true);
		expect(masked.captcha.turnstile.secretKey).toBeUndefined();
		expect(masked.captcha.turnstile.secretKeyConfigured).toBe(true);
	});
});
