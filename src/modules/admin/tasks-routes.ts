import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { AdminRepository } from "./repository";
import { AdminSessionService } from "./session-service";
import { InvalidRequestError } from "../shared/errors";
import { AdminTaskService } from "../tasks/admin-task-service";
import { TaskEventLogRepository } from "../tasks/task-event-log-repository";

const idParamsSchema = z.object({ id: z.string().min(1) });
const runIdParamsSchema = z.object({ id: z.string().min(1) });
const transferOwnerSchema = z.object({
	ownerUserId: z.number().int().positive(),
});
const ownerReconcileSchema = z.object({
	ownerUserId: z.number().int().positive(),
	reason: z.string().min(1),
});
const disableSchema = z.object({
	reason: z.string().min(1).default("manual_disabled"),
});
const deleteSchema = z
	.object({ reason: z.string().min(1).nullable().optional() })
	.optional();

function parseParams<T>(schema: z.ZodType<T>, value: unknown): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new InvalidRequestError({ issues: parsed.error.issues });
	}
	return parsed.data;
}

export const adminTasksRoutes: FastifyPluginAsync = async (fastify) => {
	const adminRepository = new AdminRepository(fastify.db);
	const sessionService = new AdminSessionService(
		fastify.config,
		fastify.security,
		adminRepository,
		fastify.adminBootstrap,
		fastify.siteRegistry,
	);
	const service = new AdminTaskService(fastify.db, fastify.siteRegistry);
	const eventLogs = new TaskEventLogRepository(fastify.db);

	fastify.get("/definitions", async (request) => {
		await sessionService.requireSession(request);
		return service.listDefinitions();
	});

	fastify.get("/scheduled", async (request) => {
		const session = await sessionService.requireSession(request);
		return service.listScheduled(session);
	});

	fastify.get("/audit", async (request) => {
		const session = await sessionService.requireSession(request);
		return service.listAudit(session);
	});

	fastify.get("/deleted-snapshots", async (request) => {
		const session = await sessionService.requireSession(request);
		return service.listDeletedSnapshots(session);
	});

	fastify.get("/deleted-snapshots/:id", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(idParamsSchema, request.params);
		return service.getDeletedSnapshot(id, session);
	});

	fastify.post("/scheduled", async (request, reply) => {
		const session = await sessionService.requireSession(request);
		const created = await service.createScheduled(
			request.body as Record<string, unknown>,
			session,
			request.context?.requestId,
		);
		return reply.status(201).send(created);
	});

	fastify.get("/scheduled/:id", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(idParamsSchema, request.params);
		return service.getScheduled(id, session);
	});

	fastify.patch("/scheduled/:id", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(idParamsSchema, request.params);
		return service.updateScheduled(
			id,
			request.body as Record<string, unknown>,
			session,
			request.context?.requestId,
		);
	});

	fastify.delete("/scheduled/:id", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(idParamsSchema, request.params);
		const parsed = deleteSchema.parse(request.body ?? {});
		return service.deleteScheduled(
			id,
			parsed?.reason ?? null,
			session,
			request.context?.requestId,
		);
	});

	fastify.post("/scheduled/:id/run", async (request, reply) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(idParamsSchema, request.params);
		const run = await service.runScheduled(
			id,
			session,
			request.context?.requestId,
		);
		return reply.status(201).send(run);
	});

	fastify.post("/scheduled/:id/enable", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(idParamsSchema, request.params);
		return service.enableScheduled(id, session, request.context?.requestId);
	});

	fastify.post("/scheduled/:id/disable", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(idParamsSchema, request.params);
		const body = disableSchema.parse(request.body ?? {});
		return service.disableScheduled(
			id,
			body.reason,
			session,
			request.context?.requestId,
		);
	});

	fastify.post("/scheduled/:id/transfer-owner", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(idParamsSchema, request.params);
		const body = transferOwnerSchema.parse(request.body);
		return service.transferOwner(
			id,
			body.ownerUserId,
			session,
			request.context?.requestId,
		);
	});

	fastify.post("/owners/reconcile", async (request) => {
		const session = await sessionService.requireSession(request);
		const body = ownerReconcileSchema.parse(request.body);
		return service.reconcileOwner(
			body.ownerUserId,
			body.reason,
			session,
			request.context?.requestId,
		);
	});

	fastify.get("/runs", async (request) => {
		const session = await sessionService.requireSession(request);
		return service.listRuns(session);
	});

	fastify.get("/runs/:id", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(runIdParamsSchema, request.params);
		return service.getRun(id, session);
	});

	fastify.get("/runs/:id/events", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(runIdParamsSchema, request.params);
		await service.assertCanViewRunLogs(id, session);
		return eventLogs.listForRun({
			taskRunId: id,
			limit: 100,
			offset: 0,
			includePrivate: true,
		});
	});

	fastify.post("/runs/:id/cancel", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(runIdParamsSchema, request.params);
		return service.cancelRun(id, session, request.context?.requestId);
	});

	fastify.post("/runs/:id/retry", async (request) => {
		const session = await sessionService.requireSession(request);
		const { id } = parseParams(runIdParamsSchema, request.params);
		return service.retryRun(id, session, request.context?.requestId);
	});
};
