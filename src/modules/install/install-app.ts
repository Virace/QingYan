import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { type EnvMapping, envMappings } from "../../config/env-mapping";
import {
	joinPublicPath,
	normalizePublicPath,
	qingyanCookiePath,
} from "../../config/public-path";
import { buildErrorResponse } from "../shared/error-response";
import { AppError, InvalidRequestError } from "../shared/errors";
import {
	defaultAdminSessionTtlMinutes,
	defaultSystemSettings,
} from "../system-settings/definitions";
import {
	getSettingLabel,
	getSettingOptionLabel,
	settingUiMetadata,
} from "../system-settings/ui-metadata";
import {
	applyInstall,
	buildInstallPlan,
	type InstallIpRegionUpdater,
	installApplySchema,
} from "./install-service";
import type {
	InstallTransitionMode,
	MinimalInstallConfig,
} from "./minimal-config";
import { resolveInstallState } from "./state";

const INSTALL_PATH = "/admin/install";
const INSTALL_PLAN_PATH = "/admin/install/plan";
const INSTALL_COOKIE_NAME = "qingyan_install";
const INSTALL_RESTART_AFTER_MS = 1200;

export interface InstallTransition {
	mode: InstallTransitionMode;
	adminUrl: string;
	pollUrl: string;
	restartRequired: true;
	restartAfterMs: number;
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

function createInstallCookie(token: string, publicPath: string): string {
	return `${INSTALL_COOKIE_NAME}=${encodeURIComponent(token)}; Path=${qingyanCookiePath(publicPath)}; HttpOnly; SameSite=Lax`;
}

function resolveDefaultPublicBaseUrl(input: MinimalInstallConfig): string {
	const host =
		input.host === "0.0.0.0" || input.host === "::" ? "localhost" : input.host;
	return `http://${host}:${input.port}`;
}

function buildInstallTransition(input: {
	mode: InstallTransitionMode;
	adminUrl: string;
}): InstallTransition {
	const message =
		input.mode === "reload_in_process"
			? "安装完成。QingYan 将切换到正常服务，稍后会自动进入管理后台。"
			: input.mode === "exit_for_supervisor"
				? "安装完成。QingYan 将退出并由守护进程重新拉起，稍后会自动进入管理后台。"
				: "安装完成。请重启 QingYan 服务后访问管理后台。";
	return {
		mode: input.mode,
		adminUrl: input.adminUrl,
		pollUrl: input.adminUrl,
		restartRequired: true,
		restartAfterMs: INSTALL_RESTART_AFTER_MS,
		message,
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
	adminOriginGuard: {
		enabled: true,
		allowMissingOrigin: false,
		allowedOrigins: [],
	},
	rateLimit: {
		adminLogin: {
			windowSec: 600,
			maxFailures: 5,
			autoBlacklistSec: 1800,
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

function optionLabel(path: string, value: string): string {
	return getSettingOptionLabel(path, value);
}

function renderInstallHtml(
	input: MinimalInstallConfig,
	environment: NodeJS.ProcessEnv = process.env,
): string {
	const publicPath = normalizePublicPath(input.publicPath);
	const defaults = {
		server: {
			host: "0.0.0.0",
			port: input.port,
			publicBaseUrl: resolveDefaultPublicBaseUrl(input),
			publicPath,
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
				ttlMinutes: defaultAdminSessionTtlMinutes,
				sameSite: "lax",
				secure: false,
			},
		},
		site: {
			siteKey: "default",
			name: "Default",
			allowedOrigins: resolveDefaultPublicBaseUrl(input),
		},
		siteSettings: {
			engagement: {
				visitors: {
					enabled: true,
				},
				pageViews: {
					enabled: false,
				},
				pageLikes: {
					enabled: false,
				},
				commentVotes: {
					enabled: false,
				},
			},
			comments: {
				verifiedAuthor: {
					enabled: true,
					displayName: "管理员",
					email: "",
					website: "",
					badgeLabel: "管理员",
				},
			},
		},
		security: defaultSecurityConfig,
		systemSettings: defaultSystemSettings,
		restore: {
			fileName: "",
			payload: "",
		},
	};
	const settingLabels = Object.fromEntries(
		Object.keys(settingUiMetadata).map((path) => [path, getSettingLabel(path)]),
	);
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
.restore-note { border: 1px solid #ccfbf1; border-radius: 6px; padding: 12px 14px; color: #115e59; background: #f0fdfa; font-size: 13px; line-height: 1.6; }
.restore-options { margin: 8px 0 0; padding-left: 18px; color: #3f3f46; }
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
<label>公开访问地址<input data-path="server.publicBaseUrl" autocomplete="url" required><span class="hint" data-hint-for="server.publicBaseUrl">填写用户实际访问 QingYan 的域名或 IP origin，不包含 /qingyan。Docker 内部 localhost:4401 通常不是反代后的公开地址。</span></label>
<label>公开挂载路径<input data-path="server.publicPath" autocomplete="off" required><span class="hint" data-hint-for="server.publicPath">QingYan 对外路径前缀。修改后必须同步修改反向代理 location/path rewrite，否则 Admin、API 和 Cookie path 会不匹配。</span></label>
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
<label>SameSite<select data-path="admin.session.sameSite"><option value="strict">${optionLabel("admin.session.sameSite", "strict")}</option><option value="lax">${optionLabel("admin.session.sameSite", "lax")}</option><option value="none">${optionLabel("admin.session.sameSite", "none")}</option></select><span class="hint" data-hint-for="admin.session.sameSite">浏览器跨站请求是否携带后台登录 Cookie；不做跨站嵌入时通常保持 lax。</span></label>
<label class="check"><input data-path="admin.session.secure" data-type="boolean" type="checkbox">仅 HTTPS Secure Cookie<span class="hint" data-hint-for="admin.session.secure">HTTPS 部署建议启用；HTTP 本地测试不要启用，否则浏览器不会发送后台登录 Cookie。</span></label>
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
<label>前端站点 Origin<input data-path="site.allowedOrigins" data-type="singleStringArray" autocomplete="url" required><span class="hint" data-hint-for="site.allowedOrigins">填写加载评论组件的前端站点 origin。一个 QingYan 站点只对应一个前端 Origin；若 QingYan 与内容站不是同一域名，请填写 FangYuan / x-item 的真实访问 origin。</span></label>
</fieldset>
<fieldset>
<legend>访客与计数</legend>
<div class="restore-note">可信统计模式：开启访客记录。QingYan 会记录访客 IP、UA 和访问页面，用于可信 PV、点赞、投票和后续访客画像。轻量模式：关闭访客记录。QingYan 不记录访客身份；已开启的计数只做低可信加 1。</div>
<div class="grid">
<label class="check"><input data-path="siteSettings.engagement.visitors.enabled" data-type="boolean" type="checkbox">开启访客记录<span class="hint" data-hint-for="siteSettings.engagement.visitors.enabled">关闭后 QingYan 不写 visitor cookie，不创建访客记录，也不提供访客画像。</span></label>
<label class="check"><input data-path="siteSettings.engagement.pageViews.enabled" data-type="boolean" type="checkbox">启用 PV 统计<span class="hint" data-hint-for="siteSettings.engagement.pageViews.enabled">关闭后不记录 PV；访客记录关闭时只做低可信计数。</span></label>
</div>
<div class="grid">
<label class="check"><input data-path="siteSettings.engagement.pageLikes.enabled" data-type="boolean" type="checkbox">启用页面点赞<span class="hint" data-hint-for="siteSettings.engagement.pageLikes.enabled">访客记录开启时可服务端去重；关闭时只做低可信加 1。</span></label>
<label class="check"><input data-path="siteSettings.engagement.commentVotes.enabled" data-type="boolean" type="checkbox">启用评论投票<span class="hint" data-hint-for="siteSettings.engagement.commentVotes.enabled">访客记录开启时可服务端去重；关闭时只做低可信加 1。</span></label>
</div>
</fieldset>
<fieldset>
<legend>可信评论作者</legend>
<div class="grid">
<label class="check"><input data-path="siteSettings.comments.verifiedAuthor.enabled" data-type="boolean" type="checkbox">启用可信作者<span class="hint" data-hint-for="siteSettings.comments.verifiedAuthor.enabled">后台已登录状态在前台评论区回复时，会使用这组作者资料。</span></label>
<label>显示名称<input data-path="siteSettings.comments.verifiedAuthor.displayName" autocomplete="name" required><span class="hint" data-hint-for="siteSettings.comments.verifiedAuthor.displayName">公开评论区展示的作者名称。</span></label>
</div>
<div class="grid">
<label>邮箱<input data-path="siteSettings.comments.verifiedAuthor.email" type="email" autocomplete="email"><span class="hint" data-hint-for="siteSettings.comments.verifiedAuthor.email">启用可信作者时必须填写；用于外部头像 URL 和保留可信作者邮箱。</span></label>
<label>作者主页 URL<input data-path="siteSettings.comments.verifiedAuthor.website" autocomplete="url"><span class="hint" data-hint-for="siteSettings.comments.verifiedAuthor.website">可选，只作为评论作者链接，不参与后台登录或站点归属判断。</span></label>
</div>
<label>Badge 文案<input data-path="siteSettings.comments.verifiedAuthor.badgeLabel" required><span class="hint" data-hint-for="siteSettings.comments.verifiedAuthor.badgeLabel">例如 管理员、楼主、作者。</span></label>
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
<label>日志级别<select data-path="systemSettings.logging.level"><option value="error">${optionLabel("systemSettings.logging.level", "error")}</option><option value="warn">${optionLabel("systemSettings.logging.level", "warn")}</option><option value="info">${optionLabel("systemSettings.logging.level", "info")}</option><option value="debug">${optionLabel("systemSettings.logging.level", "debug")}</option></select><span class="hint" data-hint-for="systemSettings.logging.level"></span></label>
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
<legend>头像 / 外部头像 URL</legend>
<label class="check"><input data-path="systemSettings.avatar.external.enabled" data-type="boolean" type="checkbox">启用外部头像 URL<span class="hint" data-hint-for="systemSettings.avatar.external.enabled">开启后公开评论作者会返回 author.avatarUrl。</span></label>
<label>头像接口地址<input data-path="systemSettings.avatar.external.baseUrl"><span class="hint" data-hint-for="systemSettings.avatar.external.baseUrl">例如 https://gravatar.com/avatar 或 https://cravatar.cn/avatar。</span></label>
<div class="grid">
<label>邮箱哈希算法<select data-path="systemSettings.avatar.external.hashAlgorithm"><option value="sha256">SHA-256</option><option value="md5">MD5</option></select><span class="hint" data-hint-for="systemSettings.avatar.external.hashAlgorithm">按外部头像服务官方文档选择。</span></label>
<label>头像 URL 参数<input data-path="systemSettings.avatar.external.query" placeholder="s=80&d=404&r=g"><span class="hint" data-hint-for="systemSettings.avatar.external.query">不包含开头的 ?，多个参数用 & 分隔。</span></label>
</div>
<div class="grid">
<label>头像形状<select data-path="systemSettings.avatar.display.shape"><option value="circle">圆形</option><option value="rounded">圆角</option><option value="square">方形</option></select><span class="hint" data-hint-for="systemSettings.avatar.display.shape">前端展示头像容器时使用。</span></label>
<label>显示尺寸<input data-path="systemSettings.avatar.display.sizePx" type="number" min="16" max="256" step="1" data-type="number"><span class="hint" data-hint-for="systemSettings.avatar.display.sizePx">前端建议显示尺寸，范围 16 到 256。</span></label>
</div>
</fieldset>
<fieldset>
<legend>验证码</legend>
<label>验证码服务<select data-path="systemSettings.captcha.provider"><option value="image">${optionLabel("systemSettings.captcha.provider", "image")}</option><option value="turnstile">${optionLabel("systemSettings.captcha.provider", "turnstile")}</option><option value="hcaptcha">${optionLabel("systemSettings.captcha.provider", "hcaptcha")}</option><option value="recaptcha">${optionLabel("systemSettings.captcha.provider", "recaptcha")}</option><option value="geetest">${optionLabel("systemSettings.captcha.provider", "geetest")}</option></select><span class="hint" data-hint-for="systemSettings.captcha.provider">选择后只显示该验证码服务需要填写的配置项。</span></label>
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
<label>reCAPTCHA 验证模式<select data-path="systemSettings.captcha.recaptcha.variant"><option value="score_based">${optionLabel("systemSettings.captcha.recaptcha.variant", "score_based")}</option><option value="policy_based_challenge">${optionLabel("systemSettings.captcha.recaptcha.variant", "policy_based_challenge")}</option></select><span class="hint" data-hint-for="systemSettings.captcha.recaptcha.variant"></span></label>
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
<label>加载方式<select data-path="systemSettings.ipRegion.cachePolicy"><option value="file">${optionLabel("systemSettings.ipRegion.cachePolicy", "file")}</option><option value="vectorIndex">${optionLabel("systemSettings.ipRegion.cachePolicy", "vectorIndex")}</option><option value="content">${optionLabel("systemSettings.ipRegion.cachePolicy", "content")}</option></select><span class="hint" data-hint-for="systemSettings.ipRegion.cachePolicy"></span></label>
<label>地域精度<select data-path="systemSettings.ipRegion.precision"><option value="country">${optionLabel("systemSettings.ipRegion.precision", "country")}</option><option value="province">${optionLabel("systemSettings.ipRegion.precision", "province")}</option><option value="city">${optionLabel("systemSettings.ipRegion.precision", "city")}</option></select><span class="hint" data-hint-for="systemSettings.ipRegion.precision"></span></label>
</div>
<label class="check"><input data-path="systemSettings.ipRegion.autoUpdate.enabled" data-type="boolean" type="checkbox">每月自动更新<span class="hint" data-hint-for="systemSettings.ipRegion.autoUpdate.enabled"></span></label>
<div class="grid">
<label>IPv4 xdb 路径<input data-path="systemSettings.ipRegion.ipv4.dbPath"><span class="hint" data-hint-for="systemSettings.ipRegion.ipv4.dbPath"></span></label>
<label>IPv6 xdb 路径<input data-path="systemSettings.ipRegion.ipv6.dbPath"><span class="hint" data-hint-for="systemSettings.ipRegion.ipv6.dbPath"></span></label>
</div>
<label>IPv4 下载源<textarea data-path="systemSettings.ipRegion.ipv4.sources" data-type="stringArray"></textarea><span class="hint" data-hint-for="systemSettings.ipRegion.ipv4.sources">每行一个 URL，按顺序尝试下载；默认优先 Gitee，失败后回退 GitHub。</span></label>
<label>IPv6 下载源<textarea data-path="systemSettings.ipRegion.ipv6.sources" data-type="stringArray"></textarea><span class="hint" data-hint-for="systemSettings.ipRegion.ipv6.sources">每行一个 URL，按顺序尝试下载；默认优先 Gitee，失败后回退 GitHub。</span></label>
</fieldset>
<fieldset>
<legend>Akismet 反垃圾评论</legend>
<label>Akismet API Key<input data-path="systemSettings.antiSpam.akismet.apiKey" autocomplete="off"><span class="hint" data-hint-for="systemSettings.antiSpam.akismet.apiKey">可选。填写后会写入全局 anti-spam 设置，站点评论审核模式可在安装后后台中选择 Akismet 自动审核或辅助审核。</span></label>
</fieldset>
</section>
<section class="step-panel" data-step="4" hidden>
<fieldset>
<legend>从 QingYan 站点导出 JSON 恢复</legend>
<div class="restore-note">这是可选恢复入口。不选择文件则执行全新安装。选择文件时，浏览器会在本地读取文件内容并生成安装计划。</div>
<label>选择 QingYan JSON 文件<input data-restore-file type="file" accept="application/json,.json"><span class="hint">这里仅接受 qingyan.export.v1 站点级 JSON，用于恢复评论、页面线程、访客和站点设置。整站 qyctl backup 包不能在这里恢复，请使用 qyctl restore。</span></label>
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
const settingLabels = ${JSON.stringify(settingLabels)};
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
const publicBaseUrlField = document.querySelector('[data-path="server.publicBaseUrl"]');
const secureCookieField = document.querySelector('[data-path="admin.session.secure"]');
const allowedOriginsField = document.querySelector('[data-path="site.allowedOrigins"]');
const restoreFileField = document.querySelector("[data-restore-file]");
const envLockByPath = new Map(envLocks.map((lock) => [lock.path, lock]));
let currentStep = 0;
let maxUnlockedStep = 0;
let plannedPayload = null;
let publicBaseUrlTouched = false;
let allowedOriginsTouched = false;
let secureTouched = false;

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
	if (type === "singleStringArray") {
		return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
	}
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
	if (type === "singleStringArray") {
		const value = field.value.trim();
		return value ? [value] : [];
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
function parseProtocol(value) {
	try {
		return new URL(value).protocol;
	} catch (_) {
		return "";
	}
}
function syncSecureCookieDefault() {
	if (!secureCookieField || secureCookieField.disabled || secureTouched) {
		return;
	}
	const protocol = parseProtocol(publicBaseUrlField?.value) || window.location.protocol;
	secureCookieField.checked = protocol === "https:";
}
function applyBrowserDefaults() {
	const browserOrigin = window.location.origin;
	if (publicBaseUrlField && !publicBaseUrlField.disabled && !publicBaseUrlTouched) {
		publicBaseUrlField.value = browserOrigin;
	}
	if (allowedOriginsField && !allowedOriginsField.disabled && !allowedOriginsTouched) {
		allowedOriginsField.value = browserOrigin;
	}
	syncSecureCookieDefault();
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
function formatPathLabel(path) {
	return settingLabels[path] || settingLabels["systemSettings." + path] || path;
}
function setMessage(kind, text) {
	message.dataset.kind = kind;
	message.textContent = text;
}
function optionalString(value) {
	const text = String(value ?? "").trim();
	return text || undefined;
}
async function collectRestore() {
	const file = restoreFileField?.files?.[0];
	if (!file) return undefined;
	let payload;
	try {
		payload = JSON.parse(await file.text());
	} catch (_) {
		throw new Error("无法读取 QingYan JSON 文件，或文件内容不是有效 JSON。");
	}
	return {
		enabled: true,
		fileName: file.name,
		payload,
		existingStrategy: "fail_on_existing",
		importMode: "full_site",
		settingsStrategy: "replace_settings",
	};
}
async function collectPayload() {
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
		siteSettings: raw.siteSettings,
		systemSettings: raw.systemSettings,
		restore: await collectRestore(),
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
		return formatPathLabel(item.path) + ": " + preview + "（" + formatSource(item.source) + env + "）";
	});
	const systemReview = [
		"默认系统设置: " + plan.systemSettingsReview.defaultSeedCount + " 项",
		...plan.systemSettingsReview.environmentSeeds.map((item) =>
			formatPathLabel(item.path) + ": " + (item.secret ? "已配置" : item.valuePreview) + "（" + item.envName + "）"
		),
	];
	const envFields = plan.env.length
		? plan.env.map((item) => item.envName + " -> " + formatPathLabel(item.path) + (item.secret ? "（已隐藏）" : "")).join(", ")
		: "无";
	const verifiedAuthor = plan.siteSettings?.comments?.verifiedAuthor;
	const verifiedAuthorText = verifiedAuthor
		? "<br>可信评论作者: " + (verifiedAuthor.enabled ? "启用" : "关闭") +
			" / " + verifiedAuthor.displayName +
			" / " + verifiedAuthor.email +
			" / " + verifiedAuthor.badgeLabel
		: "";
	const engagement = plan.siteSettings?.engagement;
	const engagementText = engagement
		? "<br>访客记录: " + (engagement.visitors.enabled ? "开启" : "关闭") +
			"<br>PV 统计: " + (engagement.pageViews.enabled ? "开启" : "关闭") +
			"<br>页面点赞: " + (engagement.pageLikes.enabled ? "开启" : "关闭") +
			"<br>评论投票: " + (engagement.commentVotes.enabled ? "开启" : "关闭")
		: "";
const restoreText = plan.restore
		? "<br>恢复来源: " + plan.restore.fileName +
			"<br>恢复格式: QingYan 站点级 JSON" +
			"<br>目标站点: " + plan.restore.siteKey +
			"<br>将创建: 页面线程 " + plan.restore.dryRun.summary.willCreatePageThreads +
			"，访客 " + plan.restore.dryRun.summary.willCreateVisitors +
			"，评论 " + plan.restore.dryRun.summary.willCreateComments +
			"<br>冲突: " + plan.restore.dryRun.summary.conflicts
		: "";
	review.dataset.kind = "success";
	review.innerHTML =
		"<strong>安装计划</strong><br>" +
		"配置文件: " + plan.config.path + "<br>" +
		"数据库: " + plan.database.sqliteFile + "<br>" +
		"后台入口: " + plan.admin.consolePath + "<br>" +
		"管理员: " + plan.admin.username + (plan.admin.passwordGenerated ? "（将随机生成初始密码）" : "") + "<br>" +
		"默认站点: " + plan.site.siteKey + " / " + plan.site.name + "<br>" +
		verifiedAuthorText +
		engagementText +
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
		plannedPayload = await collectPayload();
		const plan = await requestJson("${joinPublicPath(publicPath, INSTALL_PLAN_PATH)}", plannedPayload);
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
		const result = await requestJson("${joinPublicPath(publicPath, INSTALL_PATH)}", plannedPayload);
		const backupText = result.backupPath ? " 原配置备份: " + result.backupPath + "。" : "";
		const restoreText = result.restore ? "恢复站点 " + result.restore.siteKey + "，写入评论 " + result.restore.apply.summary.createdComments + " 条。" : "";
		const transition = result.transition;
		setMessage("success", transition.message + " 管理员 " + result.username + "，初始密码 " + result.initialPassword + "。管理后台: " + transition.adminUrl + "。配置文件: " + result.configPath + "。数据库: " + result.databasePath + "。系统设置写入 " + result.systemSettings.length + " 项。" + restoreText + backupText);
		form.reset();
		plannedPayload = null;
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
publicBaseUrlField?.addEventListener("input", () => {
	publicBaseUrlTouched = true;
	syncSecureCookieDefault();
});
allowedOriginsField?.addEventListener("input", () => {
	allowedOriginsTouched = true;
});
secureCookieField?.addEventListener("change", () => {
	secureTouched = true;
});
applyDefaults();
applyBrowserDefaults();
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
	ipRegionUpdater?: InstallIpRegionUpdater;
	scheduleTransition?: (transition: InstallTransition) => void;
	scheduleRestart?: (transition: InstallTransition) => void;
}): FastifyInstance {
	const publicPath = normalizePublicPath(input.minimalConfig.publicPath);
	const installPath = joinPublicPath(publicPath, INSTALL_PATH);
	const installPlanPath = joinPublicPath(publicPath, INSTALL_PLAN_PATH);
	const adminPath = joinPublicPath(publicPath, "/admin");
	const app = Fastify({
		logger: true,
		disableRequestLogging: true,
	});

	app.setErrorHandler((error, request, reply) => {
		const requestId = request.id;
		if (error instanceof AppError) {
			const response = buildErrorResponse(error, requestId);
			reply.status(response.statusCode).send(response.body);
			return;
		}
		app.log.error({ err: error }, "Unhandled install request error");
		const response = buildErrorResponse(error, requestId);
		reply.status(response.statusCode).send(response.body);
	});

	app.get(adminPath, async (_, reply) => {
		return reply.redirect(installPath);
	});

	app.get(`${adminPath}/`, async (_, reply) => {
		return reply.redirect(installPath);
	});

	app.get(installPath, async (_request, reply) => {
		const blocked = await assertInstallOpen({
			minimalConfig: input.minimalConfig,
			environment: input.environment,
		});
		if (!blocked) {
			return reply.status(410).send({ installed: true });
		}
		return reply
			.header(
				"Set-Cookie",
				createInstallCookie(input.minimalConfig.token, publicPath),
			)
			.type("text/html; charset=utf-8")
			.send(renderInstallHtml(input.minimalConfig, input.environment));
	});

	app.post(installPlanPath, async (request, reply) => {
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

	app.post(installPath, async (request, reply) => {
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
				ipRegionUpdater: input.ipRegionUpdater,
			});
			const transition = buildInstallTransition({
				mode: input.minimalConfig.transitionMode,
				adminUrl: result.adminUrl,
			});
			if (transition.mode !== "manual") {
				(input.scheduleTransition ?? input.scheduleRestart)?.(transition);
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
