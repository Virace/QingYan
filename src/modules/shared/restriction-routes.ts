import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { joinPublicPath } from "../../config/public-path";

const descriptions: Record<string, { title: string; message: string }> = {
	rate_limited: {
		title: "操作过于频繁",
		message: "请稍后返回原页面重试。",
	},
	blocked: {
		title: "当前访问受到限制",
		message: "请在限制结束后返回原页面重试。如需提前恢复，请联系站点管理员。",
	},
	login_required: {
		title: "该邮箱需要登录后使用",
		message: "请使用具有当前站点权限的账号登录，或返回原页面更换邮箱。",
	},
	email_not_allowed: {
		title: "该邮箱暂不支持",
		message: "请返回原页面更换邮箱后重新提交。",
	},
};

export function registerRestrictionRoutes(
	app: FastifyInstance,
	publicPath: string,
) {
	app.get(joinPublicPath(publicPath, "/restricted"), async (request, reply) => {
		const query = request.query as Record<string, unknown>;
		const state =
			typeof query.reason === "string" &&
			Object.hasOwn(descriptions, query.reason)
				? descriptions[query.reason]
				: undefined;
		const { title, message } = state ?? {
			title: "暂时无法完成操作",
			message: "请返回原页面查看操作提示后重试。",
		};
		const resetAt =
			typeof query.resetAt === "string" && /^\d{1,16}$/.test(query.resetAt)
				? Number(query.resetAt)
				: NaN;
		const retryTime =
			state &&
			Number.isFinite(resetAt) &&
			resetAt > Date.now() &&
			resetAt <= 8.64e15
				? `<p>预计可重试时间：<time datetime="${new Date(resetAt).toISOString()}">${new Date(resetAt).toISOString().replace("T", " ").replace("Z", " UTC")}</time></p>`
				: "";
		const nonce = randomBytes(18).toString("base64");
		reply.header("Cache-Control", "no-store");
		reply.header(
			"Content-Security-Policy",
			`default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
		);
		reply.header("Referrer-Policy", "no-referrer");
		return reply
			.type("text/html; charset=utf-8")
			.send(
				`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · QingYan</title><style nonce="${nonce}">:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;padding:clamp(1.5rem,8vw,6rem);line-height:1.6}main{max-width:40rem;margin:8vh auto}h1{font-size:1.75rem}button{font:inherit;padding:.6rem 1rem;cursor:pointer}button:focus-visible{outline:3px solid currentColor;outline-offset:4px}time{overflow-wrap:anywhere}</style></head><body><main><h1>${title}</h1><p>${message}</p>${retryTime}<button type="button" id="back">返回原页面</button><noscript><p>请使用浏览器的返回操作。</p></noscript></main><script nonce="${nonce}">document.getElementById('back').addEventListener('click',function(){history.back()})</script></body></html>`,
			);
	});
}
