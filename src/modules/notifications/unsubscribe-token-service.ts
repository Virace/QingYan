import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, isNull, or } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { unsubscribeTokens } from "../../db/schema";
import type { CommenterPreferencesRepository } from "./commenter-preferences-repository";
import {
	hashNotificationEmail,
	normalizeNotificationEmail,
} from "./email-address-policy";

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export class UnsubscribeTokenService {
	public constructor(
		private readonly db: AppDatabase,
		private readonly preferences: CommenterPreferencesRepository,
	) {}

	public async issue(input: {
		siteId: number;
		email: string;
		purpose: "commenter_reply";
		expiresAt?: string | null;
	}) {
		const normalizedEmail = normalizeNotificationEmail(input.email);
		const emailHash = hashNotificationEmail(normalizedEmail);
		if (!emailHash) {
			throw new Error("Cannot issue unsubscribe token without email.");
		}
		const token = randomBytes(32).toString("base64url");
		await this.db.insert(unsubscribeTokens).values({
			id: `unsubscribe_${randomUUID().replaceAll("-", "")}`,
			siteId: input.siteId,
			emailHash,
			tokenHash: hashToken(token),
			purpose: input.purpose,
			expiresAt: input.expiresAt ?? null,
		});

		return { token };
	}

	public async consume(input: { token: string; nowIso?: string }) {
		const timestamp = input.nowIso ?? new Date().toISOString();
		const [row] = await this.db
			.select()
			.from(unsubscribeTokens)
			.where(
				and(
					eq(unsubscribeTokens.tokenHash, hashToken(input.token)),
					isNull(unsubscribeTokens.consumedAt),
					or(
						isNull(unsubscribeTokens.expiresAt),
						gt(unsubscribeTokens.expiresAt, timestamp),
					),
				),
			)
			.limit(1);
		if (!row) {
			return { status: "invalid" as const };
		}

		await this.db
			.update(unsubscribeTokens)
			.set({ consumedAt: timestamp })
			.where(eq(unsubscribeTokens.id, row.id));
		await this.preferences.unsubscribe({
			siteId: row.siteId,
			emailHash: row.emailHash,
			nowIso: timestamp,
		});

		return { status: "unsubscribed" as const };
	}
}
