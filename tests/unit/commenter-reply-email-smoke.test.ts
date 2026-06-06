import { describe, expect, it } from "vitest";

import {
	buildSmokeSettingsPatch,
	buildSmokeSiteCreatePayload,
	buildSmokeUrls,
	isSmokeCliEntryPoint,
	resolveSmokeConfig,
	summarizeSmokeConfig,
} from "../../scripts/commenter-reply-email-smoke";

describe("commenter reply email smoke helpers", () => {
	it("resolves defaults and normalizes local URLs", () => {
		const config = resolveSmokeConfig({
			QINGYAN_SMOKE_API_BASE: "http://127.0.0.1:4401/qingyan/",
			QINGYAN_SMOKE_PAGE_ORIGIN: "http://localhost:4321/",
			QINGYAN_SMOKE_PAGE_PATH: "posts/custom-smoke/",
			QINGYAN_SMOKE_CONFIG_PATH: "config/local-smoke.yml",
			QINGYAN_SMOKE_WORKER_LIMIT: "7",
		});

		expect(config).toMatchObject({
			apiBase: "http://127.0.0.1:4401/qingyan",
			adminUsername: "admin",
			adminPassword: "admin",
			adminCaptchaValue: "2468",
			recipientEmail: "virace2024@gmail.com",
			siteKey: "fangyuan",
			pagePath: "/posts/custom-smoke/",
			pageOrigin: "http://localhost:4321",
			waitForManualConfirmation: false,
			configPath: "config/local-smoke.yml",
			workerLimit: 7,
		});
	});

	it("falls back to the runtime config path and a conservative worker limit", () => {
		const config = resolveSmokeConfig({
			QINGYAN_CONFIG_PATH: "config/qingyan.test.yml",
			QINGYAN_SMOKE_WORKER_LIMIT: "not-a-number",
		});

		expect(config.configPath).toBe("config/qingyan.test.yml");
		expect(config.workerLimit).toBe(5);
	});

	it("builds public and admin smoke URLs from the configured base", () => {
		const config = resolveSmokeConfig({
			QINGYAN_SMOKE_API_BASE: "http://127.0.0.1:4401/qingyan",
			QINGYAN_SMOKE_SITE_KEY: "fang yuan",
			QINGYAN_SMOKE_PAGE_TITLE: "Commenter Email Smoke",
		});

		const urls = buildSmokeUrls(config);

		expect(urls.pageUrl).toBe(
			"http://localhost:4321/posts/commenter-email-smoke/",
		);
		expect(urls.bootstrap).toBe(
			"http://127.0.0.1:4401/qingyan/api/comments/bootstrap?siteKey=fang%20yuan&pageTitle=Commenter%20Email%20Smoke",
		);
		expect(urls.adminLogin).toBe(
			"http://127.0.0.1:4401/qingyan/api/admin/session/login",
		);
		expect(urls.adminTasksRuns).toBe(
			"http://127.0.0.1:4401/qingyan/api/admin/tasks/runs",
		);
		expect(urls.adminSites).toBe(
			"http://127.0.0.1:4401/qingyan/api/admin/sites",
		);
		expect(urls.adminSite).toBe(
			"http://127.0.0.1:4401/qingyan/api/admin/sites/fang%20yuan",
		);
		expect(urls.adminPageRegistryPendingApprove).toBe(
			"http://127.0.0.1:4401/qingyan/api/admin/page-registry/pending/approve",
		);
	});

	it("builds a minimal API payload for preparing the smoke site", () => {
		expect(
			buildSmokeSiteCreatePayload(
				resolveSmokeConfig({
					QINGYAN_SMOKE_SITE_KEY: "smoke",
					QINGYAN_SMOKE_PAGE_ORIGIN: "http://localhost:4321/",
				}),
			),
		).toEqual({
			siteKey: "smoke",
			name: "QingYan Smoke smoke",
			allowedOrigins: ["http://localhost:4321"],
		});
	});

	it("redacts admin secrets from the printed config summary", () => {
		const summary = summarizeSmokeConfig(
			resolveSmokeConfig({
				QINGYAN_SMOKE_ADMIN_PASSWORD: "super-secret",
				QINGYAN_SMOKE_ADMIN_CAPTCHA_VALUE: "1357",
			}),
		);

		expect(JSON.stringify(summary)).not.toContain("super-secret");
		expect(JSON.stringify(summary)).not.toContain("1357");
		expect(summary).toMatchObject({
			adminPassword: "[REDACTED]",
			adminCaptchaValue: "[REDACTED]",
			configPath: "config/qingyan.yml",
			workerLimit: 5,
		});
	});

	it("uses a minimal settings patch for the smoke setup", () => {
		expect(buildSmokeSettingsPatch()).toEqual({
			comments: {
				enabled: true,
				defaultStatus: "approved",
				captcha: {
					mode: "never",
				},
			},
			pageRegistry: {
				mode: "discovery",
			},
			notifications: {
				commenter: {
					replyEmailEnabled: true,
				},
			},
		});
	});

	it("detects the ESM CLI entrypoint from file paths instead of raw file URLs", () => {
		expect(
			isSmokeCliEntryPoint(
				"file:///H:/Programming/Web/QingYan/scripts/commenter-reply-email-smoke.ts",
				"H:\\Programming\\Web\\QingYan\\scripts\\commenter-reply-email-smoke.ts",
			),
		).toBe(true);
		expect(
			isSmokeCliEntryPoint(
				"file:///H:/Programming/Web/QingYan/scripts/commenter-reply-email-smoke.ts",
				"H:\\Programming\\Web\\QingYan\\scripts\\other.ts",
			),
		).toBe(false);
	});
});
