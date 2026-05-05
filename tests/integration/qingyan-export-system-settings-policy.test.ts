import { describe, expect, it } from "vitest";

import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

function qingyanExportPayload(): Record<string, any> {
	return {
		format: "qingyan.export.v1",
		formatVersion: 2,
		createdAt: "2026-05-05T00:00:00.000Z",
		generator: {
			name: "QingYan",
			version: "0.1.0",
		},
		scope: {
			type: "site",
			siteKey: "fangyuan",
		},
		schema: {
			entitiesVersion: 1,
			sourceDatabase: "sqlite",
			sourceMigrations: [],
		},
		data: {
			site: {
				siteKey: "fangyuan",
				name: "FangYuan",
				allowedOrigins: ["http://localhost:4321"],
			},
			siteSettings: null,
			systemSettings: [],
			pageThreads: [],
			visitors: [],
			comments: [],
			voteRecords: [],
			pageFeedbackRecords: [],
			blacklistRules: [],
		},
	};
}

describe("QingYan export system settings policy", () => {
	it("excludes system setting secrets from ordinary exports", async () => {
		const fixture = await createTestApp();
		const { adminCookie } = await loginAsAdmin(fixture.app);
		const repository = new AdminSystemSettingsRepository(fixture.app.db);
		await repository.upsert("mail", "smtp.password", "smtp-secret");
		await repository.upsert(
			"captcha",
			"turnstile.secretKey",
			"turnstile-secret",
		);
		await repository.upsert("logging", "level", "info");

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/import-export/export",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				siteKey: "fangyuan",
				format: "qingyan.export.v1",
				include: {
					systemSettings: true,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		const exportPayload = response.json();
		expect(JSON.stringify(exportPayload)).not.toContain("smtp-secret");
		expect(JSON.stringify(exportPayload)).not.toContain("turnstile-secret");
		expect(exportPayload.data.systemSettings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: "logging",
					key: "level",
				}),
			]),
		);
		expect(exportPayload.data.systemSettings).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: "mail",
					key: "smtp.password",
				}),
			]),
		);
	});

	it("rejects secret system setting rows during ordinary import dry-run", async () => {
		const fixture = await createTestApp();
		const { adminCookie } = await loginAsAdmin(fixture.app);
		const payload = qingyanExportPayload();
		payload.data.systemSettings = [
			{
				category: "mail",
				key: "smtp.password",
				value_json: JSON.stringify("smtp-secret"),
				updated_at: "2026-05-05T00:00:00.000Z",
			},
		];

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/admin/import-export/qingyan/dry-run",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
			payload: {
				siteKey: "fangyuan",
				fileName: "qingyan-export.json",
				payload,
				existingStrategy: "fail_on_existing",
				importMode: "settings_only",
				settingsStrategy: "replace_settings",
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "INVALID_REQUEST",
				details: {
					message: "普通 QingYan 导入不接受 system settings secret 字段。",
				},
			},
		});
	});
});
