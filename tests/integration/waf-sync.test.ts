import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	allowlistRules,
	commentRequestMetadata,
	comments,
	pageThreads,
	securityPenalties,
	siteSettings,
	sites,
	wafLogEvents,
	wafSyncRecords,
} from "../../src/db/schema";
import { hashKey } from "../../src/db/values";
import { readAbusePolicy } from "../../src/modules/comments/abuse-policy";
import {
	AbuseRepository,
	lockAbuseSubject,
} from "../../src/modules/comments/abuse-repository";
import {
	type WafAclRule,
	WafGatewayError,
} from "../../src/modules/waf/gateway-client";
import { WafLogIngestor } from "../../src/modules/waf/log-ingestor";
import { WafSyncRepository } from "../../src/modules/waf/repository";
import { WafRuntime } from "../../src/modules/waf/runtime";
import { WafSyncService } from "../../src/modules/waf/sync-service";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixtureSetup() {
	const fixture = await createTestApp();
	cleanups.push(fixture.cleanup);
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, "fangyuan"));
	if (!site) throw new Error("Expected seeded test site");
	const mapping = {
		siteKey: site.siteKey,
		websiteId: 42,
		websiteKey: "fangyuan-test",
		hosts: ["site.example.test"],
		autoBanScans: false,
	};
	const rules = new Map<string, WafAclRule>();
	let createCount = 0;
	let afterCreate: (() => Promise<void>) | undefined;
	const client = {
		websites: async () => [
			{ id: 42, alias: "fangyuan-test", primaryDomain: "site.example.test" },
		],
		findRule: async (websiteId: number, name: string) => {
			expect(websiteId).toBe(42);
			return rules.has(name)
				? structuredClone(rules.get(name) as WafAclRule)
				: null;
		},
		createRule: async (
			websiteId: number,
			_websiteKey: string,
			rule: WafAclRule,
		) => {
			expect(websiteId).toBe(42);
			createCount++;
			rules.set(rule.name, structuredClone(rule));
			await afterCreate?.();
		},
		updateRule: async (
			_websiteId: number,
			_websiteKey: string,
			rule: WafAclRule,
		) => {
			rules.set(rule.name, structuredClone(rule));
		},
		deleteRule: async (_websiteId: number, name: string) => {
			rules.delete(name);
		},
	};
	const abuse = new AbuseRepository(fixture.app.db);
	const penalty = await abuse.createPenalty({
		siteId: site.id,
		ip: "198.51.100.10",
		scope: "all",
		reason: "rate_limited",
		policy: readAbusePolicy(JSON.stringify({ syncToWaf: true })),
		count: 10,
	});
	const repository = new WafSyncRepository(fixture.app.db);
	const record = (await repository.listForSync(site.id))[0];
	if (!record) throw new Error("Expected transactional WAF intent");
	return {
		...fixture,
		site,
		mapping,
		rules,
		client,
		abuse,
		penalty,
		record,
		repository,
		createCount: () => createCount,
		afterCreate: (callback: () => Promise<void>) => {
			afterCreate = callback;
		},
		service: () => new WafSyncService(fixture.app.db, client, [mapping]),
	};
}

describe("WAF 站点限制同步", () => {
	it.each([
		{ failure: "503", unknown: false, release: false },
		{ failure: "timeout", unknown: false, release: true },
		{ failure: "schema", unknown: false, release: false },
		{ failure: "503", unknown: true, release: false },
	])("日志采集 $failure（未知站点 $unknown）不阻止到期或解除维护，保留失败供任务重试", async ({
		failure,
		unknown,
		release,
	}) => {
		const fixture = await fixtureSetup();
		await fixture.service().execute({ siteId: fixture.site.id });
		if (release) {
			await fixture.abuse.release({
				ruleId: fixture.penalty.sourceRuleId as number,
				kind: "released",
				reason: "人工解除",
			});
		} else {
			await fixture.app.db
				.update(securityPenalties)
				.set({
					startedAt: new Date(Date.now() - 60000).toISOString(),
					expiresAt: new Date(Date.now() - 1000).toISOString(),
				})
				.where(eq(securityPenalties.id, fixture.penalty.id));
		}
		const polled: string[] = [];
		let failLogs = true;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const path = new URL(String(input)).pathname;
			const body = init?.body ? JSON.parse(String(init.body)) : {};
			let data: unknown;
			if (path.endsWith("/log/search")) {
				polled.push(body.websiteKey);
				if (
					failLogs &&
					body.websiteKey === (unknown ? "unknown" : fixture.mapping.websiteKey)
				) {
					if (failure === "503") return new Response(null, { status: 503 });
					if (failure === "timeout")
						throw new DOMException("request timed out", "TimeoutError");
					return Response.json({
						code: 200,
						data: { total: "invalid", items: [] },
					});
				}
				data = { total: 0, items: [] };
			} else if (path.endsWith("/websites"))
				data = await fixture.client.websites();
			else if (path.endsWith("/rule/acl/search")) {
				const rule = await fixture.client.findRule(body.websiteID, body.name);
				data = { total: rule ? 1 : 0, items: rule ? [rule] : [] };
			} else if (path.endsWith("/rule/acl/delete")) {
				await fixture.client.deleteRule(body.websiteID, body.name);
				data = null;
			} else throw new Error(`Unexpected WAF request: ${path}`);
			return Response.json({ code: 200, data });
		});
		const runtime = new WafRuntime(fixture.app.db, {
			gatewayUrl: "http://waf-gateway.test",
			token: "local-test-token",
			sites: [fixture.mapping],
			collectUnknownHosts: true,
		});
		await expect(
			runtime.execute({ siteId: fixture.site.id }),
		).rejects.toBeInstanceOf(Error);
		expect(fixture.rules.size).toBe(0);
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			desiredState: "absent",
			observedState: "absent",
			syncState: "synced",
		});
		expect(polled.sort()).toEqual(
			[fixture.mapping.websiteKey, "unknown"].sort(),
		);
		failLogs = false;
		await expect(
			runtime.execute({ siteId: fixture.site.id }),
		).resolves.toMatchObject({
			logs: { status: "completed", inserted: 0 },
			sync: { status: "completed" },
		});
	});
	it.each([
		"released",
		"revoked",
	] as const)("旧扫描等待 IP 锁期间人工 %s 后只能保存证据，不能恢复处罚", async (kind) => {
		const fixture = await fixtureSetup();
		await fixture.app.db.update(siteSettings).set({
			abusePolicyJson: JSON.stringify({ syncToWaf: true }),
		});
		const event = {
			id: 90,
			ip: fixture.penalty.ip,
			action: "deny",
			uri: "/wp-login.php",
			execRule: "urlBlack",
			host: "site.example.test",
			localtime: new Date(Date.now() - 60000).toISOString(),
		};
		const ingestor = new WafLogIngestor(fixture.app.db, {
			logs: async () => ({ total: 1, items: [event] }),
		});
		let collection: Promise<unknown> | undefined;
		try {
			await fixture.app.db.transaction(async (tx) => {
				await lockAbuseSubject(tx, fixture.site.id, event.ip);
				collection = ingestor.collect(fixture.site.id, {
					...fixture.mapping,
					autoBanScans: true,
				});
				let waiting = false;
				for (let attempt = 0; attempt < 150; attempt++) {
					await tx.execute(sql`SELECT pg_stat_clear_snapshot()`);
					const activity = await tx.execute(
						sql`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND wait_event = 'advisory'`,
					);
					if (activity.rows.length) {
						waiting = true;
						break;
					}
					await delay(20);
				}
				expect(waiting).toBe(true);
				await new AbuseRepository(tx).release({
					ruleId: fixture.penalty.sourceRuleId as number,
					kind,
					reason: "人工解除旧扫描关联的限制",
				});
			});
		} finally {
			await collection;
		}
		expect(await fixture.app.db.select().from(securityPenalties)).toMatchObject(
			[{ id: fixture.penalty.id, releaseKind: kind }],
		);
		expect(await fixture.app.db.select().from(securityPenalties)).toHaveLength(
			1,
		);
		expect(await fixture.app.db.select().from(wafLogEvents)).toMatchObject([
			{ decision: "before_manual_release" },
		]);
		expect(await fixture.repository.listForSync(fixture.site.id)).toMatchObject(
			[{ desiredState: "absent", penaltyId: fixture.penalty.id }],
		);
		expect(await fixture.repository.listForSync(fixture.site.id)).toHaveLength(
			1,
		);
	});
	it("有效全局或站点IP白名单只留扫描证据，过期白名单不豁免", async () => {
		const fixture = await fixtureSetup();
		const now = new Date();
		await fixture.app.db.update(siteSettings).set({
			abusePolicyJson: JSON.stringify({ syncToWaf: true }),
		});
		await fixture.app.db.insert(allowlistRules).values([
			{
				targetType: "ip",
				targetValue: "203.0.113.40",
				matchMode: "exact",
				scope: "post",
			},
			{
				siteId: fixture.site.id,
				targetType: "ip",
				targetValue: "203.0.113.50/32",
				matchMode: "cidr",
				scope: "all",
			},
			{
				siteId: fixture.site.id,
				targetType: "ip",
				targetValue: "203.0.113.60",
				matchMode: "exact",
				scope: "all",
				expiresAt: new Date(now.getTime() - 60000).toISOString(),
			},
		]);
		const ingestor = new WafLogIngestor(fixture.app.db, {
			logs: async () => ({
				total: 3,
				items: [40, 50, 60].map((suffix) => ({
					id: suffix,
					ip: `203.0.113.${suffix}`,
					action: "deny",
					uri: "/wp-login.php",
					execRule: "urlBlack",
					host: "site.example.test",
					localtime: now.toISOString(),
				})),
			}),
		});
		await ingestor.collect(
			fixture.site.id,
			{ ...fixture.mapping, autoBanScans: true },
			now,
		);
		const events = await fixture.app.db.select().from(wafLogEvents);
		expect(
			events
				.filter((event) => event.decision === "allowlisted")
				.map((event) => event.ip)
				.sort(),
		).toEqual(["203.0.113.40", "203.0.113.50"]);
		expect(events.find((event) => event.ip === "203.0.113.60")?.decision).toBe(
			"scanner_penalty",
		);
		expect(
			(await fixture.app.db.select().from(securityPenalties))
				.map((penalty) => penalty.ip)
				.sort(),
		).toEqual(["198.51.100.10", "203.0.113.60"]);
	});
	it("共用出口经明确确认后持续同步，面板后续手工修改仍暂停", async () => {
		const fixture = await fixtureSetup();
		const [thread] = await fixture.app.db
			.insert(pageThreads)
			.values({
				siteId: fixture.site.id,
				pageKey: "/shared-ip/",
				pageKeyHash: hashKey("/shared-ip/"),
			})
			.returning();
		for (const suffix of ["a", "b"]) {
			await fixture.app.db.insert(comments).values({
				id: `shared-${suffix}`,
				siteId: fixture.site.id,
				pageThreadId: thread.id,
				authorName: suffix,
				authorEmailHash: `different-email-${suffix}`,
				contentRaw: "A comment from a shared network.",
			});
			await fixture.app.db.insert(commentRequestMetadata).values({
				commentId: `shared-${suffix}`,
				authorIp: fixture.penalty.ip,
			});
		}
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.rules.size).toBe(0);
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			reasonCode: "WAF_SHARED_IP_REVIEW",
		});
		await fixture.repository.requestSync(fixture.record.id, true);
		await fixture.service().execute({ siteId: fixture.site.id });
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			syncState: "synced",
			suspendedAt: null,
			restoreRequestedAt: null,
		});
		expect(fixture.rules.size).toBe(1);
		const remote = fixture.rules.get(fixture.record.ruleName) as WafAclRule;
		remote.state = "off";
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			syncState: "conflict",
			reasonCode: "WAF_RULE_CHANGED",
		});
	});
	it("解除入口重置原违规窗口，面板人工差异保留等待核对", async () => {
		const fixture = await fixtureSetup();
		await fixture.app.db.update(siteSettings).set({
			abuseGuardEnabled: true,
			autoBlacklistEnabled: true,
			abusePolicyJson: JSON.stringify({ violationThreshold: 3 }),
		});
		const violation = {
			siteId: fixture.site.id,
			siteKey: fixture.site.siteKey,
			ip: fixture.penalty.ip,
			reason: "rate_limited",
		};
		for (let index = 0; index < 3; index++)
			await fixture.app.security.recordWriteViolation(violation);
		await fixture.service().execute({ siteId: fixture.site.id });
		const remote = fixture.rules.get(fixture.record.ruleName) as WafAclRule;
		remote.state = "off";
		await fixture.service().execute({ siteId: fixture.site.id });
		const auth = await loginAsAdmin(fixture.app);
		const released = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/waf/${fixture.record.id}/release`,
			...withAdminWriteAuth(auth),
			payload: { reason: "允许正常访客重新尝试" },
		});
		expect(released.statusCode).toBe(200);
		expect(released.json()).toMatchObject({
			accepted: true,
			panelSync: "review_required",
		});
		await fixture.app.security.recordWriteViolation(violation);
		expect(await fixture.app.db.select().from(securityPenalties)).toHaveLength(
			1,
		);
		expect(await fixture.repository.penalty(fixture.penalty.id)).toMatchObject({
			releaseKind: "released",
		});
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.rules.get(fixture.record.ruleName)?.state).toBe("off");
	});
	it("上游超时但实际成功时先核对，再跨重启保持同一规则和原到期时间", async () => {
		const fixture = await fixtureSetup();
		fixture.afterCreate(async () => {
			throw new WafGatewayError("WAF_GATEWAY_UNAVAILABLE");
		});
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.createCount()).toBe(1);
		expect([...fixture.rules.values()][0]).toMatchObject({
			action: "deny",
			code: 403,
			ipBlock: "off",
			conditions: [
				{ field: "IP", pattern: "eq", rule: "198.51.100.10", name: "" },
			],
		});
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			syncState: "synced",
			observedState: "present",
			websiteId: 42,
			expiresAt: fixture.penalty.expiresAt,
		});
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.createCount()).toBe(1);
		await fixture
			.service()
			.execute(
				{ siteId: fixture.site.id },
				new Date(Date.parse(fixture.penalty.expiresAt) + 1),
			);
		expect(fixture.rules.size).toBe(0);
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			desiredState: "absent",
			observedState: "absent",
			expiresAt: fixture.penalty.expiresAt,
		});
	});

	it("面板人工删除后暂停自动补回，明确恢复才重新应用当前决定", async () => {
		const fixture = await fixtureSetup();
		await fixture.service().execute({ siteId: fixture.site.id });
		fixture.rules.clear();
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			syncState: "conflict",
			reasonCode: "WAF_RULE_REMOVED",
			observedState: "absent",
		});
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.createCount()).toBe(1);
		await expect(
			fixture.repository.requestSync(fixture.record.id, false),
		).rejects.toMatchObject({ code: "WAF_REVIEW_REQUIRED" });
		await fixture.repository.requestSync(fixture.record.id, true);
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.createCount()).toBe(2);
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			syncState: "synced",
			suspendedAt: null,
			expiresAt: fixture.penalty.expiresAt,
		});
	});

	it("解除期间才完成的旧上游创建会被补偿删除，不能覆盖新版本", async () => {
		const fixture = await fixtureSetup();
		fixture.afterCreate(async () => {
			await fixture.abuse.release({
				ruleId: fixture.penalty.sourceRuleId as number,
				kind: "released",
				reason: "人工解除",
			});
		});
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.rules.size).toBe(0);
		const current = await fixture.repository.get(fixture.record.id);
		expect(current).toMatchObject({
			penaltyVersion: 2,
			desiredState: "absent",
			observedState: "absent",
			syncState: "synced",
		});
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.createCount()).toBe(1);
	});

	it("面板人工改动不会在普通重试或本地解除时被覆盖", async () => {
		const fixture = await fixtureSetup();
		await fixture.service().execute({ siteId: fixture.site.id });
		const remote = fixture.rules.get(fixture.record.ruleName) as WafAclRule;
		remote.state = "off";
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			syncState: "conflict",
			reasonCode: "WAF_RULE_CHANGED",
		});
		await fixture.abuse.release({
			ruleId: fixture.penalty.sourceRuleId as number,
			kind: "released",
			reason: "保留面板人工处置",
		});
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.rules.get(fixture.record.ruleName)?.state).toBe("off");
		await fixture.repository.requestSync(fixture.record.id, true);
		await fixture.service().execute({ siteId: fixture.site.id });
		expect(fixture.rules.size).toBe(0);
	});

	it("重复读取扫描事件只产生一次依据，按事件时间保留十五天期限且不持久化原始请求", async () => {
		const fixture = await fixtureSetup();
		await fixture.app.db
			.update(siteSettings)
			.set({ abusePolicyJson: JSON.stringify({ syncToWaf: true }) })
			.where(eq(siteSettings.siteId, fixture.site.id));
		const now = new Date();
		const occurredAt = new Date(now.getTime() - 60000).toISOString();
		const event = {
			id: 9,
			ip: "203.0.113.42",
			action: "deny",
			uri: "/wp-login.php?token=private-query",
			execRule: "urlBlack",
			host: "site.example.test",
			localtime: occurredAt,
			nginxLog: "private-request-body",
		};
		const ingestor = new WafLogIngestor(fixture.app.db, {
			logs: async () => ({ total: 1, items: [event] }),
		});
		const mapping = { ...fixture.mapping, autoBanScans: true };
		expect(
			(await ingestor.collect(fixture.site.id, mapping, now)).inserted,
		).toBe(1);
		expect(
			(await ingestor.collect(fixture.site.id, mapping, now)).inserted,
		).toBe(0);
		const records = await fixture.app.db.select().from(wafLogEvents);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			path: "/wp-login.php",
			confidence: "unlinked",
			decision: "scanner_penalty",
		});
		expect(JSON.stringify(records)).not.toContain("private-query");
		expect(JSON.stringify(records)).not.toContain("private-request-body");
		const [penalty] = await fixture.app.db
			.select()
			.from(securityPenalties)
			.where(eq(securityPenalties.ip, "203.0.113.42"));
		expect(penalty.expiresAt).toBe(
			new Date(Date.parse(occurredAt) + 15 * 86400000).toISOString(),
		);
		const intents = await fixture.app.db
			.select()
			.from(wafSyncRecords)
			.where(eq(wafSyncRecords.penaltyId, penalty.id));
		expect(intents).toHaveLength(1);
	});

	it("没有时区的面板日志只记录证据缺口，不按应用时区推断处罚", async () => {
		const fixture = await fixtureSetup();
		const ingestor = new WafLogIngestor(fixture.app.db, {
			logs: async () => ({
				total: 1,
				items: [
					{
						id: 12,
						ip: "203.0.113.42",
						action: "deny",
						uri: "/wp-login.php",
						execRule: "urlBlack",
						host: "site.example.test",
						localtime: "2026-11-15T10:00:00",
					},
				],
			}),
		});
		expect(
			await ingestor.collect(fixture.site.id, fixture.mapping),
		).toMatchObject({
			inserted: 0,
			gap: "event_timezone_unknown",
		});
		expect(await fixture.app.db.select().from(wafLogEvents)).toHaveLength(0);
	});

	it("短期应用处罚可按扫描证据升级十五天，后续扫描不重新延长期限", async () => {
		const fixture = await fixtureSetup();
		await fixture.app.db.update(siteSettings).set({
			abusePolicyJson: JSON.stringify({ syncToWaf: true }),
		});
		const now = new Date();
		const occurredAt = new Date(now.getTime() - 60000).toISOString();
		let sourceId = 21;
		const ingestor = new WafLogIngestor(fixture.app.db, {
			logs: async () => ({
				total: 1,
				items: [
					{
						id: sourceId,
						ip: fixture.penalty.ip,
						action: "deny",
						uri: "/wp-login.php",
						execRule: "urlBlack",
						host: "site.example.test",
						localtime: sourceId === 21 ? occurredAt : now.toISOString(),
					},
				],
			}),
		});
		const mapping = { ...fixture.mapping, autoBanScans: true };
		await ingestor.collect(fixture.site.id, mapping, now);
		const upgraded = await fixture.repository.penalty(fixture.penalty.id);
		expect(upgraded).toMatchObject({
			scope: "all",
			reason: "waf_scan",
			stateVersion: 2,
			expiresAt: new Date(Date.parse(occurredAt) + 15 * 86400000).toISOString(),
		});
		sourceId = 22;
		await ingestor.collect(fixture.site.id, mapping, now);
		expect(await fixture.repository.penalty(fixture.penalty.id)).toMatchObject({
			stateVersion: 2,
			expiresAt: upgraded?.expiresAt,
		});
		expect(await fixture.repository.listForSync(fixture.site.id)).toHaveLength(
			1,
		);
		expect(await fixture.repository.get(fixture.record.id)).toMatchObject({
			penaltyVersion: 2,
			expiresAt: upgraded?.expiresAt,
		});
	});

	it("只清理已确认面板解除且超过保留期的处罚，人工差异继续保留", async () => {
		const fixture = await fixtureSetup();
		const policy = readAbusePolicy(JSON.stringify({ syncToWaf: true }));
		const second = await fixture.abuse.createPenalty({
			siteId: fixture.site.id,
			ip: "198.51.100.11",
			scope: "all",
			reason: "rate_limited",
			policy,
			count: 10,
		});
		await fixture.service().execute({ siteId: fixture.site.id });
		const changed = fixture.rules.get(`qingyan-${second.id}`) as WafAclRule;
		changed.state = "off";
		const ended = new Date(
			Math.max(
				Date.parse(fixture.penalty.expiresAt),
				Date.parse(second.expiresAt),
			) + 1,
		);
		await fixture.service().execute({ siteId: fixture.site.id }, ended);
		const afterRetention = new Date(ended.getTime() + 90 * 86400000 + 1);
		expect(
			await fixture.repository.pruneCompleted(
				fixture.site.id,
				policy,
				afterRetention,
			),
		).toBe(1);
		expect(
			await fixture.abuse.pruneExpired(
				fixture.site.id,
				policy,
				afterRetention.getTime(),
			),
		).toBe(1);
		expect(await fixture.repository.get(fixture.record.id)).toBeNull();
		expect(await fixture.repository.penalty(fixture.penalty.id)).toBeNull();
		expect(await fixture.repository.get(`waf_${second.id}`)).toMatchObject({
			syncState: "conflict",
			reasonCode: "WAF_RULE_CHANGED",
		});
		expect(await fixture.repository.penalty(second.id)).not.toBeNull();
	});
});
