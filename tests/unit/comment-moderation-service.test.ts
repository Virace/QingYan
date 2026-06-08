import { describe, expect, it } from "vitest";

import { ModerationService } from "../../src/modules/comments/moderation-service";
import type { SiteModerationSettings } from "../../src/modules/comments/moderation-types";
import type { SystemSettings } from "../../src/modules/system-settings/definitions";
import { defaultSystemSettings } from "../../src/modules/system-settings/definitions";

function settings(
	mode: SiteModerationSettings["mode"],
): SiteModerationSettings {
	return {
		mode,
		provider:
			mode === "akismet_auto" || mode === "manual_with_akismet"
				? "akismet"
				: "none",
		akismet: {
			failPolicy: "pending",
			discardBlatantSpam: false,
		},
	};
}

function systemSettings(apiKey = "akismet-key"): SystemSettings {
	const value = structuredClone(defaultSystemSettings);
	value.antiSpam.akismet.apiKey = apiKey;
	value.antiSpam.akismet.apiKeyConfigured = Boolean(apiKey);
	return value;
}

describe("ModerationService", () => {
	it("uses the caller supplied site origin as the Akismet blog URL", async () => {
		let blog: string | undefined;
		const service = new ModerationService({
			akismetClient: {
				commentCheck: async (input) => {
					blog = input.blog;
					return { verdict: "ham", checkedAt: "2026-05-26T10:00:00.000Z" };
				},
			},
			loadSystemSettings: async () => systemSettings(),
		});

		await service.reviewComment({
			siteModeration: settings("akismet_auto"),
			blog: "http://localhost:4321",
			userIp: "203.0.113.10",
			commentType: "comment",
			commentContent: "normal",
		});

		expect(blog).toBe("http://localhost:4321");
	});

	it("maps non-Akismet modes without calling Akismet", async () => {
		let calls = 0;
		const service = new ModerationService({
			akismetClient: {
				commentCheck: async () => {
					calls += 1;
					return { verdict: "spam", checkedAt: new Date().toISOString() };
				},
			},
			loadSystemSettings: async () => systemSettings(),
		});

		await expect(
			service.reviewComment({
				siteModeration: settings("none"),
				blog: "https://example.com",
				userIp: "203.0.113.10",
				commentType: "comment",
				commentContent: "hello",
			}),
		).resolves.toMatchObject({
			status: "approved",
			decision: "approve",
			provider: "none",
		});
		await expect(
			service.reviewComment({
				siteModeration: settings("manual"),
				blog: "https://example.com",
				userIp: "203.0.113.10",
				commentType: "comment",
				commentContent: "hello",
			}),
		).resolves.toMatchObject({
			status: "pending",
			decision: "pending",
			provider: "none",
		});
		expect(calls).toBe(0);
	});

	it("maps Akismet verdicts according to moderation mode", async () => {
		const service = new ModerationService({
			akismetClient: {
				commentCheck: async (input) => ({
					verdict: input.commentContent.includes("spam") ? "spam" : "ham",
					checkedAt: "2026-05-26T10:00:00.000Z",
				}),
			},
			loadSystemSettings: async () => systemSettings(),
		});

		await expect(
			service.reviewComment({
				siteModeration: settings("manual_with_akismet"),
				blog: "https://example.com",
				userIp: "203.0.113.10",
				commentType: "comment",
				commentContent: "normal",
			}),
		).resolves.toMatchObject({
			status: "pending",
			decision: "pending",
			akismetVerdict: "ham",
		});
		await expect(
			service.reviewComment({
				siteModeration: settings("manual_with_akismet"),
				blog: "https://example.com",
				userIp: "203.0.113.10",
				commentType: "comment",
				commentContent: "spam",
			}),
		).resolves.toMatchObject({
			status: "spam",
			decision: "spam",
			akismetVerdict: "spam",
		});
		await expect(
			service.reviewComment({
				siteModeration: settings("akismet_auto"),
				blog: "https://example.com",
				userIp: "203.0.113.10",
				commentType: "comment",
				commentContent: "normal",
			}),
		).resolves.toMatchObject({
			status: "approved",
			decision: "approve",
			akismetVerdict: "ham",
		});
	});

	it("falls back to pending when Akismet is unavailable", async () => {
		const service = new ModerationService({
			akismetClient: {
				commentCheck: async () => {
					throw new Error("network failed");
				},
			},
			loadSystemSettings: async () => systemSettings(),
		});

		await expect(
			service.reviewComment({
				siteModeration: settings("akismet_auto"),
				blog: "https://example.com",
				userIp: "203.0.113.10",
				commentType: "comment",
				commentContent: "normal",
			}),
		).resolves.toMatchObject({
			status: "pending",
			decision: "pending",
			akismetVerdict: "error",
		});
	});
});
