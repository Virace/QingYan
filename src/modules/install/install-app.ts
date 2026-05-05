import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import { AppError, InvalidRequestError } from "../shared/errors";
import {
	applyInstall,
	buildInstallPlan,
	installApplySchema,
} from "./install-service";
import type { MinimalInstallConfig } from "./minimal-config";
import { resolveInstallState } from "./state";

const INSTALL_PATH = "/admin/install";
const INSTALL_PLAN_PATH = "/admin/install/plan";
const INSTALL_COOKIE_NAME = "qingyan_install";

function assertToken(token: unknown, expectedToken: string) {
	if (token !== expectedToken) {
		throw new AppError(403, "INSTALL_TOKEN_INVALID", "安装令牌无效。");
	}
}

function readInstallCookie(
	cookieHeader: string | undefined,
): string | undefined {
	if (!cookieHeader) {
		return undefined;
	}
	for (const part of cookieHeader.split(";")) {
		const [name, ...valueParts] = part.trim().split("=");
		if (name === INSTALL_COOKIE_NAME) {
			return decodeURIComponent(valueParts.join("="));
		}
	}
	return undefined;
}

function createInstallCookie(token: string): string {
	return `${INSTALL_COOKIE_NAME}=${encodeURIComponent(token)}; Path=${INSTALL_PATH}; HttpOnly; SameSite=Lax`;
}

function resolveDefaultPublicBaseUrl(input: MinimalInstallConfig): string {
	const host =
		input.host === "0.0.0.0" || input.host === "::" ? "localhost" : input.host;
	return `http://${host}:${input.port}`;
}

function renderInstallHtml(input: MinimalInstallConfig): string {
	const defaults = {
		serverHost: "0.0.0.0",
		serverPort: input.port,
		publicBaseUrl: resolveDefaultPublicBaseUrl(input),
		databaseFile: "./data/qingyan.db",
		siteKey: "default",
		siteName: "Default",
		allowedOrigins: resolveDefaultPublicBaseUrl(input),
	};
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>QingYan Install</title>
<style>
:root { color-scheme: light; font-family: Inter, "Segoe UI", system-ui, sans-serif; background: #f6f7f9; color: #18181b; }
body { margin: 0; }
main { min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; box-sizing: border-box; }
.panel { width: min(720px, 100%); background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; box-shadow: 0 16px 50px rgba(24, 24, 27, 0.08); }
.header { padding: 28px 32px 12px; border-bottom: 1px solid #f0f0f1; }
h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.25; }
p { margin: 0; color: #52525b; line-height: 1.6; }
form { display: grid; gap: 22px; padding: 24px 32px 32px; }
fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 14px; }
legend { font-weight: 650; margin-bottom: 2px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
label { display: grid; gap: 7px; font-size: 14px; color: #3f3f46; }
input { height: 38px; border: 1px solid #d4d4d8; border-radius: 6px; padding: 0 11px; font: inherit; color: #18181b; background: #fff; }
input:focus { outline: 2px solid #0f766e; outline-offset: 1px; border-color: #0f766e; }
button { height: 40px; border: 0; border-radius: 6px; padding: 0 16px; font: inherit; font-weight: 650; color: #fff; background: #0f766e; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: 0.6; }
.message { display: none; border-radius: 6px; padding: 12px 14px; font-size: 14px; line-height: 1.6; }
.message[data-kind="error"] { display: block; border: 1px solid #fecaca; color: #991b1b; background: #fef2f2; }
.message[data-kind="success"] { display: block; border: 1px solid #bbf7d0; color: #166534; background: #f0fdf4; }
@media (max-width: 640px) { .header, form { padding-left: 20px; padding-right: 20px; } .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
<section class="panel">
<div class="header">
<h1>QingYan Install</h1>
<p>完成首次安装后，服务会生成启动配置、初始化数据库，并写入管理员 bootstrap 信息。</p>
</div>
<form id="install-form">
<fieldset>
<legend>服务</legend>
<div class="grid">
<label>监听地址<input name="serverHost" autocomplete="off"></label>
<label>监听端口<input name="serverPort" inputmode="numeric" autocomplete="off"></label>
</div>
<label>公开访问地址<input name="publicBaseUrl" autocomplete="url" required></label>
</fieldset>
<fieldset>
<legend>数据库</legend>
<label>SQLite 文件<input name="databaseFile" autocomplete="off" required></label>
</fieldset>
<fieldset>
<legend>管理员</legend>
<div class="grid">
<label>后台入口<input name="adminConsolePath" autocomplete="off" placeholder="留空则随机生成"></label>
<label>用户名<input name="adminUsername" autocomplete="username" placeholder="留空则使用 admin"></label>
</div>
<label>初始密码<input name="adminPassword" type="password" autocomplete="new-password" minlength="8" placeholder="留空则随机生成"></label>
</fieldset>
<fieldset>
<legend>默认站点</legend>
<div class="grid">
<label>站点 Key<input name="siteKey" autocomplete="off" required></label>
<label>站点名称<input name="siteName" autocomplete="off" required></label>
</div>
<label>允许的前端 Origin<input name="allowedOrigins" autocomplete="off" required></label>
</fieldset>
<section id="install-review" class="message"></section>
<div id="install-message" class="message"></div>
<div class="grid">
<button id="install-plan" type="submit">生成安装计划</button>
<button id="install-apply" type="button" disabled>确认安装</button>
</div>
</form>
</section>
</main>
<script>
const defaults = ${JSON.stringify(defaults)};
const form = document.getElementById("install-form");
const planButton = document.getElementById("install-plan");
const applyButton = document.getElementById("install-apply");
const message = document.getElementById("install-message");
const review = document.getElementById("install-review");
let plannedPayload = null;
for (const [key, value] of Object.entries(defaults)) {
	const field = form.elements.namedItem(key);
	if (field) field.value = String(value);
}
function setMessage(kind, text) {
	message.dataset.kind = kind;
	message.textContent = text;
}
function optionalString(value) {
	const text = String(value ?? "").trim();
	return text || undefined;
}
function collectPayload() {
	const data = new FormData(form);
	const allowedOrigins = String(data.get("allowedOrigins") ?? "")
		.split(/\\s*,\\s*|\\s+/)
		.map((item) => item.trim())
		.filter(Boolean);
	return {
		server: {
			host: String(data.get("serverHost") ?? ""),
			port: Number(data.get("serverPort") ?? 0),
			publicBaseUrl: String(data.get("publicBaseUrl") ?? ""),
			trustProxy: true,
		},
		database: {
			sqliteFile: String(data.get("databaseFile") ?? ""),
		},
		admin: {
			consolePath: optionalString(data.get("adminConsolePath")),
			username: optionalString(data.get("adminUsername")),
			password: optionalString(data.get("adminPassword")),
		},
		site: {
			siteKey: String(data.get("siteKey") ?? ""),
			name: String(data.get("siteName") ?? ""),
			allowedOrigins,
		},
	};
}
function renderPlan(plan) {
	const systemSettings = plan.systemSettings
		.map((item) => item.category + "." + item.key + (item.secret ? "（已配置）" : ""))
		.join(", ");
	const envFields = plan.env.length
		? plan.env.map((item) => item.envName + " -> " + item.path + (item.secret ? "（已隐藏）" : "")).join(", ")
		: "无";
	review.dataset.kind = "success";
	review.innerHTML =
		"<strong>安装计划</strong><br>" +
		"配置文件: " + plan.config.path + "<br>" +
		"数据库: " + plan.database.sqliteFile + "<br>" +
		"后台入口: " + plan.admin.consolePath + "<br>" +
		"管理员: " + plan.admin.username + (plan.admin.passwordGenerated ? "（将随机生成初始密码）" : "") + "<br>" +
		"默认站点: " + plan.site.siteKey + " / " + plan.site.name + "<br>" +
		"系统设置: " + systemSettings + "<br>" +
		"环境变量锁定: " + envFields;
	return plan.applyPayload;
}
async function requestJson(url, payload) {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	const result = await response.json();
	if (!response.ok) {
		throw new Error(result?.error?.message ?? "请求失败。");
	}
	return result;
}
form.addEventListener("submit", async (event) => {
	event.preventDefault();
	planButton.disabled = true;
	applyButton.disabled = true;
	review.removeAttribute("data-kind");
	review.textContent = "";
	setMessage("", "");
	try {
		plannedPayload = collectPayload();
		const plan = await requestJson("${INSTALL_PLAN_PATH}", plannedPayload);
		plannedPayload = renderPlan(plan);
		applyButton.disabled = false;
	} catch (error) {
		plannedPayload = null;
		setMessage("error", error instanceof Error ? error.message : "安装计划生成失败。");
	} finally {
		planButton.disabled = false;
	}
});
applyButton.addEventListener("click", async () => {
	if (!plannedPayload) return;
	planButton.disabled = true;
	applyButton.disabled = true;
	setMessage("", "");
	try {
		const result = await requestJson("${INSTALL_PATH}", plannedPayload);
		const backupText = result.backupPath ? " 原配置备份: " + result.backupPath + "。" : "";
		setMessage("success", "安装完成。请重启服务后访问 " + result.adminUrl + "。管理员 " + result.username + "，初始密码 " + result.initialPassword + "。配置文件: " + result.configPath + "。数据库: " + result.databasePath + "。系统设置写入 " + result.systemSettings.length + " 项。" + backupText);
		form.reset();
		plannedPayload = null;
	} catch (error) {
		setMessage("error", error instanceof Error ? error.message : "安装失败。");
		applyButton.disabled = false;
	} finally {
		planButton.disabled = false;
	}
});
</script>
</body>
</html>`;
}

async function assertInstallOpen(input: {
	minimalConfig: MinimalInstallConfig;
	environment?: NodeJS.ProcessEnv;
}): Promise<boolean> {
	const state = await resolveInstallState(
		input.minimalConfig,
		input.environment,
	);
	return !state.installed;
}

function parseInstallPayload(body: unknown) {
	const parsed = installApplySchema.safeParse(body);
	if (!parsed.success) {
		throw new InvalidRequestError({
			issues: parsed.error.issues,
		});
	}
	return parsed.data;
}

function resolveInstallToken(input: {
	payloadToken?: string;
	cookieHeader?: string;
	expectedToken: string;
}) {
	const token = input.payloadToken ?? readInstallCookie(input.cookieHeader);
	assertToken(token, input.expectedToken);
	return token;
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

	app.get("/admin", async (_, reply) => {
		return reply.redirect(INSTALL_PATH);
	});

	app.get("/admin/", async (_, reply) => {
		return reply.redirect(INSTALL_PATH);
	});

	app.get(INSTALL_PATH, async (request, reply) => {
		const blocked = await assertInstallOpen({
			minimalConfig: input.minimalConfig,
			environment: input.environment,
		});
		if (!blocked) {
			return reply.status(410).send({ installed: true });
		}
		return reply
			.header("Set-Cookie", createInstallCookie(input.minimalConfig.token))
			.type("text/html; charset=utf-8")
			.send(renderInstallHtml(input.minimalConfig));
	});

	app.post(INSTALL_PLAN_PATH, async (request, reply) => {
		const payload = parseInstallPayload(request.body);
		const blocked = await assertInstallOpen({
			minimalConfig: input.minimalConfig,
			environment: input.environment,
		});
		if (!blocked) {
			return reply.status(410).send({ installed: true });
		}
		const token = resolveInstallToken({
			payloadToken: payload.token,
			cookieHeader: request.headers.cookie,
			expectedToken: input.minimalConfig.token,
		});
		return buildInstallPlan({
			minimalConfig: input.minimalConfig,
			payload: {
				...payload,
				token,
			},
			environment: input.environment,
		});
	});

	app.post(INSTALL_PATH, async (request, reply) => {
		const payload = parseInstallPayload(request.body);
		const blocked = await assertInstallOpen({
			minimalConfig: input.minimalConfig,
			environment: input.environment,
		});
		if (!blocked) {
			return reply.status(410).send({ installed: true });
		}
		try {
			const token = resolveInstallToken({
				payloadToken: payload.token,
				cookieHeader: request.headers.cookie,
				expectedToken: input.minimalConfig.token,
			});
			const result = await applyInstall({
				minimalConfig: input.minimalConfig,
				payload: {
					...payload,
					token,
				},
				environment: input.environment,
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
