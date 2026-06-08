import { describe, expect, it } from "vitest";

import {
	toPublicUpgradePlan,
	type UpgradePlan,
} from "../../src/modules/upgrade/upgrade-plan";

describe("upgrade plan", () => {
	it("redacts secret values from public output", () => {
		const plan: UpgradePlan = {
			currentVersion: "0.1.0",
			targetVersion: "0.2.0",
			schemaMigrations: [{ name: "0001_next.sql" }],
			applicationUpgrades: [
				{
					name: "move-mail-settings",
					summary: {
						smtpPassword: "raw-smtp-password",
						kept: "safe-summary",
					},
				},
			],
			configChanges: [
				{
					path: "mail.smtp.password",
					action: "move",
					before: "raw-config-password",
					after: "raw-db-password",
					valueKind: "secret",
				},
				{
					path: "server.publicBaseUrl",
					action: "update",
					before: "http://old.example.test",
					after: "https://new.example.test",
				},
			],
			dbSettingChanges: [
				{
					path: "captcha.turnstile.secretKey",
					action: "add",
					after: {
						secretKey: "raw-turnstile-secret",
						siteKey: "public-site-key",
					},
				},
			],
			secretHandling: ["Secrets are moved without rendering raw values."],
			backupPaths: {
				config: "/tmp/qingyan.yml.bak",
				database: "/tmp/qingyan.db.bak",
				plan: "/tmp/upgrade-plan.json",
			},
			risks: ["Requires service restart."],
		};

		const publicPlan = toPublicUpgradePlan(plan);
		const serialized = JSON.stringify(publicPlan);

		expect(serialized).not.toContain("raw-smtp-password");
		expect(serialized).not.toContain("raw-config-password");
		expect(serialized).not.toContain("raw-db-password");
		expect(serialized).not.toContain("raw-turnstile-secret");
		expect(serialized).toContain("safe-summary");
		expect(serialized).toContain("https://new.example.test");
		expect(serialized).toContain("public-site-key");
		expect(serialized).toContain("[redacted]");
	});
});
