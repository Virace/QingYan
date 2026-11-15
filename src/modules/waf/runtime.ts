import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db/client";
import { siteSettings, sites, wafLogCursors } from "../../db/schema";
import { readAbusePolicy } from "../comments/abuse-policy";
import { AbuseRepository } from "../comments/abuse-repository";
import type { SiteRegistry } from "../shared/site-registry";
import { SystemManagedTaskService } from "../tasks/system-managed-task-service";
import { TaskRunRepository } from "../tasks/task-run-repository";
import type { TaskRunnerContext } from "../tasks/task-runner-context";
import { loadWafConnection, type WafConnection } from "./config";
import { WafGatewayClient } from "./gateway-client";
import { WafLogIngestor } from "./log-ingestor";
import { WafSyncRepository } from "./repository";
import { WafSyncService } from "./sync-service";

export interface WafTaskInput {
	siteId?: number;
	siteKey?: string;
	recordId?: string;
}

export class WafRuntime {
	private readonly sync: WafSyncService;
	private readonly logs: WafLogIngestor;
	public constructor(
		private readonly db: AppDatabase,
		private readonly connection: WafConnection,
	) {
		const client = new WafGatewayClient(connection);
		this.sync = new WafSyncService(db, client, connection.sites);
		this.logs = new WafLogIngestor(db, client);
	}
	public isMapped(siteKey: string) {
		return this.connection.sites.some((site) => site.siteKey === siteKey);
	}
	public get paused() {
		return process.env.QINGYAN_WAF_SYNC_PAUSED === "true";
	}
	public async evidenceStatus(siteKey: string) {
		const mapping = this.connection.sites.find(
			(mapping) => mapping.siteKey === siteKey,
		);
		if (!mapping) return null;
		const [cursor] = await this.db
			.select({
				lastPollAt: wafLogCursors.lastPollAt,
				gapReason: wafLogCursors.gapReason,
			})
			.from(wafLogCursors)
			.where(eq(wafLogCursors.websiteKey, mapping.websiteKey))
			.limit(1);
		return cursor ?? { lastPollAt: null, gapReason: null };
	}
	public async execute(input: WafTaskInput, context?: TaskRunnerContext) {
		if (this.paused) return { status: "paused" };
		const repository = new WafSyncRepository(this.db);
		let siteId = input.siteId;
		if (!siteId && input.siteKey) {
			const mapping = this.connection.sites.find(
				(mapping) => mapping.siteKey === input.siteKey,
			);
			if (!mapping) return { status: "not_configured" };
			const [site] = await this.db
				.select({ id: sites.id })
				.from(sites)
				.where(eq(sites.siteKey, input.siteKey))
				.limit(1);
			siteId = site?.id;
		}
		if (!siteId) throw new Error("WAF_SITE_REQUIRED");
		if (context) {
			const run = await new TaskRunRepository(this.db).getRequired(
				context.runId,
			);
			if (run.siteId !== siteId) throw new Error("WAF_TASK_SITE_MISMATCH");
		}
		const site = await repository.resolveSite(siteId);
		const mapping = this.connection.sites.find(
			(mapping) => mapping.siteKey === site?.siteKey,
		);
		if (!mapping) return { status: "not_configured" };
		const now = context?.now() ?? new Date();
		// 到期、解除与清理不能依赖日志接口；新扫描的处罚通过独立同步任务应用。
		const sync = await this.sync.execute(
			{ siteId, recordId: input.recordId },
			now,
		);
		if (!input.recordId) {
			const [settings] = await this.db
				.select({ policy: siteSettings.abusePolicyJson })
				.from(siteSettings)
				.where(eq(siteSettings.siteId, siteId))
				.limit(1);
			const policy = readAbusePolicy(settings?.policy);
			await repository.pruneCompleted(siteId, policy, now);
			await new AbuseRepository(this.db).pruneExpired(
				siteId,
				policy,
				now.getTime(),
			);
		}
		if (input.recordId) return { logs: null, sync };
		const collections = [this.logs.collect(siteId, mapping, now)];
		if (
			this.connection.collectUnknownHosts &&
			mapping === this.connection.sites[0]
		)
			collections.push(this.logs.collect(null, null, now));
		const collected = await Promise.allSettled(collections);
		const failed = collected.find((result) => result.status === "rejected");
		if (failed) throw failed.reason;
		const logs =
			collected[0].status === "fulfilled" ? collected[0].value : null;
		return { logs, sync };
	}

	public async initialize(siteRegistry: SiteRegistry) {
		if (this.paused) return;
		const schedules = new SystemManagedTaskService(this.db, siteRegistry);
		const tasks = new TaskRunRepository(this.db);
		for (const mapping of this.connection.sites) {
			const site = siteRegistry.getRegisteredSite(mapping.siteKey);
			if (!site) throw new Error("WAF_SITE_MAPPING_INVALID");
			const systemKey = `waf:maintenance:${mapping.siteKey}`;
			await schedules.ensureSystemManagedScheduledTask({
				name: "站点访问防护同步",
				description: "核对面板访问限制、处理到期和采集防护事件。",
				type: "waf_sync",
				siteKey: site.siteKey,
				scope: { siteKey: site.siteKey },
				scheduleKind: "interval",
				trigger: { everyMinutes: 5 },
				payload: { siteId: site.id },
				policy: {
					maxAttempts: 3,
					retryDelaySec: 60,
					timeoutMs: 300000,
					concurrencyKey: `waf:${site.id}`,
				},
				systemKey,
				protection: {
					kind: "waf_maintenance",
					managedBy: "waf",
					lockedDelete: true,
					lockedDisable: true,
					lockedOwnerTransfer: true,
					lockedType: true,
					lockedSite: true,
					lockedPayloadPaths: ["siteId"],
					editableFields: ["name", "description", "retentionCount"],
				},
			});
			await tasks.create({
				type: "waf_sync",
				category: "maintenance",
				siteId: site.id,
				siteKey: site.siteKey,
				payload: { siteId: site.id },
				payloadSummary: { siteId: site.id },
				concurrencyKey: `waf:${site.id}`,
				maxAttempts: 3,
				retryDelaySec: 60,
				trigger: "startup",
			});
		}
	}
}

export async function createWafRuntime(db: AppDatabase) {
	const connection = await loadWafConnection();
	return connection ? new WafRuntime(db, connection) : null;
}

declare module "fastify" {
	interface FastifyInstance {
		wafRuntime?: WafRuntime | null;
	}
}
