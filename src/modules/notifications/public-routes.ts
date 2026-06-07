import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { InvalidRequestError, ResourceNotFoundError } from "../shared/errors";
import { CommenterPreferencesRepository } from "./commenter-preferences-repository";
import { UnsubscribeTokenService } from "./unsubscribe-token-service";

const unsubscribeQuerySchema = z.object({
	token: z.string().min(1),
});

function acceptsJson(acceptHeader: string | string[] | undefined): boolean {
	const value = Array.isArray(acceptHeader)
		? acceptHeader.join(",")
		: (acceptHeader ?? "");
	return value
		.split(",")
		.map((item) => item.split(";")[0]?.trim().toLowerCase())
		.includes("application/json");
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function renderUnsubscribePage(input: {
	title: string;
	message: string;
	status: "success" | "error";
}): string {
	const title = escapeHtml(input.title);
	const message = escapeHtml(input.message);
	const accent = input.status === "success" ? "#166534" : "#991b1b";
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#172033}
main{max-width:560px;margin:12vh auto 0;padding:32px 24px}
section{border:1px solid #d9e2ec;background:#fff;border-radius:8px;padding:28px}
h1{margin:0 0 12px;font-size:24px;line-height:1.25;color:${accent}}
p{margin:0;color:#475569;font-size:15px;line-height:1.7}
</style>
</head>
<body><main><section><h1>${title}</h1><p>${message}</p></section></main></body>
</html>`;
}

export const notificationsPublicRoutes: FastifyPluginAsync = async (
	fastify,
) => {
	const preferences = new CommenterPreferencesRepository(fastify.db);
	const tokens = new UnsubscribeTokenService(fastify.db, preferences);

	fastify.get("/unsubscribe", async (request, reply) => {
		const wantsJson = acceptsJson(request.headers.accept);
		const parsed = unsubscribeQuerySchema.safeParse(request.query);
		if (!parsed.success) {
			if (!wantsJson) {
				return reply
					.status(400)
					.type("text/html; charset=utf-8")
					.send(
						renderUnsubscribePage({
							status: "error",
							title: "退订链接无效",
							message:
								"当前退订链接缺少必要参数，请回到邮件中重新打开完整链接。",
						}),
					);
			}
			throw new InvalidRequestError({ issues: parsed.error.issues });
		}

		const result = await tokens.consume({
			token: parsed.data.token,
		});
		if (result.status !== "unsubscribed") {
			if (!wantsJson) {
				return reply
					.status(404)
					.type("text/html; charset=utf-8")
					.send(
						renderUnsubscribePage({
							status: "error",
							title: "退订链接已失效",
							message:
								"这条退订链接无效、已使用或已过期。如仍收到通知，请联系站点管理员处理。",
						}),
					);
			}
			throw new ResourceNotFoundError(
				"UNSUBSCRIBE_TOKEN_INVALID",
				"退订链接无效或已失效。",
			);
		}

		if (!wantsJson) {
			return reply.type("text/html; charset=utf-8").send(
				renderUnsubscribePage({
					status: "success",
					title: "已退订评论回复提醒",
					message:
						"你将不再收到此站点发送到该邮箱的评论回复通知。此前已经发送的邮件不受影响。",
				}),
			);
		}

		return {
			status: "unsubscribed",
		};
	});
};
