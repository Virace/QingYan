import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import { AppError, InvalidRequestError } from "../shared/errors";
import {
	applyInstall,
	buildInstallPlan,
	installApplySchema,
} from "./install-service";
import { envMappings, type EnvMapping } from "../../config/env-mapping";
import { defaultSystemSettings } from "../system-settings/definitions";
import type {
	InstallRestartMode,
	MinimalInstallConfig,
} from "./minimal-config";
import { resolveInstallState } from "./state";

const INSTALL_PATH = "/admin/install";
const INSTALL_PLAN_PATH = "/admin/install/plan";
const INSTALL_COOKIE_NAME = "qingyan_install";
const INSTALL_RESTART_AFTER_MS = 1200;
const INSTALL_POLL_INTERVAL_MS = 1000;
const INSTALL_POLL_TIMEOUT_MS = 60000;

export interface InstallTransition {
	mode: InstallRestartMode;
	adminUrl: string;
	pollUrl: string;
	restartRequired: true;
	restartAfterMs: number;
	pollIntervalMs: number;
	timeoutMs: number;
	message: string;
}

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

function buildInstallTransition(input: {
	mode: InstallRestartMode;
	adminUrl: string;
}): InstallTransition {
	return {
		mode: input.mode,
		adminUrl: input.adminUrl,
		pollUrl: input.adminUrl,
		restartRequired: true,
		restartAfterMs: INSTALL_RESTART_AFTER_MS,
		pollIntervalMs: INSTALL_POLL_INTERVAL_MS,
		timeoutMs: INSTALL_POLL_TIMEOUT_MS,
		message:
			input.mode === "exit"
				? "安装完成。QingYan 将重启服务，稍后会自动进入管理后台。"
				: "安装完成。请重启 QingYan 服务后访问管理后台。",
	};
}

const defaultSecurityConfig = {
	requestIdHeader: "x-request-id",
	globalFloodGuard: {
		enabled: true,
		windowSec: 10,
		maxRequests: 120,
	},
	publicOriginGuard: {
		enabled: true,
		allowMissingOrigin: false,
	},
	rateLimit: {
		adminLogin: {
			windowSec: 600,
			maxFailures: 5,
		},
		commentCreate: {
			windowSec: 300,
			maxRequests: 5,
		},
		commentVote: {
			windowSec: 300,
			maxRequests: 15,
		},
		captchaVerify: {
			windowSec: 300,
			maxFailures: 8,
		},
		pageLike: {
			windowSec: 300,
			maxRequests: 10,
		},
	},
};

function parseEnvValue(mapping: EnvMapping, rawValue: string): unknown {
	if (mapping.valueKind === "number") {
		const value = Number(rawValue);
		return Number.isFinite(value) ? value : rawValue;
	}
	if (mapping.valueKind === "boolean") {
		return rawValue.trim().toLowerCase() === "true";
	}
	if (mapping.valueKind === "sameSite") {
		return rawValue.trim().toLowerCase();
	}
	return rawValue;
}

function buildEnvLocks(environment: NodeJS.ProcessEnv) {
	return envMappings
		.filter((mapping) => environment[mapping.envName] !== undefined)
		.map((mapping) => {
			const rawValue = environment[mapping.envName] ?? "";
			const value = parseEnvValue(mapping, rawValue);
			const path =
				mapping.category === "system_settings_seed"
					? `systemSettings.${mapping.path}`
					: mapping.path === "database.sqlite.file"
						? "database.sqliteFile"
						: mapping.path;
			return {
				path,
				envName: mapping.envName,
				secret: mapping.secret,
				value: mapping.secret ? undefined : value,
				valuePreview: mapping.secret ? "configured" : value,
			};
		});
}

function renderInstallHtml(
	input: MinimalInstallConfig,
	environment: NodeJS.ProcessEnv = process.env,
): string {
	const defaults = {
		server: {
			host: "0.0.0.0",
			port: input.port,
			publicBaseUrl: resolveDefaultPublicBaseUrl(input),
			trustProxy: true,
		},
		database: {
			sqliteFile: "./data/qingyan.db",
		},
		admin: {
			consolePath: "",
			username: "",
			password: "",
			session: {
				cookieName: "qingyan_admin",
				ttlMinutes: 1440,
				sameSite: "lax",
				secure: false,
			},
		},
		site: {
			siteKey: "default",
			name: "Default",
			allowedOrigins: resolveDefaultPublicBaseUrl(input),
		},
		security: defaultSecurityConfig,
		systemSettings: defaultSystemSettings,
		restore: {
			fileName: "",
			payload: "",
		},
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
main { min-height: 100vh; display: grid; place-items: start center; padding: 28px 16px; box-sizing: border-box; }
.panel { width: min(1080px, 100%); background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; box-shadow: 0 16px 50px rgba(24, 24, 27, 0.08); overflow: hidden; }
.header { padding: 26px 30px 16px; border-bottom: 1px solid #f0f0f1; }
h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.25; }
p { margin: 0; color: #52525b; line-height: 1.6; }
form { display: grid; gap: 20px; padding: 22px 30px 30px; }
.steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.step-tab { min-height: 42px; border: 1px solid #d4d4d8; border-radius: 6px; padding: 0 10px; font: inherit; font-size: 13px; color: #3f3f46; background: #fff; cursor: pointer; }
.step-tab[aria-current="step"] { border-color: #0f766e; color: #0f766e; background: #ecfdf5; font-weight: 650; }
.step-tab:disabled { color: #a1a1aa; background: #fafafa; cursor: not-allowed; }
.step-panel { display: grid; gap: 18px; }
.step-panel[hidden] { display: none; }
.captcha-panel { display: grid; gap: 14px; }
.captcha-panel[hidden] { display: none; }
fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 14px; }
legend { font-weight: 650; margin-bottom: 2px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
label, .field { display: grid; gap: 7px; font-size: 14px; color: #3f3f46; }
.field-title { font-weight: 500; }
input, textarea, select { border: 1px solid #d4d4d8; border-radius: 6px; font: inherit; color: #18181b; background: #fff; box-sizing: border-box; }
input, select { height: 38px; padding: 0 11px; }
textarea { min-height: 92px; resize: vertical; padding: 10px 11px; line-height: 1.5; }
input[type="checkbox"] { width: 18px; height: 18px; padding: 0; }
input:focus, textarea:focus, select:focus { outline: 2px solid #0f766e; outline-offset: 1px; border-color: #0f766e; }
input:disabled, textarea:disabled, select:disabled { color: #52525b; background: #f4f4f5; cursor: not-allowed; }
.check { display: flex; align-items: center; gap: 9px; min-height: 38px; }
.hint { min-height: 18px; color: #71717a; font-size: 12px; line-height: 1.5; }
.hint[data-locked="true"] { color: #0f766e; }
button { height: 40px; border: 0; border-radius: 6px; padding: 0 16px; font: inherit; font-weight: 650; color: #fff; background: #0f766e; cursor: pointer; }
button.secondary { color: #3f3f46; background: #f4f4f5; border: 1px solid #d4d4d8; }
button:disabled { cursor: not-allowed; opacity: 0.6; }
.actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; }
.actions-group { display: flex; flex-wrap: wrap; gap: 10px; }
.message { display: none; border-radius: 6px; padding: 12px 14px; font-size: 14px; line-height: 1.6; }
.message[data-kind="error"] { display: block; border: 1px solid #fecaca; color: #991b1b; background: #fef2f2; }
.message[data-kind="success"] { display: block; border: 1px solid #bbf7d0; color: #166534; background: #f0fdf4; }
@media (max-width: 760px) { .header, form { padding-left: 20px; padding-right: 20px; } .steps, .grid, .grid.three { grid-template-columns: 1fr; } .actions { display: grid; } }
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
<nav class="steps" aria-label="安装步骤">
<button class="step-tab" type="button" data-step-target="0">服务与数据库</button>
<button class="step-tab" type="button" data-step-target="1">管理员与会话</button>
<button class="step-tab" type="button" data-step-target="2">站点与安全</button>
<button class="step-tab" type="button" data-step-target="3">系统设置</button>
<button class="step-tab" type="button" data-step-target="4">恢复与确认</button>
</nav>
<section class="step-panel" data-step="0">
<fieldset>
<legend>服务</legend>
<div class="grid">
<label>监听地址<input data-path="server.host" autocomplete="off" required><span class="hint" data-hint-for="server.host"></span></label>
<label>监听端口<input data-path="server.port" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="server.port"></span></label>
</div>
<label>公开访问地址<input data-path="server.publicBaseUrl" autocomplete="url" required><span class="hint" data-hint-for="server.publicBaseUrl"></span></label>
<label class="check"><input data-path="server.trustProxy" data-type="boolean" type="checkbox">信任反向代理头<span class="hint" data-hint-for="server.trustProxy">来自环境变量时不可修改</span></label>
</fieldset>
<fieldset>
<legend>数据库</legend>
<label>SQLite 文件<input data-path="database.sqliteFile" autocomplete="off" required><span class="hint" data-hint-for="database.sqliteFile"></span></label>
</fieldset>
</section>
<section class="step-panel" data-step="1" hidden>
<fieldset>
<legend>管理员 bootstrap</legend>
<div class="grid">
<label>后台入口<input data-path="admin.consolePath" autocomplete="off" placeholder="留空则随机生成"><span class="hint" data-hint-for="admin.consolePath"></span></label>
<label>用户名<input data-path="admin.username" autocomplete="username" placeholder="留空则使用 admin"><span class="hint" data-hint-for="admin.username"></span></label>
</div>
<label>初始密码<input data-path="admin.password" type="password" autocomplete="new-password" minlength="8" placeholder="留空则随机生成"><span class="hint" data-hint-for="admin.password"></span></label>
</fieldset>
<fieldset>
<legend>管理员会话</legend>
<div class="grid">
<label>Cookie 名称<input data-path="admin.session.cookieName" autocomplete="off" required><span class="hint" data-hint-for="admin.session.cookieName"></span></label>
<label>会话 TTL 分钟<input data-path="admin.session.ttlMinutes" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="admin.session.ttlMinutes"></span></label>
</div>
<div class="grid">
<label>SameSite<select data-path="admin.session.sameSite"><option value="strict">strict</option><option value="lax">lax</option><option value="none">none</option></select><span class="hint" data-hint-for="admin.session.sameSite">浏览器跨站请求是否携带后台登录 Cookie；不做跨站嵌入时通常保持 lax。</span></label>
<label class="check"><input data-path="admin.session.secure" data-type="boolean" type="checkbox">仅 HTTPS Secure Cookie<span class="hint" data-hint-for="admin.session.secure">启用后浏览器只会在 HTTPS 下发送后台登录 Cookie。</span></label>
</div>
</fieldset>
</section>
<section class="step-panel" data-step="2" hidden>
<fieldset>
<legend>默认站点</legend>
<div class="grid">
<label>站点 Key<input data-path="site.siteKey" autocomplete="off" required><span class="hint" data-hint-for="site.siteKey"></span></label>
<label>站点名称<input data-path="site.name" autocomplete="off" required><span class="hint" data-hint-for="site.name"></span></label>
</div>
<label>允许的前端 Origin<textarea data-path="site.allowedOrigins" data-type="stringArray" required></textarea><span class="hint" data-hint-for="site.allowedOrigins">可用逗号、空格或换行分隔多个 Origin</span></label>
</fieldset>
<fieldset>
<legend>安全基础配置</legend>
<div class="grid three">
<label>Request ID Header<input data-path="security.requestIdHeader" required><span class="hint" data-hint-for="security.requestIdHeader"></span></label>
<label>Flood 窗口秒<input data-path="security.globalFloodGuard.windowSec" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.globalFloodGuard.windowSec">全局请求洪泛防护的统计时间窗口。</span></label>
<label>Flood 最大请求<input data-path="security.globalFloodGuard.maxRequests" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.globalFloodGuard.maxRequests">同一窗口内允许的最大请求数。</span></label>
</div>
<div class="grid">
<label class="check"><input data-path="security.globalFloodGuard.enabled" data-type="boolean" type="checkbox">启用全局 flood guard<span class="hint" data-hint-for="security.globalFloodGuard.enabled">对所有请求做基础频率限制，降低异常流量影响。</span></label>
<label class="check"><input data-path="security.publicOriginGuard.enabled" data-type="boolean" type="checkbox">启用公开 Origin guard<span class="hint" data-hint-for="security.publicOriginGuard.enabled">检查浏览器 Origin，只允许配置站点发起公开写请求。</span></label>
</div>
<label class="check"><input data-path="security.publicOriginGuard.allowMissingOrigin" data-type="boolean" type="checkbox">允许缺失 Origin 的公开写请求<span class="hint" data-hint-for="security.publicOriginGuard.allowMissingOrigin">仅用于非浏览器脚本或特殊代理；公开部署通常关闭。</span></label>
</fieldset>
<fieldset>
<legend>Rate limit</legend>
<div class="grid">
<label>管理员登录窗口秒<input data-path="security.rateLimit.adminLogin.windowSec" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.adminLogin.windowSec"></span></label>
<label>管理员登录最大失败<input data-path="security.rateLimit.adminLogin.maxFailures" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.adminLogin.maxFailures"></span></label>
</div>
<div class="grid">
<label>评论创建窗口秒<input data-path="security.rateLimit.commentCreate.windowSec" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.commentCreate.windowSec"></span></label>
<label>评论创建最大请求<input data-path="security.rateLimit.commentCreate.maxRequests" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.commentCreate.maxRequests"></span></label>
</div>
<div class="grid">
<label>评论投票窗口秒<input data-path="security.rateLimit.commentVote.windowSec" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.commentVote.windowSec"></span></label>
<label>评论投票最大请求<input data-path="security.rateLimit.commentVote.maxRequests" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.commentVote.maxRequests"></span></label>
</div>
<div class="grid">
<label>验证码验证窗口秒<input data-path="security.rateLimit.captchaVerify.windowSec" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.captchaVerify.windowSec"></span></label>
<label>验证码验证最大失败<input data-path="security.rateLimit.captchaVerify.maxFailures" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.captchaVerify.maxFailures"></span></label>
</div>
<div class="grid">
<label>页面点赞窗口秒<input data-path="security.rateLimit.pageLike.windowSec" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.pageLike.windowSec"></span></label>
<label>页面点赞最大请求<input data-path="security.rateLimit.pageLike.maxRequests" type="number" min="1" step="1" data-type="number" required><span class="hint" data-hint-for="security.rateLimit.pageLike.maxRequests"></span></label>
</div>
</fieldset>
</section>
<section class="step-panel" data-step="3" hidden>
<fieldset>
<legend>日志与邮件</legend>
<div class="grid">
<label>日志级别<select data-path="systemSettings.logging.level"><option value="error">error</option><option value="warn">warn</option><option value="info">info</option><option value="debug">debug</option></select><span class="hint" data-hint-for="systemSettings.logging.level"></span></label>
<label>日志保留天数<input data-path="systemSettings.logging.retentionDays" type="number" min="1" max="3650" step="1" data-type="number" required><span class="hint" data-hint-for="systemSettings.logging.retentionDays"></span></label>
</div>
<label class="check"><input data-path="systemSettings.mail.enabled" data-type="boolean" type="checkbox">启用邮件通知<span class="hint" data-hint-for="systemSettings.mail.enabled"></span></label>
<div class="grid three">
<label>SMTP Host<input data-path="systemSettings.mail.smtp.host"><span class="hint" data-hint-for="systemSettings.mail.smtp.host"></span></label>
<label>SMTP Port<input data-path="systemSettings.mail.smtp.port" type="number" min="1" step="1" data-type="number"><span class="hint" data-hint-for="systemSettings.mail.smtp.port"></span></label>
<label class="check"><input data-path="systemSettings.mail.smtp.secure" data-type="boolean" type="checkbox">SMTP 加密连接 Secure<span class="hint" data-hint-for="systemSettings.mail.smtp.secure">连接 SMTP 服务时是否直接使用 TLS。</span></label>
</div>
<div class="grid">
<label>SMTP 用户名<input data-path="systemSettings.mail.smtp.username"><span class="hint" data-hint-for="systemSettings.mail.smtp.username"></span></label>
<label>发件人<input data-path="systemSettings.mail.smtp.from"><span class="hint" data-hint-for="systemSettings.mail.smtp.from"></span></label>
</div>
<label>SMTP 密码<input data-path="systemSettings.mail.smtp.password" type="password" autocomplete="new-password"><span class="hint" data-hint-for="systemSettings.mail.smtp.password"></span></label>
</fieldset>
<fieldset>
<legend>头像 / Gravatar</legend>
<label class="check"><input data-path="systemSettings.avatar.gravatar.enabled" data-type="boolean" type="checkbox">启用 Gravatar<span class="hint" data-hint-for="systemSettings.avatar.gravatar.enabled">开启后公开评论作者会返回 author.gravatarUrl。</span></label>
<label>Gravatar Base URL<input data-path="systemSettings.avatar.gravatar.baseUrl"><span class="hint" data-hint-for="systemSettings.avatar.gravatar.baseUrl">默认 https://gravatar.com/avatar；国内部署可配置镜像地址。</span></label>
</fieldset>
<fieldset>
<legend>验证码</legend>
<label>验证码类型 Provider<select data-path="systemSettings.captcha.provider"><option value="image">内置图片 image</option><option value="turnstile">Cloudflare Turnstile</option><option value="hcaptcha">hCaptcha</option><option value="recaptcha">Google reCAPTCHA</option><option value="geetest">极验 GeeTest</option></select><span class="hint" data-hint-for="systemSettings.captcha.provider">选择后只显示该验证码服务需要填写的配置项。</span></label>
<div class="captcha-panel" data-captcha-panel="image">
<div class="grid three">
<label>图片宽度<input data-path="systemSettings.captcha.image.width" type="number" min="1" step="1" data-type="number"><span class="hint" data-hint-for="systemSettings.captcha.image.width"></span></label>
<label>图片高度<input data-path="systemSettings.captcha.image.height" type="number" min="1" step="1" data-type="number"><span class="hint" data-hint-for="systemSettings.captcha.image.height"></span></label>
<label>图片 TTL 秒<input data-path="systemSettings.captcha.image.ttlSec" type="number" min="1" step="1" data-type="number"><span class="hint" data-hint-for="systemSettings.captcha.image.ttlSec">验证码有效期，超过后需要重新获取。</span></label>
</div>
</div>
<div class="captcha-panel" data-captcha-panel="turnstile" hidden>
<div class="grid">
<label>Turnstile Site Key<input data-path="systemSettings.captcha.turnstile.siteKey"><span class="hint" data-hint-for="systemSettings.captcha.turnstile.siteKey"></span></label>
<label>Turnstile Secret Key<input data-path="systemSettings.captcha.turnstile.secretKey" type="password"><span class="hint" data-hint-for="systemSettings.captcha.turnstile.secretKey"></span></label>
</div>
<div class="grid">
<label>Turnstile Action<input data-path="systemSettings.captcha.turnstile.expectedAction"><span class="hint" data-hint-for="systemSettings.captcha.turnstile.expectedAction"></span></label>
<label>Turnstile Hostname<input data-path="systemSettings.captcha.turnstile.expectedHostname"><span class="hint" data-hint-for="systemSettings.captcha.turnstile.expectedHostname"></span></label>
</div>
</div>
<div class="captcha-panel" data-captcha-panel="hcaptcha" hidden>
<div class="grid">
<label>hCaptcha Site Key<input data-path="systemSettings.captcha.hcaptcha.siteKey"><span class="hint" data-hint-for="systemSettings.captcha.hcaptcha.siteKey"></span></label>
<label>hCaptcha Secret Key<input data-path="systemSettings.captcha.hcaptcha.secretKey" type="password"><span class="hint" data-hint-for="systemSettings.captcha.hcaptcha.secretKey"></span></label>
</div>
<label>hCaptcha Hostname<input data-path="systemSettings.captcha.hcaptcha.expectedHostname"><span class="hint" data-hint-for="systemSettings.captcha.hcaptcha.expectedHostname"></span></label>
</div>
<div class="captcha-panel" data-captcha-panel="recaptcha" hidden>
<div class="grid three">
<label>reCAPTCHA Variant<select data-path="systemSettings.captcha.recaptcha.variant"><option value="score_based">score_based</option><option value="policy_based_challenge">policy_based_challenge</option></select><span class="hint" data-hint-for="systemSettings.captcha.recaptcha.variant"></span></label>
<label>reCAPTCHA Project ID<input data-path="systemSettings.captcha.recaptcha.projectId"><span class="hint" data-hint-for="systemSettings.captcha.recaptcha.projectId"></span></label>
<label>reCAPTCHA Site Key<input data-path="systemSettings.captcha.recaptcha.siteKey"><span class="hint" data-hint-for="systemSettings.captcha.recaptcha.siteKey"></span></label>
</div>
<div class="grid">
<label>reCAPTCHA API Key<input data-path="systemSettings.captcha.recaptcha.apiKey" type="password"><span class="hint" data-hint-for="systemSettings.captcha.recaptcha.apiKey"></span></label>
<label>reCAPTCHA Action<input data-path="systemSettings.captcha.recaptcha.expectedAction"><span class="hint" data-hint-for="systemSettings.captcha.recaptcha.expectedAction"></span></label>
</div>
<div class="grid">
<label>reCAPTCHA Hostname<input data-path="systemSettings.captcha.recaptcha.expectedHostname"><span class="hint" data-hint-for="systemSettings.captcha.recaptcha.expectedHostname"></span></label>
<label>reCAPTCHA 最低分数 Min Score<input data-path="systemSettings.captcha.recaptcha.minScore" type="number" min="0" max="1" step="0.01" data-type="number"><span class="hint" data-hint-for="systemSettings.captcha.recaptcha.minScore">score_based 模式下低于该分数的验证会被拒绝，范围 0 到 1。</span></label>
</div>
</div>
<div class="captcha-panel" data-captcha-panel="geetest" hidden>
<div class="grid">
<label>GeeTest Captcha ID<input data-path="systemSettings.captcha.geetest.captchaId"><span class="hint" data-hint-for="systemSettings.captcha.geetest.captchaId"></span></label>
<label>GeeTest Captcha Key<input data-path="systemSettings.captcha.geetest.captchaKey" type="password"><span class="hint" data-hint-for="systemSettings.captcha.geetest.captchaKey"></span></label>
</div>
<label>GeeTest API Server<input data-path="systemSettings.captcha.geetest.apiServer"><span class="hint" data-hint-for="systemSettings.captcha.geetest.apiServer"></span></label>
</div>
</fieldset>
<fieldset>
<legend>IP 地域库</legend>
<div class="grid three">
<label class="check"><input data-path="systemSettings.ipRegion.enabled" data-type="boolean" type="checkbox">启用 IP 地域解析<span class="hint" data-hint-for="systemSettings.ipRegion.enabled"></span></label>
<label>缓存策略<select data-path="systemSettings.ipRegion.cachePolicy"><option value="file">file</option><option value="vectorIndex">vectorIndex</option><option value="content">content</option></select><span class="hint" data-hint-for="systemSettings.ipRegion.cachePolicy"></span></label>
<label>精度<select data-path="systemSettings.ipRegion.precision"><option value="country">country</option><option value="province">province</option><option value="city">city</option></select><span class="hint" data-hint-for="systemSettings.ipRegion.precision"></span></label>
</div>
<label class="check"><input data-path="systemSettings.ipRegion.autoUpdate.enabled" data-type="boolean" type="checkbox">每月自动更新<span class="hint" data-hint-for="systemSettings.ipRegion.autoUpdate.enabled"></span></label>
<div class="grid">
<label>IPv4 xdb 路径<input data-path="systemSettings.ipRegion.ipv4.dbPath"><span class="hint" data-hint-for="systemSettings.ipRegion.ipv4.dbPath"></span></label>
<label>IPv6 xdb 路径<input data-path="systemSettings.ipRegion.ipv6.dbPath"><span class="hint" data-hint-for="systemSettings.ipRegion.ipv6.dbPath"></span></label>
</div>
<label>IPv4 下载源<textarea data-path="systemSettings.ipRegion.ipv4.sources" data-type="stringArray"></textarea><span class="hint" data-hint-for="systemSettings.ipRegion.ipv4.sources">每行一个 URL</span></label>
<label>IPv6 下载源<textarea data-path="systemSettings.ipRegion.ipv6.sources" data-type="stringArray"></textarea><span class="hint" data-hint-for="systemSettings.ipRegion.ipv6.sources">每行一个 URL</span></label>
</fieldset>
</section>
<section class="step-panel" data-step="4" hidden>
<fieldset>
<legend>从导出包恢复</legend>
<label>导出文件名<input data-path="restore.fileName" autocomplete="off" placeholder="qingyan-export.json"><span class="hint" data-hint-for="restore.fileName"></span></label>
<label>QingYan 导出 JSON<textarea data-path="restore.payload" spellcheck="false" placeholder="留空则只执行全新安装"></textarea><span class="hint" data-hint-for="restore.payload"></span></label>
</fieldset>
<section id="install-review" class="message"></section>
<div id="install-message" class="message"></div>
</section>
<div class="actions">
<button class="secondary" id="step-prev" type="button">上一步</button>
<div class="actions-group">
<button class="secondary" id="step-next" type="button">下一步</button>
<button id="install-plan" type="submit">生成安装计划</button>
<button id="install-apply" type="button" disabled>确认安装</button>
</div>
</div>
</form>
</section>
</main>
<script>
const defaults = ${JSON.stringify(defaults)};
const envLocks = ${JSON.stringify(buildEnvLocks(environment))};
const form = document.getElementById("install-form");
const planButton = document.getElementById("install-plan");
const applyButton = document.getElementById("install-apply");
const prevButton = document.getElementById("step-prev");
const nextButton = document.getElementById("step-next");
const message = document.getElementById("install-message");
const review = document.getElementById("install-review");
const stepTabs = Array.from(document.querySelectorAll("[data-step-target]"));
const stepPanels = Array.from(document.querySelectorAll("[data-step]"));
const fields = Array.from(document.querySelectorAll("[data-path]"));
const captchaPanels = Array.from(document.querySelectorAll("[data-captcha-panel]"));
const captchaProviderField = document.querySelector('[data-path="systemSettings.captcha.provider"]');
const envLockByPath = new Map(envLocks.map((lock) => [lock.path, lock]));
let currentStep = 0;
let maxUnlockedStep = 0;
let plannedPayload = null;

function getPath(source, path) {
	return path.split(".").reduce((cursor, key) => cursor == null ? undefined : cursor[key], source);
}
function setPath(target, path, value) {
	const keys = path.split(".");
	let cursor = target;
	for (const key of keys.slice(0, -1)) {
		if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
			cursor[key] = {};
		}
		cursor = cursor[key];
	}
	cursor[keys[keys.length - 1]] = value;
}
function formatInputValue(value, type) {
	if (type === "stringArray") {
		return Array.isArray(value) ? value.join("\\n") : String(value ?? "");
	}
	return value == null ? "" : String(value);
}
function writeFieldValue(field, value) {
	const type = field.dataset.type;
	if (type === "boolean") {
		field.checked = Boolean(value);
		return;
	}
	field.value = formatInputValue(value, type);
}
function readFieldValue(field) {
	const type = field.dataset.type;
	if (type === "boolean") {
		return field.checked;
	}
	if (type === "number") {
		return Number(field.value);
	}
	if (type === "stringArray") {
		return field.value.split(/\\s*,\\s*|\\n|\\s+/).map((item) => item.trim()).filter(Boolean);
	}
	return field.value;
}
function isFieldRelevant(field) {
	const captchaPanel = field.closest("[data-captcha-panel]");
	if (!captchaPanel) {
		return true;
	}
	return !captchaPanel.hidden;
}
function validateStep(step) {
	const panel = stepPanels.find((item) => Number(item.dataset.step) === step);
	if (!panel) return true;
	const invalidField = Array.from(panel.querySelectorAll("input, textarea, select")).find((field) => {
		if (!isFieldRelevant(field) || field.disabled) {
			return false;
		}
		return !field.checkValidity();
	});
	if (!invalidField) {
		return true;
	}
	invalidField.reportValidity();
	return false;
}
function setHint(path, text, locked = false) {
	const hint = document.querySelector('[data-hint-for="' + path + '"]');
	if (!hint) return;
	hint.textContent = text;
	if (locked) {
		hint.dataset.locked = "true";
	}
}
function applyDefaults() {
	for (const field of fields) {
		const value = getPath(defaults, field.dataset.path);
		writeFieldValue(field, value);
	}
	for (const lock of envLocks) {
		const field = document.querySelector('[data-path="' + lock.path + '"]');
		if (!field) continue;
		field.disabled = true;
		if (field.dataset.type === "boolean") {
			field.checked = Boolean(lock.value);
		} else {
			field.value = lock.secret ? "已配置" : formatInputValue(lock.value, field.dataset.type);
		}
		setHint(lock.path, "来自环境变量 " + lock.envName, true);
	}
}
function setStep(step) {
	currentStep = Math.max(0, Math.min(stepPanels.length - 1, step));
	for (const panel of stepPanels) {
		panel.hidden = Number(panel.dataset.step) !== currentStep;
	}
	for (const tab of stepTabs) {
		const target = Number(tab.dataset.stepTarget);
		const active = target === currentStep;
		tab.setAttribute("aria-current", active ? "step" : "false");
		tab.disabled = target > maxUnlockedStep;
	}
	prevButton.disabled = currentStep === 0;
	nextButton.hidden = currentStep === stepPanels.length - 1;
	planButton.hidden = currentStep !== stepPanels.length - 1;
	applyButton.hidden = currentStep !== stepPanels.length - 1;
}
function updateCaptchaPanel() {
	const provider = captchaProviderField?.value ?? "image";
	for (const panel of captchaPanels) {
		panel.hidden = panel.dataset.captchaPanel !== provider;
	}
}

function renderList(items) {
	if (!items.length) {
		return "无";
	}
	return "<ul>" + items.map((item) => "<li>" + item + "</li>").join("") + "</ul>";
}

function formatSource(source) {
	if (source === "environment") return "环境变量";
	if (source === "generated") return "自动生成";
	if (source === "default") return "默认值";
	return "输入";
}
function setMessage(kind, text) {
	message.dataset.kind = kind;
	message.textContent = text;
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForAdmin(transition) {
	setMessage("success", "正在重启服务并进入管理后台。管理员入口: " + transition.adminUrl);
	await sleep(transition.restartAfterMs);
	const start = Date.now();
	while (Date.now() - start < transition.timeoutMs) {
		try {
			await fetch(transition.pollUrl, {
				method: "GET",
				mode: "no-cors",
				cache: "no-store",
			});
			window.location.href = transition.adminUrl;
			return;
		} catch (_) {
			await sleep(transition.pollIntervalMs);
		}
	}
	setMessage("error", "服务重启等待超时。请确认守护进程已重新拉起 QingYan，然后访问 " + transition.adminUrl + "。");
}
function optionalString(value) {
	const text = String(value ?? "").trim();
	return text || undefined;
}
function collectRestore(payloadText, fileName) {
	const text = String(payloadText ?? "").trim();
	if (!text) return undefined;
	let payload;
	try {
		payload = JSON.parse(text);
	} catch (_) {
		throw new Error("QingYan 导出 JSON 格式无效。");
	}
	return {
		enabled: true,
		fileName: optionalString(fileName) ?? "qingyan-export.json",
		payload,
		existingStrategy: "fail_on_existing",
		importMode: "full_site",
		settingsStrategy: "replace_settings",
	};
}
function collectPayload() {
	const raw = {};
	for (const field of fields) {
		if (!isFieldRelevant(field)) {
			continue;
		}
		const path = field.dataset.path;
		const lock = envLockByPath.get(path);
		if (lock) {
			setPath(raw, path, lock.secret ? undefined : lock.value);
			continue;
		}
		setPath(raw, path, readFieldValue(field));
	}
	return {
		server: raw.server,
		database: raw.database,
		admin: {
			...raw.admin,
			consolePath: optionalString(raw.admin?.consolePath),
			username: optionalString(raw.admin?.username),
			password: optionalString(raw.admin?.password),
		},
		security: raw.security,
		site: raw.site,
		systemSettings: raw.systemSettings,
		restore: collectRestore(raw.restore?.payload, raw.restore?.fileName),
	};
}
function renderPlan(plan) {
	const valueItems = plan.values.map((item) => {
		const env = item.env ? " / " + item.env : "";
		const preview = item.secret
			? "已配置"
			: item.valuePreview === null || item.valuePreview === undefined
				? "空"
				: String(item.valuePreview);
		return item.path + ": " + preview + "（" + formatSource(item.source) + env + "）";
	});
	const systemReview = [
		"默认系统设置: " + plan.systemSettingsReview.defaultSeedCount + " 项",
		...plan.systemSettingsReview.environmentSeeds.map((item) =>
			item.path + ": " + (item.secret ? "已配置" : item.valuePreview) + "（" + item.envName + "）"
		),
	];
	const envFields = plan.env.length
		? plan.env.map((item) => item.envName + " -> " + item.path + (item.secret ? "（已隐藏）" : "")).join(", ")
		: "无";
	const restoreText = plan.restore
		? "<br>恢复: " + plan.restore.fileName +
			" / " + plan.restore.siteKey +
			"（页面 " + plan.restore.dryRun.summary.willCreatePageThreads +
			"，访客 " + plan.restore.dryRun.summary.willCreateVisitors +
			"，评论 " + plan.restore.dryRun.summary.willCreateComments +
			"，冲突 " + plan.restore.dryRun.summary.conflicts + "）"
		: "";
	review.dataset.kind = "success";
	review.innerHTML =
		"<strong>安装计划</strong><br>" +
		"配置文件: " + plan.config.path + "<br>" +
		"数据库: " + plan.database.sqliteFile + "<br>" +
		"后台入口: " + plan.admin.consolePath + "<br>" +
		"管理员: " + plan.admin.username + (plan.admin.passwordGenerated ? "（将随机生成初始密码）" : "") + "<br>" +
		"默认站点: " + plan.site.siteKey + " / " + plan.site.name + "<br>" +
		"安装值: " + renderList(valueItems) +
		"系统设置写入: " + renderList(systemReview) +
		"环境变量锁定: " + envFields +
		restoreText;
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
	if (!validateStep(currentStep)) {
		return;
	}
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
		const restoreText = result.restore ? "恢复站点 " + result.restore.siteKey + "，写入评论 " + result.restore.apply.summary.createdComments + " 条。" : "";
		const transition = result.transition;
		setMessage("success", transition.message + " 管理员 " + result.username + "，初始密码 " + result.initialPassword + "。管理后台: " + transition.adminUrl + "。配置文件: " + result.configPath + "。数据库: " + result.databasePath + "。系统设置写入 " + result.systemSettings.length + " 项。" + restoreText + backupText);
		form.reset();
		plannedPayload = null;
		if (transition.mode === "exit") {
			void waitForAdmin(transition);
		}
	} catch (error) {
		setMessage("error", error instanceof Error ? error.message : "安装失败。");
		applyButton.disabled = false;
	} finally {
		planButton.disabled = false;
	}
});
for (const tab of stepTabs) {
	tab.addEventListener("click", () => {
		const target = Number(tab.dataset.stepTarget);
		if (target <= maxUnlockedStep) {
			setStep(target);
		}
	});
}
prevButton.addEventListener("click", () => setStep(currentStep - 1));
nextButton.addEventListener("click", () => {
	if (!validateStep(currentStep)) {
		return;
	}
	maxUnlockedStep = Math.max(maxUnlockedStep, currentStep + 1);
	setStep(currentStep + 1);
});
captchaProviderField?.addEventListener("change", updateCaptchaPanel);
applyDefaults();
updateCaptchaPanel();
setStep(0);
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
	scheduleRestart?: (transition: InstallTransition) => void;
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

	app.get(INSTALL_PATH, async (_request, reply) => {
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
			.send(renderInstallHtml(input.minimalConfig, input.environment));
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
			const transition = buildInstallTransition({
				mode: input.minimalConfig.restartMode,
				adminUrl: result.adminUrl,
			});
			if (transition.mode === "exit") {
				input.scheduleRestart?.(transition);
			}
			return reply.status(201).send({
				...result,
				transition,
			});
		} catch (error) {
			if (error instanceof Error && error.message === "INSTALL_TOKEN_INVALID") {
				throw new AppError(403, "INSTALL_TOKEN_INVALID", "安装令牌无效。");
			}
			throw error;
		}
	});

	return app;
}
