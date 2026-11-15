import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auditLogs } from "../../db/schema";
import { AbuseRepository } from "../comments/abuse-repository";
import { AppError, InvalidRequestError } from "../shared/errors";
import { WafSyncRepository } from "../waf/repository";
import { requireSiteAccess, requireSiteIdAccess } from "./authorization";
import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";

export const adminWafRoutes: FastifyPluginAsync = async (fastify) => {
	const sessions = new AdminSessionService(
		fastify.config,
		fastify.security,
		new AdminRepository(fastify.db),
		fastify.adminBootstrap,
	);
	const repository = new WafSyncRepository(fastify.db);
	fastify.get("/", async (request) => {
		const session = await sessions.requireSession(request);
		const parsed = z
			.object({
				siteKey: z.string().min(1),
				limit: z.coerce.number().int().min(1).max(100).default(20),
				offset: z.coerce.number().int().min(0).default(0),
			})
			.safeParse(request.query);
		if (!parsed.success)
			throw new InvalidRequestError({ issues: parsed.error.issues });
		const site = requireSiteAccess({
			session,
			siteRegistry: fastify.siteRegistry,
			siteKey: parsed.data.siteKey,
			permission: "blacklist.read",
		});
		if (!site) throw new AppError(404, "SITE_NOT_FOUND", "站点不存在。");
		return {
			...(await repository.list(
				site.id,
				parsed.data.limit,
				parsed.data.offset,
			)),
			configured: Boolean(fastify.wafRuntime?.isMapped(site.siteKey)),
			paused: fastify.wafRuntime?.paused ?? false,
			evidence:
				(await fastify.wafRuntime?.evidenceStatus(site.siteKey)) ?? null,
			capabilities: {
				retry: session.permissions.includes("blacklist.create"),
				release: session.permissions.includes("blacklist.delete"),
			},
		};
	});
	for (const action of ["retry", "resume", "release"] as const)
		fastify.post(`/:id/${action}`, async (request) => {
			const session = await sessions.requireSession(request);
			const params = z
				.object({ id: z.string().min(1).max(200) })
				.safeParse(request.params);
			const body = z
				.object({ reason: z.string().trim().min(1).max(500).optional() })
				.safeParse(request.body ?? {});
			if (!params.success || !body.success)
				throw new AppError(400, "INVALID_REQUEST", "请求参数不完整。");
			const row = await repository.get(params.data.id);
			if (!row)
				throw new AppError(404, "WAF_RECORD_NOT_FOUND", "未找到访问限制记录。");
			requireSiteIdAccess({
				session,
				siteId: row.siteId,
				permission:
					action === "release" ? "blacklist.delete" : "blacklist.create",
			});
			if (action === "release") {
				if (!body.data.reason)
					throw new AppError(400, "INVALID_REQUEST", "请填写解除原因。");
				const penalty = await repository.penalty(row.penaltyId);
				if (!penalty?.sourceRuleId)
					throw new AppError(
						409,
						"WAF_RELEASE_UNAVAILABLE",
						"请先核对本地限制状态。",
					);
				await new AbuseRepository(fastify.db).release({
					ruleId: penalty.sourceRuleId,
					kind: "released",
					reason: body.data.reason,
					actorUserId: session.user.id,
				});
				const site = fastify.siteRegistry
					.listRegisteredSites()
					.find((site) => site.id === row.siteId);
				if (site) fastify.security.resetWriteState(site.siteKey, row.ip);
			} else {
				if (!fastify.wafRuntime || fastify.wafRuntime.paused)
					throw new AppError(
						409,
						"WAF_SYNC_UNAVAILABLE",
						"访问防护同步暂不可用，请检查连接和维护状态。",
					);
				await repository.requestSync(row.id, action === "resume");
			}
			await fastify.db.insert(auditLogs).values({
				siteId: row.siteId,
				actorType: "admin_user",
				actorId: String(session.user.id),
				action: `waf.${action}`,
				targetType: "waf_sync",
				targetId: row.id,
				payloadJson: JSON.stringify({ reason: body.data.reason ?? null }),
			});
			return {
				accepted: true,
				panelSync: row.suspendedAt
					? "review_required"
					: fastify.wafRuntime?.paused
						? "paused"
						: "pending",
			};
		});
};
