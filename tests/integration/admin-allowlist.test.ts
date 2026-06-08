import { afterEach, describe, expect, it } from "vitest";
import { eq, isNotNull } from "drizzle-orm";

import {
	allowlistRules,
	blacklistRules,
	sitePageRegistry,
	siteSettings,
	sites,
} from "../../src/db/schema";
import { deriveCanonicalPageKeyFromPathname } from "../../src/modules/shared/canonical-page-key";
import { serializeCommentInputLimits } from "../../src/modules/shared/site-settings-defaults";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

type TestFixture = Awaited<ReturnType<typeof createTestApp>>;

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function getSiteId(fixture: TestFixture, siteKey = "fangyuan") {
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, siteKey));
	if (!site) {
		throw new Error(`Expected site ${siteKey} to exist`);
	}
	return site.id;
}

async function seedPage(
	fixture: TestFixture,
	pageKey: string,
	status: "active" | "stale" = "active",
) {
	const siteId = await getSiteId(fixture);
	const canonicalPageKey = deriveCanonicalPageKeyFromPathname(pageKey);
	await fixture.app.db.insert(sitePageRegistry).values({
		siteId,
		pageKey: canonicalPageKey,
		pageUrl: canonicalPageKey,
		status,
	});
}

function refererFor(pageKey: string) {
	return {
		referer: `http://localhost:4321/${pageKey}`,
	};
}

function makeCommentPayload(pageKey: string, suffix: string, content = suffix) {
	return {
		siteKey: "fangyuan",
		pageKey,
		pageTitle: "Allowlist Test",
		pageUrl: `https://fangyuan.example.com/${pageKey}`,
		parentCommentId: null,
		author: {
			name: "Alice",
			email: "alice@example.com",
		},
		content: {
			raw: content,
		},
		options: {
			notifyOnReply: false,
		},
	};
}

describe("admin allowlist", () => {
	it("creates, lists, updates, and soft-deletes allowlist rules", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/allowlist",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				targetType: "email",
				matchMode: "domain",
				targetValue: "Example.COM",
				scope: "all",
				reason: "trusted domain",
			},
		});
		expect(createResponse.statusCode).toBe(200);
		expect(createResponse.json()).toMatchObject({
			rule: {
				targetType: "email",
				matchMode: "domain",
				targetValue: "example.com",
				scope: "all",
				reason: "trusted domain",
			},
		});
		const ruleId = (createResponse.json() as { rule: { id: number } }).rule.id;

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/allowlist?siteKey=fangyuan&search=trusted",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json()).toMatchObject({
			items: [
				{
					id: ruleId,
					targetValue: "example.com",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const patchResponse = await fixture.app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/allowlist/${ruleId}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				matchMode: "exact",
				targetValue: "Writer@Example.COM",
				reason: "trusted sender",
			},
		});
		expect(patchResponse.statusCode).toBe(200);
		expect(patchResponse.json()).toMatchObject({
			rule: {
				id: ruleId,
				matchMode: "exact",
				targetValue: "writer@example.com",
				reason: "trusted sender",
			},
		});

		const deleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/allowlist/${ruleId}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});
		expect(deleteResponse.statusCode).toBe(200);
		const activeList = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/allowlist?siteKey=fangyuan",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(activeList.json()).toMatchObject({
			items: [],
			pagination: {
				totalCount: 0,
			},
		});
		const [softDeleted] = await fixture.app.db
			.select()
			.from(allowlistRules)
			.where(isNotNull(allowlistRules.deletedAt));
		expect(softDeleted?.id).toBe(ruleId);
	});

	it("allows a matching allowlisted IP even when the same IP is blacklisted", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const siteId = await getSiteId(fixture);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
		});
		await seedPage(fixture, "post:allowlisted-blacklist");
		await fixture.app.db.insert(blacklistRules).values({
			siteId,
			targetType: "ip",
			matchMode: "exact",
			targetValue: "127.0.0.1",
			scope: "post",
		});
		await fixture.app.db.insert(allowlistRules).values({
			siteId,
			targetType: "ip",
			matchMode: "exact",
			targetValue: "127.0.0.1",
			scope: "post",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("post:allowlisted-blacklist"),
			payload: makeCommentPayload("post:allowlisted-blacklist", "allowed"),
		});

		expect(response.statusCode).toBe(200);
	});

	it("does not create auto blacklist rules for allowlisted IPs", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const siteId = await getSiteId(fixture);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			abuseGuardEnabled: true,
			abuseGuardWindowSec: 600,
			abuseGuardMaxWriteActions: 1,
			autoBlacklistEnabled: true,
			autoBlacklistScope: "post",
			autoBlacklistTtlSec: 1800,
		});
		await seedPage(fixture, "post:allowlisted-auto-blacklist");
		await fixture.app.db.insert(allowlistRules).values({
			siteId,
			targetType: "ip",
			matchMode: "exact",
			targetValue: "127.0.0.1",
			scope: "post",
		});

		for (const suffix of ["1", "2", "3"]) {
			const response = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/comments",
				headers: refererFor("post:allowlisted-auto-blacklist"),
				payload: makeCommentPayload(
					"post:allowlisted-auto-blacklist",
					suffix,
					`comment-${suffix}`,
				),
			});
			expect(response.statusCode).toBe(200);
		}
		expect(await fixture.app.db.select().from(blacklistRules)).toEqual([]);
	});

	it("does not bypass configured input length validation", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const siteId = await getSiteId(fixture);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
			commentInputLimitsJson: serializeCommentInputLimits({
				contentMaxLength: 5,
			}),
		});
		await seedPage(fixture, "post:allowlist-length");
		await fixture.app.db.insert(allowlistRules).values({
			siteId,
			targetType: "ip",
			matchMode: "exact",
			targetValue: "127.0.0.1",
			scope: "all",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("post:allowlist-length"),
			payload: makeCommentPayload("post:allowlist-length", "long", "too long"),
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "VALIDATION_FAILED",
			},
		});
	});

	it("does not bypass non-interactive page checks", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const siteId = await getSiteId(fixture);
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "never",
		});
		await seedPage(fixture, "post:allowlist-stale", "stale");
		await fixture.app.db.insert(allowlistRules).values({
			siteId,
			targetType: "ip",
			matchMode: "exact",
			targetValue: "127.0.0.1",
			scope: "all",
		});

		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: refererFor("post:allowlist-stale"),
			payload: makeCommentPayload("post:allowlist-stale", "blocked"),
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: {
				code: "PAGE_NOT_INTERACTIVE",
			},
		});
	});
});
