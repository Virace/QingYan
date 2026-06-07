import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
	blacklistRules,
	commentRequestMetadata,
	comments,
	pageThreads,
	pageViewSessions,
	siteSettings,
	sites,
	visitors,
	visitorRequestMetadata,
} from "../../src/db/schema";
import { serializeEngagementSettings } from "../../src/modules/shared/site-settings-defaults";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin visitors", () => {
	it("persists backend-derived visitor metadata for page visits", async () => {
		const fixture = await createTestApp({
			commentMetadataResolver: {
				resolve: () => ({
					authorIpCountry: "United States",
					authorIpRegion: "California",
					authorIpCity: "Palo Alto",
					authorIpIsp: "Test ISP",
					authorIpLocationRaw: "United States|California|Palo Alto|Test ISP|US",
					authorIpLocationSource: "test",
					authorIpLocationDbHash: "hash-test",
					authorIpLocationUpdatedAt: "2026-05-30T00:00:00.000Z",
					authorIpLocationError: null,
					authorDeviceBrowser: "chrome",
					authorDeviceBrowserVersion: "125.0.0.0",
					authorDeviceOs: "windows",
					authorDeviceOsVersion: "11",
					authorDeviceType: "desktop",
					authorDeviceIcon: "chrome",
					authorDeviceSource: "ua-parser-js",
					authorDeviceParserVersion: "test",
					authorDeviceUpdatedAt: "2026-05-30T00:00:00.000Z",
					authorDeviceError: null,
				}),
				close() {},
			},
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:visitor-derived&pageTitle=Visitor%20Derived",
			headers: {
				referer: "http://localhost:4321/posts/visitor-derived/",
				"user-agent": "Mozilla/5.0 metadata visitor",
			},
		});

		expect(response.statusCode).toBe(200);
		const rows = await fixture.app.db.select().from(visitorRequestMetadata);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			userAgent: "Mozilla/5.0 metadata visitor",
			ipCountry: "United States",
			ipRegion: "California",
			ipCity: "Palo Alto",
			deviceBrowser: "chrome",
			deviceOs: "windows",
			deviceType: "desktop",
		});
	});

	it("returns disabled metadata instead of visitor rows when visitor records are off", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);
		const { adminCookie } = await loginAsAdmin(fixture.app);
		await fixture.app.db.update(siteSettings).set({
			engagementJson: serializeEngagementSettings({
				visitors: { enabled: false },
				pageViews: { enabled: false },
				pageLikes: { enabled: false },
				commentVotes: { enabled: false },
			}),
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/visitors?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			enabled: false,
			trustMode: "lightweight",
			items: [],
			message: "访客记录未启用。QingYan 当前不记录访客身份，也不提供访客画像。",
			pagination: {
				limit: 20,
				offset: 0,
				totalCount: 0,
			},
		});
	});

	it("does not write device metadata when visitor user-agent is missing", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:no-ua&pageTitle=No%20UA",
			headers: {
				referer: "http://localhost:4321/posts/no-ua/",
				"user-agent": "",
			},
		});

		expect(response.statusCode).toBe(200);
		const rows = await fixture.app.db.select().from(visitorRequestMetadata);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.userAgent ?? null).toBeNull();
		expect(rows[0]?.deviceBrowser ?? null).toBeNull();
		expect(rows[0]?.deviceOs ?? null).toBeNull();
		expect(rows[0]?.deviceType ?? null).toBeNull();
		expect(rows[0]?.deviceSource ?? null).toBeNull();
	});

	it("lists visitor aggregates and blacklist state", async () => {
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

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "visitor_admin_1",
			lastIp: "203.0.113.31",
			lastUserAgent: "Mozilla/5.0 Safari/17.0 iOS",
			lastSeenPageKey: "post:visitor-1",
			lastSeenPageUrl: "/posts/visitor-1/",
			lastSeenAt: "2026-04-17T10:03:00.000Z",
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "visitor_admin_1"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(pageThreads).values({
			siteId: site.id,
			pageKey: "post:visitor-1",
			pageTitle: "Visitor One",
		});
		const [thread] = await fixture.app.db
			.select()
			.from(pageThreads)
			.where(eq(pageThreads.pageKey, "post:visitor-1"));
		if (!thread) {
			throw new Error("Expected thread to exist");
		}

		await fixture.app.db.insert(pageViewSessions).values({
			pageThreadId: thread.id,
			visitorId: visitor.id,
			fingerprint: "visitor-admin-fingerprint",
			seenAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(comments).values({
			id: "c_visitor_1",
			siteId: site.id,
			pageThreadId: thread.id,
			parentId: null,
			visitorId: visitor.id,
			status: "approved",
			authorName: "Alice",
			authorEmail: "alice@example.com",
			contentRaw: "hello visitor",
			contentHtml: "<p>hello visitor</p>",
			replyCount: 0,
			voteUpCount: 0,
			voteDownCount: 0,
			createdAt: "2026-04-17T10:00:00.000Z",
			updatedAt: "2026-04-17T10:00:00.000Z",
		});
		await fixture.app.db.insert(commentRequestMetadata).values({
			commentId: "c_visitor_1",
			authorIp: "203.0.113.30",
			authorUserAgent: "QingYan Visitor Browser",
		});
		await fixture.app.db.insert(visitorRequestMetadata).values([
			{
				siteId: site.id,
				visitorId: visitor.id,
				ip: "203.0.113.30",
				ipHash: "ip_hash_30",
				userAgent: "Mozilla/5.0 Chrome/120.0.0.0 Windows",
				userAgentHash: "ua_hash_chrome",
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
				lastSeenAt: "2026-04-17T10:00:00.000Z",
				seenCount: 3,
				lastSeenPageKey: "post:visitor-1",
				lastSeenPageUrl: "/posts/visitor-1/",
			},
			{
				siteId: site.id,
				visitorId: visitor.id,
				ip: "203.0.113.31",
				ipHash: "ip_hash_31",
				userAgent: "Mozilla/5.0 Safari/17.0 iOS",
				userAgentHash: "ua_hash_safari",
				ipCountry: "中国",
				ipRegion: "广东",
				ipCity: "深圳",
				ipIsp: "联通",
				deviceBrowser: "safari",
				deviceBrowserVersion: "17.0",
				deviceOs: "ios",
				deviceOsVersion: "17",
				deviceType: "mobile",
				deviceIcon: "safari",
				lastSeenAt: "2026-04-17T10:03:00.000Z",
				seenCount: 1,
				lastSeenPageKey: "post:visitor-1",
				lastSeenPageUrl: "/posts/visitor-1/",
			},
		]);
		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "visitor_admin_2",
			lastIp: "198.51.100.20",
			lastUserAgent: "Mozilla/5.0 Firefox/126.0 Linux",
			lastSeenPageKey: "post:visitor-2",
			lastSeenPageUrl: "/posts/visitor-2/",
			lastSeenAt: "2026-04-17T09:00:00.000Z",
		});
		const [secondVisitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "visitor_admin_2"));
		if (!secondVisitor) {
			throw new Error("Expected second visitor to exist");
		}
		await fixture.app.db.insert(visitorRequestMetadata).values({
			siteId: site.id,
			visitorId: secondVisitor.id,
			ip: "198.51.100.20",
			ipHash: "ip_hash_20",
			userAgent: "Mozilla/5.0 Firefox/126.0 Linux",
			userAgentHash: "ua_hash_firefox",
			ipCountry: "United States",
			ipRegion: "California",
			ipCity: "Palo Alto",
			ipIsp: "Example ISP",
			deviceBrowser: "firefox",
			deviceBrowserVersion: "126.0",
			deviceOs: "linux",
			deviceOsVersion: "6",
			deviceType: "desktop",
			deviceIcon: "firefox",
			lastSeenAt: "2026-04-17T09:00:00.000Z",
			seenCount: 2,
			lastSeenPageKey: "post:visitor-2",
			lastSeenPageUrl: "/posts/visitor-2/",
		});
		await fixture.app.db.insert(blacklistRules).values({
			siteId: site.id,
			scope: "post",
			targetType: "visitor",
			targetValue: "visitor_admin_1",
			matchMode: "exact",
			source: "manual",
		});
		await fixture.app.db.insert(blacklistRules).values({
			siteId: site.id,
			scope: "post",
			targetType: "ip",
			targetValue: "203.0.113.31",
			matchMode: "exact",
			source: "manual",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/visitors?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		const responseJson = response.json();
		expect(responseJson.items[0]).toMatchObject({
			visitorKey: "visitor_admin_1",
			commentCount: 1,
			pageCount: 1,
			emailCount: 1,
			emails: ["alice@example.com"],
			ips: ["203.0.113.30"],
			userAgents: ["QingYan Visitor Browser"],
			lastRequestMeta: {
				ip: {
					raw: "203.0.113.31",
					location: {
						label: "中国 / 广东 / 深圳",
					},
				},
				userAgent: {
					raw: "Mozilla/5.0 Safari/17.0 iOS",
					device: {
						label: "safari 17 / ios 17 / mobile",
					},
				},
			},
			ipLocations: [
				{
					key: "中国|广东|深圳",
					label: "中国 / 广东 / 深圳",
					count: 4,
					distinctIpCount: 2,
				},
			],
			devices: [
				{
					key: "chrome|windows|desktop",
					label: "chrome 120 / windows 10 / desktop",
					count: 3,
				},
				{
					key: "safari|ios|mobile",
					label: "safari 17 / ios 17 / mobile",
					count: 1,
				},
			],
			blacklist: {
				ip: true,
				visitor: true,
			},
		});
		expect(responseJson).toMatchObject({
			pagination: {
				totalCount: 2,
			},
		});

		const assertVisitorFilter = async (
			query: string,
			expectedVisitors: string[],
		) => {
			const filterResponse = await fixture.app.inject({
				method: "GET",
				url: `/qingyan/api/admin/visitors?siteKey=fangyuan&${query}&limit=20&offset=0`,
				cookies: {
					qingyan_admin: adminCookie?.value ?? "",
				},
			});
			expect(filterResponse.statusCode).toBe(200);
			const json = filterResponse.json();
			expect(
				json.items.map((item: { visitorKey: string }) => item.visitorKey),
			).toEqual(expectedVisitors);
			expect(json.pagination.totalCount).toBe(expectedVisitors.length);
		};

		await assertVisitorFilter("ip=203.0.113.30", ["visitor_admin_1"]);
		await assertVisitorFilter("userAgent=Firefox", ["visitor_admin_2"]);
		await assertVisitorFilter("pageUrl=visitor-2", ["visitor_admin_2"]);
		await assertVisitorFilter("device=mobile", ["visitor_admin_1"]);
		await assertVisitorFilter("location=%E4%B8%AD%E5%9B%BD", [
			"visitor_admin_1",
		]);
		await assertVisitorFilter("blacklist=ip", ["visitor_admin_1"]);
		await assertVisitorFilter("blacklist=none", ["visitor_admin_2"]);
	});

	it("does not aggregate visitor missing or unparsed user agents as unknown devices", async () => {
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

		await fixture.app.db.insert(visitors).values({
			siteId: site.id,
			visitorKey: "visitor_empty_ua",
			lastIp: "203.0.113.40",
			lastUserAgent: null,
		});
		const [visitor] = await fixture.app.db
			.select()
			.from(visitors)
			.where(eq(visitors.visitorKey, "visitor_empty_ua"));
		if (!visitor) {
			throw new Error("Expected visitor to exist");
		}

		await fixture.app.db.insert(visitorRequestMetadata).values([
			{
				siteId: site.id,
				visitorId: visitor.id,
				ip: "203.0.113.40",
				ipHash: "ip_hash_40",
				userAgent: "Mozilla/5.0 Chrome/120.0.0.0 Windows",
				userAgentHash: "ua_hash_chrome_40",
				deviceBrowser: "chrome",
				deviceBrowserVersion: "120.0.0.0",
				deviceOs: "windows",
				deviceOsVersion: "10",
				deviceType: "desktop",
				seenCount: 1,
			},
			{
				siteId: site.id,
				visitorId: visitor.id,
				ip: "203.0.113.41",
				ipHash: "ip_hash_41",
				userAgent: null,
				userAgentHash: null,
				seenCount: 2,
			},
			{
				siteId: site.id,
				visitorId: visitor.id,
				ip: "203.0.113.42",
				ipHash: "ip_hash_42",
				userAgent: "Legacy UA without parsed snapshot",
				userAgentHash: "ua_hash_legacy_42",
				seenCount: 3,
			},
		]);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/visitors?siteKey=fangyuan&limit=20&offset=0",
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

	it("lists request metadata for visitors without comments", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie } = await loginAsAdmin(fixture.app);

		const bootstrap = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:visitor-metadata&pageTitle=Visitor%20Metadata",
			headers: {
				referer: "http://localhost:4321/posts/visitor-metadata/",
				"x-forwarded-for": "203.0.113.90",
				"user-agent": "QingYan Metadata Browser",
			},
		});
		expect(bootstrap.statusCode).toBe(200);
		const metadataRows = await fixture.app.db
			.select()
			.from(visitorRequestMetadata);
		expect(metadataRows).toHaveLength(1);
		expect(metadataRows[0]).toMatchObject({
			ip: "127.0.0.1",
			userAgent: "QingYan Metadata Browser",
			seenCount: 1,
			lastSeenPageKey: "/posts/visitor-metadata/",
			lastSeenPageUrl: "/posts/visitor-metadata/",
		});

		const response = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/visitors?siteKey=fangyuan&limit=20&offset=0",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			items: [
				{
					commentCount: 0,
					pageCount: 0,
					ips: [],
					userAgents: [],
					lastIp: "127.0.0.1",
					lastUserAgent: "QingYan Metadata Browser",
					lastRequestMeta: {
						ip: {
							raw: "127.0.0.1",
						},
						userAgent: {
							raw: "QingYan Metadata Browser",
						},
					},
					ipLocations: expect.any(Array),
					devices: expect.any(Array),
					lastSeenPageKey: "/posts/visitor-metadata/",
					lastSeenPageUrl: "http://localhost:4321/posts/visitor-metadata/",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});
	});
});
