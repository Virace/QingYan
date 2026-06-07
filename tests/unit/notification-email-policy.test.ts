import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import {
	commenterNotificationPreferences,
	emailDeliveryReputation,
	sites,
	unsubscribeTokens,
} from "../../src/db/schema";
import {
	hashNotificationEmail,
	isAcceptableNotificationEmail,
	normalizeNotificationEmail,
} from "../../src/modules/notifications/email-address-policy";
import { CommenterPreferencesRepository } from "../../src/modules/notifications/commenter-preferences-repository";
import { EmailReputationRepository } from "../../src/modules/notifications/email-reputation-repository";
import { UnsubscribeTokenService } from "../../src/modules/notifications/unsubscribe-token-service";
import {
	applyInitialMigration,
	createTestWorkspace,
} from "../support/test-fixtures";

function requireEmailHash(email: string): string {
	const hash = hashNotificationEmail(email);
	if (!hash) {
		throw new Error(`Expected hash for ${email}`);
	}
	return hash;
}

function createFixture() {
	const workspace = createTestWorkspace("qingyan-notification-policy-");
	applyInitialMigration(workspace.databaseFile);
	const clients = createDatabaseClients(workspace.databaseFile);

	return {
		...clients,
		cleanup() {
			clients.sqlite.close();
			workspace.cleanup();
		},
	};
}

async function seedSite(fixture: ReturnType<typeof createFixture>) {
	const [site] = await fixture.db
		.insert(sites)
		.values({
			siteKey: "fangyuan",
			name: "FangYuan",
			allowedOriginsJson: JSON.stringify(["http://localhost:4321"]),
		})
		.returning();
	return site;
}

describe("notification email policy", () => {
	it("normalizes and hashes notification emails consistently", () => {
		const normalized = normalizeNotificationEmail("  Alice@Example.COM  ");

		expect(normalized).toBe("alice@example.com");
		expect(hashNotificationEmail(normalized)).toBe(
			createHash("sha256").update("alice@example.com").digest("hex"),
		);
	});

	it("rejects obvious invalid recipient addresses", () => {
		expect(isAcceptableNotificationEmail("root@root.root")).toBe(false);
		expect(isAcceptableNotificationEmail("test@test.test")).toBe(false);
		expect(isAcceptableNotificationEmail("admin@admin.admin")).toBe(false);
		expect(isAcceptableNotificationEmail("a@a.a")).toBe(false);
		expect(isAcceptableNotificationEmail("valid@example.com")).toBe(true);
	});

	it("upserts comment-form preferences and keeps unsubscribe separate from reputation", async () => {
		const fixture = createFixture();
		try {
			const site = await seedSite(fixture);
			const preferences = new CommenterPreferencesRepository(fixture.db);
			const reputation = new EmailReputationRepository(fixture.db);

			await preferences.upsertFromCommentForm({
				siteId: site.id,
				email: "  Alice@Example.COM ",
				notifyOnReply: true,
			});
			await reputation.recordRecipientFailure({
				siteId: site.id,
				email: "alice@example.com",
				reason: "bounce",
				nowIso: "2026-06-02T10:00:00.000Z",
			});
			await preferences.unsubscribe({
				siteId: site.id,
				emailHash: requireEmailHash("alice@example.com"),
				nowIso: "2026-06-02T11:00:00.000Z",
			});

			const [preference] = await fixture.db
				.select()
				.from(commenterNotificationPreferences);
			const [reputationRow] = await fixture.db
				.select()
				.from(emailDeliveryReputation);

			expect(preference).toMatchObject({
				siteId: site.id,
				email: "alice@example.com",
				emailHash: requireEmailHash("alice@example.com"),
				notifyOnReply: false,
				unsubscribedAt: "2026-06-02T11:00:00.000Z",
				source: "unsubscribe_link",
			});
			expect(reputationRow).toMatchObject({
				siteId: site.id,
				email: "alice@example.com",
				failureScore: 1,
			});
		} finally {
			fixture.cleanup();
		}
	});

	it("suppresses after repeated recipient failures and clears suppression after success", async () => {
		const fixture = createFixture();
		try {
			const site = await seedSite(fixture);
			const reputation = new EmailReputationRepository(fixture.db);

			for (let attempt = 0; attempt < 5; attempt += 1) {
				await reputation.recordRecipientFailure({
					siteId: site.id,
					email: "recipient@example.com",
					reason: "mailbox_unavailable",
					nowIso: `2026-06-02T10:0${attempt}:00.000Z`,
				});
			}

			expect(
				await reputation.isSuppressed({
					siteId: site.id,
					email: "recipient@example.com",
					nowIso: "2026-06-02T10:10:00.000Z",
				}),
			).toBe(true);

			await reputation.recordSuccess({
				siteId: site.id,
				email: "recipient@example.com",
				nowIso: "2026-06-02T10:11:00.000Z",
			});

			expect(
				await reputation.isSuppressed({
					siteId: site.id,
					email: "recipient@example.com",
					nowIso: "2026-06-02T10:12:00.000Z",
				}),
			).toBe(false);
		} finally {
			fixture.cleanup();
		}
	});

	it("stores only token hashes for unsubscribe tokens and rejects replay", async () => {
		const fixture = createFixture();
		try {
			const site = await seedSite(fixture);
			const preferences = new CommenterPreferencesRepository(fixture.db);
			const tokens = new UnsubscribeTokenService(fixture.db, preferences);

			await preferences.upsertFromCommentForm({
				siteId: site.id,
				email: "subscriber@example.com",
				notifyOnReply: true,
			});
			const issued = await tokens.issue({
				siteId: site.id,
				email: "subscriber@example.com",
				purpose: "commenter_reply",
				expiresAt: "2026-06-03T10:00:00.000Z",
			});
			const first = await tokens.consume({
				token: issued.token,
				nowIso: "2026-06-02T10:00:00.000Z",
			});
			const replay = await tokens.consume({
				token: issued.token,
				nowIso: "2026-06-02T10:01:00.000Z",
			});

			const rows = await fixture.db.select().from(unsubscribeTokens);
			expect(rows).toHaveLength(1);
			expect(rows[0]?.tokenHash).not.toBe(issued.token);
			expect(first.status).toBe("unsubscribed");
			expect(replay.status).toBe("invalid");
		} finally {
			fixture.cleanup();
		}
	});
});
