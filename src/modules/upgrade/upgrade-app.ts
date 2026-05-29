import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "../../config/types";
import { joinPublicPath, qingyanCookiePath } from "../../config/public-path";
import type { SqliteClient } from "../../db/client";
import { buildErrorResponse } from "../shared/error-response";
import { AppError } from "../shared/errors";
import {
	upgradeRoutes,
	UPGRADE_COOKIE_NAME,
	UPGRADE_PATH,
} from "./upgrade-routes";
import {
	UpgradeService,
	type RegisteredApplicationUpgrade,
} from "./upgrade-service";

export interface CreateUpgradeAppInput {
	configPath: string;
	loadedConfig?: AppConfig;
	configError?: unknown;
	databaseFile: string;
	currentApplicationVersion: string;
	partialUpgradeMarkerPath: string;
	createSqliteClient: (databaseFile: string) => SqliteClient;
	registeredApplicationUpgrades?: RegisteredApplicationUpgrade[];
	backupDirectory?: string;
	migrationDirectory?: string;
	token?: string;
	now?: () => Date;
}

function createUpgradeCookie(token: string, publicPath: string): string {
	return `${UPGRADE_COOKIE_NAME}=${encodeURIComponent(token)}; Path=${qingyanCookiePath(publicPath)}; HttpOnly; SameSite=Lax`;
}

function renderValue(value: unknown): string {
	return JSON.stringify(value, null, 2)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function renderUpgradeHtml(state: unknown, applyPath: string): string {
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>QingYan Upgrade</title>
<style>
:root { color-scheme: light; font-family: Inter, "Segoe UI", system-ui, sans-serif; background: #f6f7f9; color: #18181b; }
body { margin: 0; }
main { min-height: 100vh; display: grid; place-items: start center; padding: 28px 16px; box-sizing: border-box; }
.panel { width: min(980px, 100%); background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; box-shadow: 0 16px 50px rgba(24, 24, 27, 0.08); overflow: hidden; }
.header { padding: 26px 30px 16px; border-bottom: 1px solid #f0f0f1; }
h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.25; }
p { margin: 0; color: #52525b; line-height: 1.6; }
.content { display: grid; gap: 18px; padding: 22px 30px 30px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 6px; padding: 14px; line-height: 1.55; }
label { display: grid; gap: 7px; font-size: 14px; color: #3f3f46; }
input { height: 38px; border: 1px solid #d4d4d8; border-radius: 6px; padding: 0 11px; font: inherit; }
button { height: 40px; border: 0; border-radius: 6px; padding: 0 16px; font: inherit; font-weight: 650; color: #fff; background: #0f766e; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: 0.6; }
.message { min-height: 22px; color: #52525b; line-height: 1.6; }
</style>
</head>
<body>
<main>
<section class="panel">
<div class="header">
<h1>QingYan Upgrade</h1>
<p>当前实例需要在启动正常服务前完成升级。请确认备份与风险后执行。</p>
</div>
<div class="content">
<pre id="state">${renderValue(state)}</pre>
<label>确认文本<input id="confirm" autocomplete="off" placeholder="UPGRADE QINGYAN"></label>
<button id="apply" type="button">执行升级</button>
<div id="message" class="message"></div>
</div>
</section>
</main>
<script>
const applyButton = document.getElementById("apply");
const confirmInput = document.getElementById("confirm");
const message = document.getElementById("message");
applyButton.addEventListener("click", async () => {
	applyButton.disabled = true;
	message.textContent = "";
	try {
		const response = await fetch("${applyPath}", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ confirm: confirmInput.value }),
		});
		const result = await response.json();
		if (!response.ok) {
			throw new Error(result?.error?.message ?? "升级失败。");
		}
		message.textContent = "升级完成，请重启 QingYan 服务。";
		document.getElementById("state").textContent = JSON.stringify(result, null, 2);
	} catch (error) {
		message.textContent = error instanceof Error ? error.message : "升级失败。";
		applyButton.disabled = false;
	}
});
</script>
</body>
</html>`;
}

export function createUpgradeApp(
	input: CreateUpgradeAppInput,
): FastifyInstance {
	const app = Fastify({
		logger: true,
		disableRequestLogging: true,
	});
	const token = input.token ?? `qy_upgrade_${randomUUID()}`;
	const service = new UpgradeService(input);
	const publicPath = input.loadedConfig?.server.publicPath ?? "/qingyan";
	const upgradePath = joinPublicPath(publicPath, UPGRADE_PATH);
	const upgradeApiPath = joinPublicPath(publicPath, "/api/upgrade");

	app.setErrorHandler((error, request, reply) => {
		const requestId = request.id;
		if (error instanceof AppError) {
			const response = buildErrorResponse(error, requestId);
			reply.status(response.statusCode).send(response.body);
			return;
		}
		app.log.error({ err: error }, "Unhandled upgrade request error");
		const response = buildErrorResponse(error, requestId);
		reply.status(response.statusCode).send(response.body);
	});

	app.get(upgradePath, async (_request, reply) =>
		reply
			.header("Set-Cookie", createUpgradeCookie(token, publicPath))
			.type("text/html; charset=utf-8")
			.send(
				renderUpgradeHtml(service.publicState(), `${upgradeApiPath}/apply`),
			),
	);

	void app.register(upgradeRoutes, {
		prefix: upgradeApiPath,
		service,
		token,
	});

	return app;
}
