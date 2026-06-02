import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	blacklistRules,
	commentRequestMetadata,
	commenterNotificationPreferences,
	comments,
	emailDeliveryReputation,
	pageThreads,
	sites,
} from "../../src/db/schema";
import { hashNotificationEmail } from "../../src/modules/notifications/email-address-policy";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin commenters", () => {
	it("aggregates commenters by email and collects multiple nicknames", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values([
			{
				siteId: site.id,
				pageKey: "post:user-1",
				pageTitle: "User One",
			},
			{
				siteId: site.id,
				pageKey: "post:user-2",
				pageTitle: "User Two",
			},
		]);
		const threads = await fixture.app.db.select().from(pageThreads);
		const firstThread = threads[0];
		const secondThread = threads[1];
		if (!firstThread || !secondThread) {
			throw new Error("Expected both threads to exist");
		}

		await fixture.app.db.insert(comments).values([
			{
				id: "c_user_1",
				siteId: site.id,
				pageThreadId: firstThread.id,
				parentId: null,
				status: "approved",
				authorName: "Alice",
				authorEmail: "alice@example.com",
				contentRaw: "hello 1",
				contentHtml: "<p>hello 1</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-04-17T10:00:00.000Z",
				updatedAt: "2026-04-17T10:00:00.000Z",
			},
			{
				id: "c_user_2",
				siteId: site.id,
				pageThreadId: secondThread.id,
				parentId: null,
				status: "pending",
				authorName: "Alicia",
				authorEmail: "alice@example.com",
				contentRaw: "hello 2",
				contentHtml: "<p>hello 2</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-04-17T10:01:00.000Z",
				updatedAt: "2026-04-17T10:01:00.000Z",
			},
			{
				id: "c_user_3",
				siteId: site.id,
				pageThreadId: secondThread.id,
				parentId: null,
				status: "approved",
				authorName: "ALICE",
				authorEmail: "Alice@Example.com",
				contentRaw: "hello 3",
				contentHtml: "<p>hello 3</p>",
				replyCount: 0,
				voteUpCount: 0,
				voteDownCount: 0,
				createdAt: "2026-04-17T10:02:00.000Z",
				updatedAt: "2026-04-17T10:02:00.000Z",
			},
		]);
		await fixture.app.db.insert(commentRequestMetadata).values([
			{
				commentId: "c_user_1",
				authorIp: "203.0.113.20",
				authorUserAgent: "Mozilla/5.0 Chrome/120.0.0.0 Windows",
				ipCountry: "中国",
				ipRegion: "广东",
				ipCity: "深圳",
				ipIsp: "电信",
				deviceBrowser: "chrome",
				deviceBrowserVersion: "120.0.0.0",
				deviceOs: "windows",
				deviceOsVersion: "10",
				deviceType: "desktop",
				deviceIcon: "chrome",
			},
			{
				commentId: "c_user_2",
				authorIp: "203.0.113.21",
				authorUserAgent: "Mozilla/5.0 Chrome/120.0.0.0 Windows",
				ipCountry: "中国",
				ipRegion: "广东",
				ipCity: "深圳",
				ipIsp: "联通",
				deviceBrowser: "chrome",
				deviceBrowserVersion: "120.0.0.0",
				deviceOs: "windows",
				deviceOsVersion: "10",
				deviceType: "desktop",
				deviceIcon: "chrome",
			},
			{
				commentId: "c_user_3",
				authorIp: "203.0.113.22",
				authorUserAgent: "Mozilla/5.0 Safari/17.0 iOS",
				ipCountry: "中国",
				ipRegion: "江苏",
				ipCity: "南京",
				ipIsp: "移动",
				deviceBrowser: "safari",
				deviceBrowserVersion: "17.0",
				deviceOs: "ios",
				deviceOsVersion: "17",
				deviceType: "mobile",
				deviceIcon: "safari",
			},
		]);
		await fixture.app.db.insert(blacklistRules).values({
			siteId: site.id,
			scope: "post",
			targetType: "email",
			targetValue: "alice@example.com",
			matchMode: "exact",
			source: "manual",
		});
		await fixture.app.db.insert(commenterNotificationPreferences).values({
			id: "pref_admin_commenters_alice",
			siteId: site.id,
			email: "alice@example.com",
			emailHash: hashNotificationEmail("alice@example.com") ?? "",
			notifyOnReply: true,
			source: "comment_form",
		});
		await fixture.app.db.insert(emailDeliveryReputation).values({
			siteId: site.id,
			email: "alice@example.com",
			emailHash: hashNotificationEmail("alice@example.com") ?? "",
			failureScore: 2,
			lastFailureAt: "2026-06-02T09:00:00.000Z",
			lastSuccessAt: "2026-06-02T08:00:00.000Z",
			suppressedUntil: "2026-06-09T09:00:00.000Z",
			suppressedReason: "bounce",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/commenters?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					email: "alice@example.com",
					emailVariants: ["alice@example.com", "Alice@Example.com"],
					names: ["Alice", "Alicia", "ALICE"],
					commentCount: 3,
					pendingCount: 1,
					approvedCount: 2,
					pageCount: 2,
					siteCount: 1,
					ips: ["203.0.113.20", "203.0.113.21", "203.0.113.22"],
					userAgents: [
						"Mozilla/5.0 Chrome/120.0.0.0 Windows",
						"Mozilla/5.0 Safari/17.0 iOS",
					],
					ipLocations: [
						{
							key: "中国|广东|深圳",
							label: "中国 / 广东 / 深圳",
							count: 2,
							distinctIpCount: 2,
						},
						{
							key: "中国|江苏|南京",
							label: "中国 / 江苏 / 南京",
							count: 1,
							distinctIpCount: 1,
						},
					],
					devices: [
						{
							key: "chrome|windows|desktop",
							label: "chrome 120 / windows 10 / desktop",
							count: 2,
						},
						{
							key: "safari|ios|mobile",
							label: "safari 17 / ios 17 / mobile",
							count: 1,
						},
					],
					blacklist: {
						email: true,
					},
					isBlacklisted: true,
					notifications: {
						notifyOnReply: true,
						unsubscribedAt: null,
						reputationScore: 2,
						lastSuccessAt: "2026-06-02T08:00:00.000Z",
						lastFailureAt: "2026-06-02T09:00:00.000Z",
						suppressedUntil: "2026-06-09T09:00:00.000Z",
					},
				},
			],
			pagination: {
				totalCount: 1,
			},
		});

		const searchResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/commenters?siteKey=fangyuan&search=alice@example.com&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(searchResponse.statusCode).toBe(200);
		expect(searchResponse.json()).toMatchObject({
			items: [
				{
					email: "alice@example.com",
					commentCount: 3,
					emailVariants: ["alice@example.com", "Alice@Example.com"],
				},
			],
			pagination: {
				totalCount: 1,
			},
		});
	});

	it("keeps anonymous commenters separate from backend users", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/commenters?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [],
			pagination: {
				totalCount: 0,
			},
		});
	});

	it("does not aggregate missing or unparsed user agents as unknown devices", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);
		const [site] = await fixture.app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Expected site to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:commenter-empty-ua",
			pageTitle: "Commenter Empty UA",
		});
		const [thread] = await fixture.app.db.select().from(pageThreads);
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(comments).values([
			{
				id: "c_empty_ua_1",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "approved",
				authorName: "Alice",
				authorEmail: "alice@example.com",
				contentRaw: "parsed ua",
				contentHtml: "<p>parsed ua</p>",
			},
			{
				id: "c_empty_ua_2",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "approved",
				authorName: "Alice",
				authorEmail: "alice@example.com",
				contentRaw: "missing ua",
				contentHtml: "<p>missing ua</p>",
			},
			{
				id: "c_empty_ua_3",
				siteId: site.id,
				pageThreadId: thread.id,
				parentId: null,
				status: "approved",
				authorName: "Alice",
				authorEmail: "alice@example.com",
				contentRaw: "old unparsed ua",
				contentHtml: "<p>old unparsed ua</p>",
			},
		]);
		await fixture.app.db.insert(commentRequestMetadata).values([
			{
				commentId: "c_empty_ua_1",
				authorUserAgent: "Mozilla/5.0 Chrome/120.0.0.0 Windows",
				deviceBrowser: "chrome",
				deviceBrowserVersion: "120.0.0.0",
				deviceOs: "windows",
				deviceOsVersion: "10",
				deviceType: "desktop",
			},
			{
				commentId: "c_empty_ua_2",
				authorUserAgent: null,
			},
			{
				commentId: "c_empty_ua_3",
				authorUserAgent: "Legacy UA without parsed snapshot",
			},
		]);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/commenters?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		const [item] = response.json().items;
		expect(item.devices).toEqual([
			expect.objectContaining({
				key: "chrome|windows|desktop",
				label: "chrome 120 / windows 10 / desktop",
				count: 1,
			}),
		]);
		expect(JSON.stringify(item.devices)).not.toContain("未知设备");
	});

	it("adds and removes email blacklist rules by target", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);
		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/blacklist",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				targetType: "email",
				targetValue: "BLOCKED@example.com",
				matchMode: "exact",
				scope: "post",
			},
		});
		expect(createResponse.statusCode).toBe(200);
		expect(createResponse.json()).toMatchObject({
			rule: {
				targetType: "email",
				targetValue: "blocked@example.com",
				matchMode: "exact",
			},
		});

		const deleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: "/qingyan/api/admin/blacklist/target",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				targetType: "email",
				targetValue: "blocked@example.com",
				matchMode: "exact",
			},
		});
		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			rules: [
				{
					targetType: "email",
					targetValue: "blocked@example.com",
				},
			],
		});

		const rules = await fixture.app.db.select().from(blacklistRules);
		expect(rules).toHaveLength(0);
	});
});
