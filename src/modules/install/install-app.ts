import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import { AppError, InvalidRequestError } from "../shared/errors";
import { applyInstall, installApplySchema } from "./install-service";
import type { MinimalInstallConfig } from "./minimal-config";
import { resolveInstallState } from "./state";

function assertToken(token: unknown, expectedToken: string) {
	if (token !== expectedToken) {
		throw new AppError(403, "INSTALL_TOKEN_INVALID", "安装令牌无效。");
	}
}

function renderInstallHtml(token: string): string {
	return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>QingYan Install</title></head>
<body>
<main>
<h1>QingYan Install</h1>
<p>Use <code>POST /api/install/apply</code> with the install token to initialize QingYan.</p>
<pre>${token}</pre>
</main>
</body>
</html>`;
}

export function buildInstallApp(input: {
	minimalConfig: MinimalInstallConfig;
	environment?: NodeJS.ProcessEnv;
}): FastifyInstance {
	const app = Fastify({
		logger: true,
		disableRequestLogging: true,
	});

	app.setErrorHandler((error, request, reply) => {
		const requestId = request.id;
		if (error instanceof AppError) {
			reply.status(error.statusCode).send({
				error: {
					code: error.code,
					message: error.message,
					requestId,
					details: error.details ?? null,
				},
			});
			return;
		}
		app.log.error({ err: error }, "Unhandled install request error");
		reply.status(500).send({
			error: {
				code: "INTERNAL_ERROR",
				message: "服务器内部错误。",
				requestId,
				details: null,
			},
		});
	});

	app.get("/install", async (request, reply) => {
		const token =
			typeof request.query === "object" && request.query
				? (request.query as Record<string, unknown>).token
				: undefined;
		assertToken(token, input.minimalConfig.token);
		const state = await resolveInstallState(
			input.minimalConfig,
			input.environment,
		);
		if (state.installed) {
			return reply.status(410).send({ installed: true });
		}
		return reply
			.type("text/html; charset=utf-8")
			.send(renderInstallHtml(input.minimalConfig.token));
	});

	app.get("/api/install/state", async (request) => {
		const token =
			typeof request.query === "object" && request.query
				? (request.query as Record<string, unknown>).token
				: undefined;
		assertToken(token, input.minimalConfig.token);
		return resolveInstallState(input.minimalConfig, input.environment);
	});

	app.post("/api/install/apply", async (request, reply) => {
		const parsed = installApplySchema.safeParse(request.body);
		if (!parsed.success) {
			throw new InvalidRequestError({
				issues: parsed.error.issues,
			});
		}
		const state = await resolveInstallState(
			input.minimalConfig,
			input.environment,
		);
		if (state.installed) {
			return reply.status(410).send({ installed: true });
		}
		try {
			const result = await applyInstall({
				minimalConfig: input.minimalConfig,
				payload: parsed.data,
			});
			return reply.status(201).send(result);
		} catch (error) {
			if (error instanceof Error && error.message === "INSTALL_TOKEN_INVALID") {
				throw new AppError(403, "INSTALL_TOKEN_INVALID", "安装令牌无效。");
			}
			throw error;
		}
	});

	return app;
}
