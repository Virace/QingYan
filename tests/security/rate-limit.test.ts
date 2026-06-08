import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { blacklistRules, siteSettings, sites } from "../../src/db/schema";
import { MemoryRateLimitStore } from "../../src/modules/shared/rate-limit";
import { createTestApp } from "../support/test-fixtures";

describe("MemoryRateLimitStore", () => {
	it("throws after the configured request limit is exceeded", () => {
		const store = new MemoryRateLimitStore();
		const rule = { windowSec: 60, maxRequests: 2 };

		expect(store.consume("public:fangyuan:v1:comment_create", rule).count).toBe(
			1,
		);
		expect(store.consume("public:fangyuan:v1:comment_create", rule).count).toBe(
			2,
		);
		expect(() =>
			store.consume("public:fangyuan:v1:comment_create", rule),
		).toThrow();
	});

	it("drops expired buckets when asked to clear state", () => {
		const store = new MemoryRateLimitStore();
		const rule = { windowSec: 1, maxRequests: 2 };
		const now = 1_000;

		store.consume("public:fangyuan:v1:comment_create", rule, now);
		store.clearExpired(now + 1_500);

		expect(
			store.peek("public:fangyuan:v1:comment_create", rule, now + 1_500),
		).toMatchObject({
			count: 0,
			remaining: 2,
		});
	});
});

describe("security plugin", () => {
	it("loads seeded sites and rejects blacklisted visitors", async () => {
		const fixture = await createTestApp();

		try {
			const [site] = await fixture.app.db
				.select()
				.from(sites)
				.where(eq(sites.siteKey, "fangyuan"));
			expect(site?.name).toBe("FangYuan");
			if (!site) {
				throw new Error("Expected synced site record to exist");
			}

			const [settings] = await fixture.app.db
				.select()
				.from(siteSettings)
				.where(eq(siteSettings.siteId, site.id));
			expect(settings?.rootLimit).toBe(20);

			await fixture.app.db.insert(blacklistRules).values({
				siteId: site.id,
				scope: "post",
				targetType: "visitor",
				targetValue: "blocked_visitor",
				matchMode: "exact",
				source: "manual",
			});

			await expect(
				fixture.app.security.assertNotBlacklisted({
					siteKey: "fangyuan",
					visitorKey: "blocked_visitor",
					requestScope: "read",
					errorCode: "READ_BLACKLISTED",
					errorMessage: "当前请求已被拒绝。",
				}),
			).resolves.toBeUndefined();

			await expect(
				fixture.app.security.assertNotBlacklisted({
					siteKey: "fangyuan",
					visitorKey: "blocked_visitor",
					requestScope: "write",
					errorCode: "COMMENT_BLACKLISTED",
					errorMessage: "当前请求已被拒绝。",
				}),
			).rejects.toThrow();
		} finally {
			await fixture.cleanup();
		}
	});
});
