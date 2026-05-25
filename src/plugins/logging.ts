import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { LoggerManager } from "../logging/logger-manager";
import type { AccessEventName } from "../logging/types";
import { AppError } from "../modules/shared/errors";
import { stripPublicPath } from "../config/public-path";

function resolveRequestPath(request: FastifyRequest): string {
	const [pathWithoutQuery] = request.url.split("?");
	return pathWithoutQuery ?? request.url;
}

function shouldLogAccess(
	pathname: string,
	statusCode: number,
	publicPath: string,
): boolean {
	const internalPathname = stripPublicPath(publicPath, pathname) ?? pathname;
	return (
		internalPathname.startsWith("/api") ||
		internalPathname.startsWith("/admin") ||
		statusCode >= 400
	);
}

function resolveAccessEvent(
	error: unknown,
	statusCode: number,
): AccessEventName {
	if (error instanceof AppError) {
		if (error.code === "INVALID_REQUEST") {
			return "request.validation_failed";
		}
		if (error.code.includes("BLACKLISTED")) {
			return "request.blocked.blacklist";
		}
		if (error.code.includes("RATE_LIMITED")) {
			return "request.rate_limited";
		}
	}

	return statusCode >= 400 ? "request.failed" : "request.completed";
}

const loggingPlugin: FastifyPluginAsync = async (fastify) => {
	const loggerManager = await LoggerManager.create({
		config: fastify.config,
		db: fastify.db,
		stderr: process.stderr,
	});

	fastify.decorate("loggerManager", loggerManager);

	fastify.addHook("onSend", async (request, reply, payload) => {
		const pathname = resolveRequestPath(request);
		if (
			!shouldLogAccess(
				pathname,
				reply.statusCode,
				fastify.config.server.publicPath,
			)
		) {
			return payload;
		}

		await loggerManager.logAccess({
			level:
				reply.statusCode >= 500
					? "error"
					: reply.statusCode >= 400
						? "warn"
						: "info",
			channel: "access",
			event:
				request.context?.accessEvent?.event ??
				resolveAccessEvent(
					(request as typeof request & { routeError?: unknown }).routeError,
					reply.statusCode,
				),
			requestId: request.context?.requestId ?? request.id,
			method: request.method,
			path: pathname,
			statusCode: reply.statusCode,
			durationMs: Math.max(
				0,
				Date.now() - (request.context?.startedAt ?? Date.now()),
			),
			ip: request.context?.ip ?? request.ip,
			userAgent: request.context?.userAgent,
			siteKey: request.context?.siteKey,
			pageKey: request.context?.pageKey,
			errorCode: request.context?.accessEvent?.errorCode,
		});

		return payload;
	});

	fastify.addHook("onClose", async () => {
		await loggerManager.logApp({
			level: "info",
			channel: "app",
			event: "service.stopped",
			message: "服务已停止",
		});
	});
};

export default fp(loggingPlugin, {
	name: "qingyan-logging",
	dependencies: ["qingyan-db"],
});
