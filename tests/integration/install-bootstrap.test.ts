import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app";
import { loadConfig } from "../../src/config/load-config";
import { createDatabaseClients } from "../../src/db/client";
import {
	adminBootstrapState,
	siteSettings,
	sites,
	systemSettings,
} from "../../src/db/schema";
import { buildInstallApp } from "../../src/modules/install/install-app";
import {
	type MinimalInstallConfig,
	resolveMinimalInstallConfig,
} from "../../src/modules/install/minimal-config";
import {
	resolveInstallLockPath,
	resolveInstallState,
} from "../../src/modules/install/state";
import { createTestWorkspace } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

function createWorkspace() {
	const workspace = createTestWorkspace("qingyan-install-");
	const databaseFile = path.join(workspace.directory, "data", "qingyan.db");
	cleanups.push(workspace.cleanup);
	return {
		directory: workspace.directory,
		configPath: workspace.configPath,
		databaseFile,
	};
}

function createMinimalConfig(configPath: string): MinimalInstallConfig {
	return {
		configPath,
		host: "127.0.0.1",
		port: 4401,
		publicPath: "/qingyan",
		token: "install-token",
		disabled: false,
		transitionMode: "manual",
	};
}

function createMinimalConfigWithTransition(
	configPath: string,
	transitionMode: "reload_in_process" | "exit_for_supervisor" | "manual",
): MinimalInstallConfig {
	return {
		...createMinimalConfig(configPath),
		transitionMode,
	};
}

function installPayload(databaseFile: string, token = "install-token") {
	return {
		token,
		server: {
			host: "127.0.0.1",
			port: 4401,
			publicBaseUrl: "http://localhost:4401",
			trustProxy: false,
		},
		database: {
			sqliteFile: databaseFile,
		},
		admin: {
			consolePath: "/admin",
			username: "admin",
			password: "adminadmin",
		},
		site: {
			siteKey: "default",
			name: "Default",
			allowedOrigins: ["http://localhost:4321"],
		},
	};
}

function qingyanRestorePayload() {
	return {
		format: "qingyan.export.v1",
		formatVersion: 2,
		createdAt: "2026-05-05T00:00:00.000Z",
		generator: {
			name: "QingYan",
			version: "0.1.0",
		},
		scope: {
			type: "site",
			siteKey: "fangyuan",
		},
		schema: {
			entitiesVersion: 1,
			sourceDatabase: "sqlite",
			sourceMigrations: [],
		},
		data: {
			site: {
				siteKey: "fangyuan",
				name: "FangYuan",
				allowedOrigins: ["http://localhost:4321"],
			},
			siteSettings: {
				comments_enabled: 0,
				default_status: "approved",
				max_depth: 2,
				root_limit: 10,
				comment_require_json: '["nickname"]',
				allow_website: 0,
				allow_page_like: 0,
				captcha_mode: "never",
				captcha_threshold_window_sec: 60,
				captcha_threshold_max_actions: 3,
				abuse_guard_enabled: 1,
				abuse_guard_window_sec: 600,
				abuse_guard_max_write_actions: 100,
				auto_blacklist_enabled: 1,
				auto_blacklist_scope: "post",
				auto_blacklist_ttl_sec: 1800,
				comment_metadata_json: null,
				email_notifications_enabled: 1,
			},
			systemSettings: [],
			pageThreads: [
				{
					id: "thread_1",
					source: { type: "qingyan", id: "1" },
					siteKey: "fangyuan",
					pageKey: "post/imported",
					pageTitle: "Imported",
					pageUrl: "/post/imported",
					stats: {
						commentCount: 1,
						rootCommentCount: 1,
						pageViewCount: 0,
						pageLikeCount: 0,
					},
					timestamps: {
						createdAt: "2026-05-05T00:00:00.000Z",
						updatedAt: "2026-05-05T00:00:00.000Z",
					},
				},
			],
			visitors: [
				{
					id: "visitor_1",
					source: { type: "qingyan", id: "1" },
					siteKey: "fangyuan",
					visitorKey: "visitor_exported",
					ipHash: "ip_hash",
					userAgentHash: "ua_hash",
					lastIp: "203.0.113.80",
					lastUserAgent: "QingYan Export Browser",
					lastSeenPageKey: "post/imported",
					lastSeenPageUrl: "/post/imported",
					timestamps: {
						createdAt: "2026-05-05T00:00:00.000Z",
						lastSeenAt: "2026-05-05T00:00:00.000Z",
					},
				},
			],
			comments: [
				{
					id: "comment_1",
					source: { type: "qingyan", id: "c_source" },
					siteKey: "fangyuan",
					pageKey: "post/imported",
					parentId: null,
					visitorKey: "visitor_exported",
					status: "approved",
					author: {
						name: "Alice",
						email: "alice@example.com",
						website: "https://example.com",
					},
					request: {
						ip: "127.0.0.1",
						userAgent: "Vitest",
					},
					metadata: {},
					content: {
						raw: "hello from export",
						html: "<p>hello from export</p>",
					},
					stats: {
						replyCount: 0,
						voteUpCount: 0,
						voteDownCount: 0,
					},
					flags: {
						isPinned: false,
						isFolded: false,
					},
					timestamps: {
						createdAt: "2026-05-05T00:00:00.000Z",
						updatedAt: "2026-05-05T00:00:00.000Z",
						deletedAt: null,
					},
					extensions: {},
				},
			],
			voteRecords: [],
			pageFeedbackRecords: [
				{
					id: "feedback_1",
					source: { type: "qingyan", id: "1" },
					siteKey: "fangyuan",
					pageKey: "post/imported",
					visitorKey: "visitor_exported",
					timestamps: {
						createdAt: "2026-05-05T00:00:00.000Z",
					},
				},
			],
			blacklistRules: [
				{
					id: "blacklist_1",
					source: { type: "qingyan", id: "1" },
					siteKey: "fangyuan",
					scope: "site",
					targetType: "email",
					targetValue: "blocked@example.com",
					matchMode: "exact",
					reason: "imported",
					sourceName: "manual",
					expiresAt: null,
					createdAt: "2026-05-05T00:00:00.000Z",
				},
			],
		},
	};
}

function installRestorePayload(databaseFile: string) {
	return {
		...installFormPayload(databaseFile),
		admin: {
			consolePath: "/admin",
			username: "installer",
			password: "installer-password",
		},
		restore: {
			enabled: true,
			fileName: "fangyuan-export.json",
			payload: qingyanRestorePayload(),
			existingStrategy: "fail_on_existing",
			importMode: "full_site",
			settingsStrategy: "replace_settings",
		},
	};
}

function installFormPayload(databaseFile: string) {
	const payload = installPayload(databaseFile);
	return {
		server: payload.server,
		database: payload.database,
		admin: payload.admin,
		site: payload.site,
	};
}

function installVerifiedAuthorPayload(databaseFile: string) {
	return {
		...installFormPayload(databaseFile),
		siteSettings: {
			comments: {
				verifiedAuthor: {
					enabled: true,
					displayName: "Virace",
					email: "Owner@Example.COM",
					website: "https://fangyuan.example.com/about",
					badgeLabel: "楼主",
				},
			},
		},
	};
}

async function getInstallCookie(app: ReturnType<typeof buildInstallApp>) {
	const installPage = await app.inject({
		method: "GET",
		url: "/qingyan/admin/install",
	});
	return installPage.cookies.find(
		(cookie) => cookie.name === "qingyan_install",
	);
}

function installGeneratedAdminPayload(databaseFile: string) {
	const payload = installFormPayload(databaseFile);
	return {
		...payload,
		admin: {},
	};
}

function installCompleteConfigPayload(databaseFile: string) {
	return {
		...installFormPayload(databaseFile),
		admin: {
			consolePath: "/admin",
			username: "admin",
			password: "adminadmin",
			session: {
				cookieName: "custom_admin",
				ttlMinutes: 30,
				sameSite: "strict",
				secure: true,
			},
		},
		security: {
			requestIdHeader: "x-qy-request-id",
			globalFloodGuard: {
				enabled: true,
				windowSec: 20,
				maxRequests: 240,
			},
			publicOriginGuard: {
				enabled: true,
				allowMissingOrigin: true,
			},
			rateLimit: {
				adminLogin: {
					windowSec: 500,
					maxFailures: 4,
				},
				commentCreate: {
					windowSec: 200,
					maxRequests: 7,
				},
				commentVote: {
					windowSec: 201,
					maxRequests: 17,
				},
				captchaVerify: {
					windowSec: 202,
					maxFailures: 9,
				},
				pageLike: {
					windowSec: 203,
					maxRequests: 12,
				},
			},
		},
		systemSettings: {
			logging: {
				level: "debug",
				retentionDays: 30,
			},
			mail: {
				enabled: true,
				smtp: {
					host: "smtp.example.test",
					port: 587,
					secure: false,
					username: "noreply",
					password: "smtp-password",
					from: "noreply@example.test",
				},
			},
			captcha: {
				provider: "turnstile",
				turnstile: {
					siteKey: "turnstile-site-key",
					secretKey: "turnstile-secret",
					expectedAction: "comment",
					expectedHostname: "comments.example.test",
				},
				recaptcha: {
					minScore: 0.7,
				},
			},
			ipRegion: {
				enabled: true,
				precision: "city",
				autoUpdate: {
					enabled: true,
				},
				ipv4: {
					dbPath: "./data/custom-v4.xdb",
				},
				ipv6: {
					dbPath: "./data/custom-v6.xdb",
				},
			},
			avatar: {
				external: {
					enabled: true,
					baseUrl: "https://cravatar.cn/avatar/",
					hashAlgorithm: "md5",
					query: "s=160&d=identicon",
				},
				display: {
					shape: "rounded",
					sizePx: 48,
				},
			},
		},
	};
}

describe("install bootstrap", () => {
	it("serves install page when config is missing", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const response = await app.inject({
			method: "GET",
			url: "/qingyan/admin/install",
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("QingYan Install");
		expect(response.body).toContain("生成安装计划");
		expect(response.body).toContain("确认安装");
		expect(response.body).not.toContain("正在切换到正常服务并进入管理后台");
		expect(response.body).not.toContain("正在等待守护进程重新拉起 QingYan");
		expect(response.body).not.toContain("waitForAdmin");
		expect(response.body).not.toContain('mode: "no-cors"');
		expect(response.body).not.toContain("window.location.href");
		expect(response.body).toContain("服务与数据库");
		expect(response.body).toContain("管理员与会话");
		expect(response.body).toContain("站点与安全");
		expect(response.body).toContain("恢复与确认");
		expect(response.body).toContain("后台入口");
		expect(response.body).toContain("系统设置");
		expect(response.body).toContain("从 QingYan 站点导出 JSON 恢复");
		expect(response.body).toContain(
			"填写用户实际访问 QingYan 的域名或 IP origin",
		);
		expect(response.body).toContain("修改后必须同步修改反向代理");
		expect(response.body).toContain("HTTPS 部署建议启用");
		expect(response.body).toContain("填写加载评论组件的前端站点 origin");
		expect(response.body).toContain("一个 QingYan 站点只对应一个前端 Origin");
		expect(response.body).toContain('data-type="singleStringArray"');
		expect(response.body).not.toContain("可填多个，每行一个");
		expect(response.body).toContain("选择 QingYan JSON 文件");
		expect(response.body).toContain("不选择文件则执行全新安装");
		expect(response.body).toContain("浏览器会在本地读取文件内容");
		expect(response.body).toContain("data-restore-file");
		expect(response.body).toContain("整站 qyctl backup 包不能在这里恢复");
		expect(response.body).not.toContain("导出文件名");
		expect(response.body).not.toContain("粘贴 QingYan 导出 JSON");
		expect(response.body).not.toContain('data-path="restore.fileName"');
		expect(response.body).not.toContain('data-path="restore.payload"');
		expect(response.body).toContain("window.location.origin");
		expect(response.body).toContain("secureTouched");
		expect(response.body).toContain("file.text()");
		expect(response.body).toContain("来自环境变量");
		expect(response.body).toContain("data-step");
		expect(response.body).toContain("target > maxUnlockedStep");
		expect(response.body).toContain("validateStep(currentStep)");
		expect(response.body).toContain('data-path="admin.session.cookieName"');
		expect(response.body).toContain("浏览器跨站请求是否携带后台登录 Cookie");
		expect(response.body).toContain("常规站点访问");
		expect(response.body).toContain("仅错误");
		expect(response.body).toContain("分数判断");
		expect(response.body).toContain("向量索引缓存");
		expect(response.body).not.toContain(">score_based</option>");
		expect(response.body).not.toContain(">vectorIndex</option>");
		expect(response.body).toContain("请求洪泛防护");
		expect(response.body).toContain("启用公开 Origin guard");
		expect(response.body).toContain(
			'data-path="security.rateLimit.commentCreate.maxRequests"',
		);
		expect(response.body).toContain(
			'data-path="systemSettings.captcha.turnstile.siteKey"',
		);
		expect(response.body).toContain(
			'data-path="systemSettings.avatar.external.enabled"',
		);
		expect(response.body).toContain(
			'data-path="systemSettings.avatar.external.baseUrl"',
		);
		expect(response.body).toContain(
			'data-path="systemSettings.avatar.external.hashAlgorithm"',
		);
		expect(response.body).toContain(
			'data-path="systemSettings.avatar.external.query"',
		);
		expect(response.body).toContain(
			'data-path="systemSettings.avatar.display.shape"',
		);
		expect(response.body).toContain(
			'data-path="systemSettings.avatar.display.sizePx"',
		);
		expect(response.body).toContain("头像接口地址");
		expect(response.body).toContain("邮箱哈希算法");
		expect(response.body).toContain("头像 URL 参数");
		expect(response.body).toContain("Akismet");
		expect(response.body).toContain(
			'<label>Akismet API Key<input data-path="systemSettings.antiSpam.akismet.apiKey" autocomplete="off">',
		);
		expect(response.body).toContain('data-captcha-panel="image"');
		expect(response.body).toContain('data-captcha-panel="turnstile" hidden');
		expect(response.body).toContain("updateCaptchaPanel()");
		expect(response.body).toContain('type="number" min="1" step="1"');
		expect(response.body).toContain('min="0" max="1" step="0.01"');
		expect(response.body).not.toContain("从导出包恢复");
		expect(response.body).not.toContain("Use <code>POST");
		expect(response.body).not.toContain("install-token");
	});

	it("renders env-managed install fields as locked wizard metadata", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
			environment: {
				QINGYAN_SERVER_HOST: "0.0.0.0",
				QINGYAN_SMTP_PASSWORD: "super-secret-password",
			},
		});
		cleanups.push(() => app.close());

		const response = await app.inject({
			method: "GET",
			url: "/qingyan/admin/install",
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("QINGYAN_SERVER_HOST");
		expect(response.body).toContain("QINGYAN_SMTP_PASSWORD");
		expect(response.body).toContain('"path":"server.host"');
		expect(response.body).toContain(
			'"path":"systemSettings.mail.smtp.password"',
		);
		expect(response.body).toContain(
			'"systemSettings.mail.smtp.password":"SMTP 密码"',
		);
		expect(response.body).not.toContain("super-secret-password");
	});

	it("redirects the default admin UI entry to install before bootstrap", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const admin = await app.inject({
			method: "GET",
			url: "/qingyan/admin",
		});
		expect(admin.statusCode).toBe(302);
		expect(admin.headers.location).toBe("/qingyan/admin/install");

		const adminSlash = await app.inject({
			method: "GET",
			url: "/qingyan/admin/",
		});
		expect(adminSlash.statusCode).toBe(302);
		expect(adminSlash.headers.location).toBe("/qingyan/admin/install");
	});

	it("exposes only the install mini-app route set before bootstrap", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const allowed = [
			["GET", "/qingyan/admin"],
			["GET", "/qingyan/admin/"],
			["GET", "/qingyan/admin/install"],
			["POST", "/qingyan/admin/install/plan"],
			["POST", "/qingyan/admin/install"],
		] as const;

		for (const [method, url] of allowed) {
			const response = await app.inject({
				method,
				url,
				payload:
					method === "POST"
						? installFormPayload(workspace.databaseFile)
						: undefined,
			});
			expect([200, 302, 403]).toContain(response.statusCode);
		}

		const blocked = [
			["GET", "/install"],
			["GET", "/qingyan/api/install/state"],
			["GET", "/qingyan/api/admin/install/state"],
			["GET", "/qingyan/api/admin/session/me"],
			["GET", "/qingyan/api/comments/bootstrap?siteKey=default&pageKey=home"],
		] as const;

		for (const [method, url] of blocked) {
			const response = await app.inject({ method, url });
			expect(response.statusCode).toBe(404);
		}
	});

	it("builds an install plan without writing config or database", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const installPage = await app.inject({
			method: "GET",
			url: "/qingyan/admin/install",
		});
		const installCookie = installPage.cookies.find(
			(cookie) => cookie.name === "qingyan_install",
		);

		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			config: {
				path: workspace.configPath,
				writes: expect.arrayContaining(["server", "database"]),
			},
			database: {
				sqliteFile: workspace.databaseFile,
				seeds: expect.arrayContaining(["site_settings", "system_settings"]),
			},
			admin: {
				consolePath: "/admin",
				username: "admin",
				passwordGenerated: false,
			},
			systemSettings: expect.arrayContaining([
				expect.objectContaining({ category: "logging", key: "level" }),
				expect.objectContaining({
					category: "captcha",
					key: "image.ttlSec",
					source: "default",
					valuePreview: 600,
				}),
				expect.objectContaining({ category: "mail", key: "enabled" }),
				expect.objectContaining({ category: "ipRegion", key: "enabled" }),
			]),
			systemSettingsReview: {
				defaultSeedCount: expect.any(Number),
				environmentSeeds: [],
			},
		});
		expect(response.json().systemSettingsReview.defaultSeedCount).toBe(
			response.json().systemSettings.length,
		);
		expect(existsSync(workspace.configPath)).toBe(false);
		expect(existsSync(workspace.databaseFile)).toBe(false);
	});

	it("plans default site verified author settings during install", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installVerifiedAuthorPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			siteSettings: {
				comments: {
					verifiedAuthor: {
						enabled: true,
						displayName: "Virace",
						email: "owner@example.com",
						website: "https://fangyuan.example.com/about",
						badgeLabel: "楼主",
					},
				},
			},
			applyPayload: {
				siteSettings: {
					comments: {
						verifiedAuthor: {
							email: "owner@example.com",
						},
					},
				},
			},
		});
		expect(existsSync(workspace.configPath)).toBe(false);
		expect(existsSync(workspace.databaseFile)).toBe(false);
	});

	it("rejects install when enabled verified author has no email", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const payload = installVerifiedAuthorPayload(workspace.databaseFile);
		payload.siteSettings.comments.verifiedAuthor.email = "";
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload,
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "INVALID_REQUEST",
			},
		});
	});

	it("plans install restore without writing config or database", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installRestorePayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			site: {
				siteKey: "fangyuan",
				name: "FangYuan",
			},
			restore: {
				enabled: true,
				fileName: "fangyuan-export.json",
				siteKey: "fangyuan",
				importMode: "full_site",
				settingsStrategy: "replace_settings",
				dryRun: {
					summary: {
						willCreatePageThreads: 1,
						willCreateVisitors: 1,
						willCreateComments: 1,
						conflicts: 0,
					},
					settings: {
						status: "replace",
					},
				},
			},
		});
		expect(response.json().applyPayload.restore.payload).toMatchObject({
			format: "qingyan.export.v1",
			scope: {
				siteKey: "fangyuan",
			},
		});
		expect(existsSync(workspace.configPath)).toBe(false);
		expect(existsSync(workspace.databaseFile)).toBe(false);
	});

	it("plans and applies complete startup and system settings config", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const ipRegionUpdates: Array<{ ipVersion: "v4" | "v6" }> = [];
		const app = buildInstallApp({
			minimalConfig,
			ipRegionUpdater: {
				update: async (input) => {
					ipRegionUpdates.push({ ipVersion: input.ipVersion });
					return {
						status: "success",
						sourceUrl: `https://example.com/${input.ipVersion}.xdb`,
						nextHash: `${input.ipVersion}-hash`,
						refreshedComments: 0,
					};
				},
			},
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const payload = installCompleteConfigPayload(workspace.databaseFile);
		const planResponse = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload,
		});

		expect(planResponse.statusCode).toBe(200);
		expect(planResponse.json()).toMatchObject({
			systemSettings: expect.arrayContaining([
				expect.objectContaining({
					category: "admin",
					key: "session.ttlMinutes",
					valuePreview: 30,
				}),
				expect.objectContaining({
					category: "logging",
					key: "level",
					valuePreview: "debug",
				}),
				expect.objectContaining({
					category: "mail",
					key: "smtp.host",
					valuePreview: "smtp.example.test",
				}),
				expect.objectContaining({
					category: "captcha",
					key: "provider",
					valuePreview: "turnstile",
				}),
				expect.objectContaining({
					category: "captcha",
					key: "turnstile.secretKey",
					secret: true,
					valuePreview: "configured",
				}),
				expect.objectContaining({
					category: "ipRegion",
					key: "precision",
					valuePreview: "city",
				}),
			]),
		});
		expect(planResponse.json().applyPayload.admin.session).toMatchObject({
			cookieName: "custom_admin",
			ttlMinutes: 30,
			sameSite: "strict",
			secure: true,
		});
		expect(planResponse.json().applyPayload.security).toMatchObject({
			requestIdHeader: "x-qy-request-id",
			rateLimit: {
				commentCreate: {
					maxRequests: 7,
				},
			},
		});
		const apply = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: planResponse.json().applyPayload,
		});

		expect(apply.statusCode).toBe(201);
		expect(apply.json().ipRegionBootstrap).toEqual([
			expect.objectContaining({
				ipVersion: "v4",
				status: "success",
				nextHash: "v4-hash",
			}),
			expect.objectContaining({
				ipVersion: "v6",
				status: "success",
				nextHash: "v6-hash",
			}),
		]);
		expect(ipRegionUpdates).toEqual([{ ipVersion: "v4" }, { ipVersion: "v6" }]);
		expect(apply.body).not.toContain("smtp-password");
		expect(apply.body).not.toContain("turnstile-secret");

		const config = await loadConfig(workspace.configPath, {});
		expect(config.admin.session).toMatchObject({
			cookieName: "custom_admin",
			ttlMinutes: 4320,
			sameSite: "strict",
			secure: true,
		});
		expect(config.security).toMatchObject({
			requestIdHeader: "x-qy-request-id",
			publicOriginGuard: {
				enabled: true,
				allowMissingOrigin: true,
			},
			rateLimit: {
				commentCreate: {
					windowSec: 200,
					maxRequests: 7,
				},
				pageLike: {
					windowSec: 203,
					maxRequests: 12,
				},
			},
		});

		const { db, sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const rows = await db.select().from(systemSettings);
			expect(rows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						category: "admin",
						key: "session.ttlMinutes",
						valueJson: "30",
					}),
					expect.objectContaining({
						category: "logging",
						key: "level",
						valueJson: '"debug"',
					}),
					expect.objectContaining({
						category: "mail",
						key: "smtp.host",
						valueJson: '"smtp.example.test"',
					}),
					expect.objectContaining({
						category: "mail",
						key: "smtp.password",
						valueJson: '"smtp-password"',
					}),
					expect.objectContaining({
						category: "captcha",
						key: "provider",
						valueJson: '"turnstile"',
					}),
					expect.objectContaining({
						category: "captcha",
						key: "turnstile.secretKey",
						valueJson: '"turnstile-secret"',
					}),
					expect.objectContaining({
						category: "ipRegion",
						key: "precision",
						valueJson: '"city"',
					}),
					expect.objectContaining({
						category: "avatar",
						key: "external.enabled",
						valueJson: "true",
					}),
					expect.objectContaining({
						category: "avatar",
						key: "external.baseUrl",
						valueJson: JSON.stringify("https://cravatar.cn/avatar"),
					}),
					expect.objectContaining({
						category: "avatar",
						key: "external.hashAlgorithm",
						valueJson: JSON.stringify("md5"),
					}),
					expect.objectContaining({
						category: "avatar",
						key: "external.query",
						valueJson: JSON.stringify("s=160&d=identicon"),
					}),
				]),
			);
		} finally {
			sqlite.close();
		}
	});

	it("returns manual transition without scheduling automatic work", async () => {
		const workspace = createWorkspace();
		const scheduled: unknown[] = [];
		const app = buildInstallApp({
			minimalConfig: createMinimalConfigWithTransition(
				workspace.configPath,
				"manual",
			),
			scheduleTransition: (transition) => scheduled.push(transition),
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().transition).toMatchObject({
			mode: "manual",
			restartRequired: true,
		});
		expect(scheduled).toEqual([]);
	});

	it("schedules supervisor exit transition after install", async () => {
		const workspace = createWorkspace();
		const scheduled: unknown[] = [];
		const app = buildInstallApp({
			minimalConfig: createMinimalConfigWithTransition(
				workspace.configPath,
				"exit_for_supervisor",
			),
			scheduleTransition: (transition) => scheduled.push(transition),
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().transition.mode).toBe("exit_for_supervisor");
		expect(scheduled).toHaveLength(1);
	});

	it("schedules in-process reload transition after install", async () => {
		const workspace = createWorkspace();
		const scheduled: unknown[] = [];
		const app = buildInstallApp({
			minimalConfig: createMinimalConfigWithTransition(
				workspace.configPath,
				"reload_in_process",
			),
			scheduleTransition: (transition) => scheduled.push(transition),
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().transition.mode).toBe("reload_in_process");
		expect(scheduled).toHaveLength(1);
	});

	it("reports env-managed fields in the install plan without leaking secret values", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
			environment: {
				QINGYAN_SERVER_HOST: "0.0.0.0",
				QINGYAN_SMTP_PASSWORD: "super-secret-password",
			},
		});
		cleanups.push(() => app.close());

		const installPage = await app.inject({
			method: "GET",
			url: "/qingyan/admin/install",
		});
		const installCookie = installPage.cookies.find(
			(cookie) => cookie.name === "qingyan_install",
		);

		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			env: expect.arrayContaining([
				{
					path: "server.host",
					envName: "QINGYAN_SERVER_HOST",
					locked: true,
					secret: false,
					source: "env",
					valuePreview: "0.0.0.0",
				},
				{
					path: "mail.smtp.password",
					envName: "QINGYAN_SMTP_PASSWORD",
					locked: true,
					secret: true,
					source: "env",
					valuePreview: "configured",
				},
			]),
			systemSettings: expect.arrayContaining([
				expect.objectContaining({
					category: "mail",
					key: "smtp.password",
					source: "environment",
					envName: "QINGYAN_SMTP_PASSWORD",
					secret: true,
					valuePreview: "configured",
				}),
			]),
			systemSettingsReview: {
				environmentSeeds: [
					expect.objectContaining({
						path: "mail.smtp.password",
						envName: "QINGYAN_SMTP_PASSWORD",
						secret: true,
						valuePreview: "configured",
					}),
				],
			},
		});
		expect(response.json().systemSettingsReview.defaultSeedCount).toBe(
			response.json().systemSettings.length - 1,
		);
		expect(response.body).not.toContain("super-secret-password");
	});

	it("applies startup env overrides consistently between plan and install", async () => {
		const workspace = createWorkspace();
		const envDatabaseFile = path.join(workspace.directory, "env", "qingyan.db");
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
			environment: {
				QINGYAN_SERVER_HOST: "0.0.0.0",
				QINGYAN_SERVER_PORT: "5502",
				QINGYAN_PUBLIC_BASE_URL: "https://comments.example.test",
				QINGYAN_TRUST_PROXY: "true",
				QINGYAN_SQLITE_FILE: envDatabaseFile,
				QINGYAN_ADMIN_SESSION_COOKIE_NAME: "qy_admin",
				QINGYAN_ADMIN_SESSION_TTL_MINUTES: "60",
				QINGYAN_ADMIN_SESSION_SAME_SITE: "strict",
				QINGYAN_ADMIN_SESSION_SECURE: "true",
			},
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(200);
		const plan = response.json();
		expect(plan.database.sqliteFile).toBe(envDatabaseFile);
		expect(plan.env).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "server.host",
					envName: "QINGYAN_SERVER_HOST",
					valuePreview: "0.0.0.0",
				}),
				expect.objectContaining({
					path: "database.sqlite.file",
					envName: "QINGYAN_SQLITE_FILE",
					valuePreview: envDatabaseFile,
				}),
				expect.objectContaining({
					path: "admin.session.cookieName",
					envName: "QINGYAN_ADMIN_SESSION_COOKIE_NAME",
					valuePreview: "qy_admin",
				}),
				expect.objectContaining({
					path: "admin.session.ttlMinutes",
					envName: "QINGYAN_ADMIN_SESSION_TTL_MINUTES",
					valuePreview: 60,
				}),
			]),
		);

		const apply = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: plan.applyPayload,
		});

		expect(apply.statusCode).toBe(201);
		expect(apply.json()).toMatchObject({
			adminUrl: "https://comments.example.test/qingyan/admin",
			databasePath: path.resolve(process.cwd(), envDatabaseFile),
		});
		const config = await loadConfig(workspace.configPath, {});
		expect(config.server).toMatchObject({
			host: "0.0.0.0",
			port: 5502,
			publicBaseUrl: "https://comments.example.test",
			trustProxy: true,
		});
		expect(config.database.sqlite.file).toBe(envDatabaseFile);
		expect(config.admin.session).toMatchObject({
			cookieName: "qy_admin",
			ttlMinutes: 4320,
			sameSite: "strict",
			secure: true,
		});
		const { db, sqlite } = createDatabaseClients(envDatabaseFile);
		try {
			const rows = await db.select().from(systemSettings);
			expect(rows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						category: "admin",
						key: "session.ttlMinutes",
						valueJson: "60",
					}),
				]),
			);
		} finally {
			sqlite.close();
		}
		expect(existsSync(envDatabaseFile)).toBe(true);
	});

	it("rejects missing or invalid install tokens", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const state = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			payload: installFormPayload(workspace.databaseFile),
		});
		expect(state.statusCode).toBe(403);
		expect(state.json()).toMatchObject({
			error: {
				code: "INSTALL_TOKEN_INVALID",
			},
		});

		const apply = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			payload: installPayload(workspace.databaseFile, "bad-token"),
		});
		expect(apply.statusCode).toBe(403);
		expect(apply.json()).toMatchObject({
			error: {
				code: "INSTALL_TOKEN_INVALID",
			},
		});
	});

	it("writes startup config and seeds the SQLite database", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		expect(installCookie?.httpOnly).toBe(true);

		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			adminUrl: "http://localhost:4401/qingyan/admin",
			username: "admin",
			initialPassword: "adminadmin",
			configPath: workspace.configPath,
			databasePath: path.resolve(process.cwd(), workspace.databaseFile),
			lockPath: resolveInstallLockPath(workspace.configPath),
			transition: {
				mode: "manual",
				adminUrl: "http://localhost:4401/qingyan/admin",
				pollUrl: "http://localhost:4401/qingyan/admin",
				restartRequired: true,
			},
			systemSettings: expect.arrayContaining([
				expect.objectContaining({ category: "logging", key: "level" }),
				expect.objectContaining({ category: "captcha", key: "provider" }),
				expect.objectContaining({
					category: "captcha",
					key: "image.ttlSec",
					valuePreview: 600,
				}),
			]),
			restartRequired: true,
		});

		const config = await loadConfig(workspace.configPath, {});
		expect(config.database.sqlite.file).toBe(workspace.databaseFile);
		expect(config.server.publicBaseUrl).toBe("http://localhost:4401");
		const lockPath = resolveInstallLockPath(workspace.configPath);
		expect(existsSync(lockPath)).toBe(true);
		expect(JSON.parse(await readFile(lockPath, "utf-8"))).toMatchObject({
			configPath: workspace.configPath,
			databasePath: path.resolve(process.cwd(), workspace.databaseFile),
			adminConsolePath: "/admin",
		});

		const { db, sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const [bootstrap] = await db.select().from(adminBootstrapState);
			expect(bootstrap).toMatchObject({
				consolePath: "/admin",
				username: "admin",
			});
			const [site] = await db
				.select()
				.from(sites)
				.where(eq(sites.siteKey, "default"));
			expect(site).toMatchObject({
				name: "Default",
			});
			const [settings] = await db
				.select()
				.from(siteSettings)
				.where(eq(siteSettings.siteId, site?.id ?? 0));
			expect(settings).toMatchObject({
				commentsEnabled: true,
				rootLimit: 20,
			});
			const systemSettingRows = await db.select().from(systemSettings);
			expect(systemSettingRows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						category: "logging",
						key: "level",
						valueJson: '"info"',
					}),
					expect.objectContaining({
						category: "logging",
						key: "retentionDays",
						valueJson: "7",
					}),
					expect.objectContaining({ category: "captcha", key: "provider" }),
					expect.objectContaining({
						category: "captcha",
						key: "image.ttlSec",
					}),
					expect.objectContaining({ category: "mail", key: "enabled" }),
					expect.objectContaining({ category: "ipRegion", key: "enabled" }),
				]),
			);
		} finally {
			sqlite.close();
		}
	});

	it("seeds verified author settings from install payload", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installVerifiedAuthorPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);

		const { db, sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const [site] = await db
				.select()
				.from(sites)
				.where(eq(sites.siteKey, "default"));
			const [settings] = await db
				.select()
				.from(siteSettings)
				.where(eq(siteSettings.siteId, site?.id ?? 0));
			expect(JSON.parse(settings?.verifiedAuthorJson ?? "{}")).toMatchObject({
				enabled: true,
				displayName: "Virace",
				email: "owner@example.com",
				website: "https://fangyuan.example.com/about",
				badgeLabel: "楼主",
			});
		} finally {
			sqlite.close();
		}
	});

	it("serves only the installed custom admin path after normal startup", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const installApp = buildInstallApp({ minimalConfig });
		cleanups.unshift(() => installApp.close());

		const installCookie = await getInstallCookie(installApp);
		const payload = installFormPayload(workspace.databaseFile);
		payload.admin.consolePath = "/hidden-admin";
		const response = await installApp.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload,
		});
		expect(response.statusCode).toBe(201);
		expect(response.json().adminUrl).toBe(
			"http://localhost:4401/qingyan/hidden-admin",
		);
		await installApp.close();

		const app = await buildApp(await loadConfig(workspace.configPath, {}));
		cleanups.unshift(() => app.close());

		expect(app.adminBootstrap.consolePath).toBe("/hidden-admin");
		const configuredRoute = await app.inject({
			method: "GET",
			url: "/qingyan/hidden-admin/",
		});
		const defaultRoute = await app.inject({
			method: "GET",
			url: "/qingyan/admin/",
		});

		expect(configuredRoute.statusCode).toBe(200);
		expect(configuredRoute.body).toContain("QingYan Admin");
		expect(defaultRoute.statusCode).toBe(404);
	});

	it("applies install restore while keeping admin bootstrap local to this install", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const plan = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installRestorePayload(workspace.databaseFile),
		});
		expect(plan.statusCode).toBe(200);

		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: plan.json().applyPayload,
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			username: "installer",
			initialPassword: "installer-password",
			restore: {
				enabled: true,
				siteKey: "fangyuan",
				apply: {
					summary: {
						createdPageThreads: 1,
						createdVisitors: 1,
						createdComments: 1,
						createdPageFeedbackRecords: 1,
						createdBlacklistRules: 1,
						settingsUpdated: true,
					},
				},
			},
		});

		const { sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const admin = sqlite
				.prepare("SELECT console_path, username FROM admin_bootstrap_state")
				.get() as { console_path: string; username: string };
			expect(admin).toMatchObject({
				console_path: "/admin",
				username: "installer",
			});
			const site = sqlite
				.prepare("SELECT id, site_key, name, allowed_origins_json FROM sites")
				.get() as {
				id: number;
				site_key: string;
				name: string;
				allowed_origins_json: string;
			};
			expect(site).toMatchObject({
				site_key: "fangyuan",
				name: "FangYuan",
			});
			expect(JSON.parse(site.allowed_origins_json)).toEqual([
				"http://localhost:4321",
			]);
			const settings = sqlite
				.prepare(
					"SELECT comments_enabled, default_status, root_limit FROM site_settings WHERE site_id = ?",
				)
				.get(site.id) as {
				comments_enabled: number;
				default_status: string;
				root_limit: number;
			};
			expect(settings).toMatchObject({
				comments_enabled: 0,
				default_status: "approved",
				root_limit: 10,
			});
			const comment = sqlite
				.prepare(
					`SELECT comments.author_name, comments.content_raw, page_threads.page_key
					FROM comments
					INNER JOIN page_threads ON page_threads.id = comments.page_thread_id`,
				)
				.get() as {
				author_name: string;
				content_raw: string;
				page_key: string;
			};
			expect(comment).toMatchObject({
				author_name: "Alice",
				content_raw: "hello from export",
				page_key: "post/imported",
			});
			expect(
				(
					sqlite
						.prepare("SELECT COUNT(*) AS count FROM page_feedback_records")
						.get() as { count: number }
				).count,
			).toBe(1);
			expect(
				(
					sqlite
						.prepare("SELECT COUNT(*) AS count FROM blacklist_rules")
						.get() as { count: number }
				).count,
			).toBe(1);
		} finally {
			sqlite.close();
		}
	});

	it("stores env-backed system setting secrets without leaking them in responses", async () => {
		const workspace = createWorkspace();
		const smtpSecret = "install-test-smtp-secret";
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
			environment: {
				QINGYAN_SMTP_PASSWORD: smtpSecret,
				QINGYAN_TURNSTILE_SECRET_KEY: "turnstile-test-secret",
			},
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const plan = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(plan.statusCode).toBe(200);
		expect(plan.body).toContain("QINGYAN_SMTP_PASSWORD");
		expect(plan.body).toContain("configured");
		expect(plan.body).not.toContain(smtpSecret);

		const apply = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: plan.json().applyPayload,
		});

		expect(apply.statusCode).toBe(201);
		expect(apply.body).not.toContain(smtpSecret);
		expect(apply.json()).toMatchObject({
			systemSettings: expect.arrayContaining([
				expect.objectContaining({
					category: "mail",
					key: "smtp.password",
					source: "environment",
					envName: "QINGYAN_SMTP_PASSWORD",
					secret: true,
					valuePreview: "configured",
				}),
				expect.objectContaining({
					category: "captcha",
					key: "turnstile.secretKey",
					source: "environment",
					envName: "QINGYAN_TURNSTILE_SECRET_KEY",
					secret: true,
					valuePreview: "configured",
				}),
			]),
		});

		const { db, sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const rows = await db.select().from(systemSettings);
			expect(rows).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						category: "mail",
						key: "smtp.password",
						valueJson: JSON.stringify(smtpSecret),
					}),
					expect.objectContaining({
						category: "captcha",
						key: "turnstile.secretKey",
						valueJson: JSON.stringify("turnstile-test-secret"),
					}),
				]),
			);
		} finally {
			sqlite.close();
		}
	});

	it("generates admin console path and password when omitted", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: "install-token",
			},
			payload: installGeneratedAdminPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		const result = response.json();
		expect(result.adminUrl).toMatch(
			/^http:\/\/localhost:4401\/qingyan\/qy-[A-Za-z0-9]{12}$/,
		);
		expect(result.username).toBe("admin");
		expect(result.initialPassword.length).toBeGreaterThanOrEqual(18);

		const { db, sqlite } = createDatabaseClients(workspace.databaseFile);
		try {
			const [bootstrap] = await db.select().from(adminBootstrapState);
			expect(bootstrap?.consolePath).toMatch(/^\/qy-[A-Za-z0-9]{12}$/);
			expect(bootstrap?.username).toBe("admin");
		} finally {
			sqlite.close();
		}
	});

	it("uses the generated plan payload for the final install apply", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const plan = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installGeneratedAdminPayload(workspace.databaseFile),
		});

		expect(plan.statusCode).toBe(200);
		const applyPayload = plan.json().applyPayload;
		expect(applyPayload.admin.consolePath).toMatch(/^\/qy-[A-Za-z0-9]{12}$/);
		expect(applyPayload.admin.username).toBe("admin");
		expect(applyPayload.admin.password).toBeUndefined();

		const apply = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: applyPayload,
		});

		expect(apply.statusCode).toBe(201);
		expect(apply.json().username).toBe("admin");
		expect(apply.json().initialPassword.length).toBeGreaterThanOrEqual(18);
		expect(apply.json().adminUrl).toBe(
			`http://localhost:4401/qingyan${applyPayload.admin.consolePath}`,
		);
	});

	it("backs up an invalid existing config before replacing it", async () => {
		const workspace = createWorkspace();
		const previousContent = "server: [invalid";
		mkdirSync(path.dirname(workspace.configPath), { recursive: true });
		writeFileSync(workspace.configPath, previousContent, "utf-8");
		const minimalConfig = createMinimalConfig(workspace.configPath);
		await expect(resolveInstallState(minimalConfig, {})).resolves.toMatchObject(
			{
				installed: false,
				reason: "config_invalid",
			},
		);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		const apply = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			payload: installPayload(workspace.databaseFile),
		});

		expect(apply.statusCode).toBe(201);
		const result = apply.json();
		expect(result.backupPath).toMatch(/qingyan\.yml\.bak-\d{14}$/);
		expect(await readFile(result.backupPath, "utf-8")).toBe(previousContent);
		await expect(loadConfig(workspace.configPath, {})).resolves.toMatchObject({
			database: {
				sqlite: {
					file: workspace.databaseFile,
				},
			},
		});
		expect(
			readdirSync(path.dirname(workspace.configPath)).some((fileName) =>
				fileName.startsWith("qingyan.yml.bak-"),
			),
		).toBe(true);
	});

	it("resolves installed state after apply and blocks install page", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			payload: installPayload(workspace.databaseFile),
		});

		await expect(resolveInstallState(minimalConfig, {})).resolves.toMatchObject(
			{
				installed: true,
				lockPath: resolveInstallLockPath(workspace.configPath),
			},
		);
		const response = await app.inject({
			method: "GET",
			url: "/qingyan/admin/install",
		});
		expect(response.statusCode).toBe(410);

		const apply = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			payload: installPayload(workspace.databaseFile),
		});
		expect(apply.statusCode).toBe(410);

		const plan = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install/plan",
			payload: installPayload(workspace.databaseFile),
		});
		expect(plan.statusCode).toBe(410);
	});

	it("keeps install mode open when the database is initialized but the install lock is missing", async () => {
		const workspace = createWorkspace();
		const minimalConfig = createMinimalConfig(workspace.configPath);
		const app = buildInstallApp({ minimalConfig });
		cleanups.push(() => app.close());

		await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			payload: installPayload(workspace.databaseFile),
		});
		rmSync(resolveInstallLockPath(workspace.configPath), { force: true });

		await expect(resolveInstallState(minimalConfig, {})).resolves.toMatchObject(
			{
				installed: false,
				lockPath: resolveInstallLockPath(workspace.configPath),
				reason: "lock_missing",
			},
		);

		const response = await app.inject({
			method: "GET",
			url: "/qingyan/admin/install",
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("QingYan Install");
	});

	it("resolves disabled install mode from environment", () => {
		const workspace = createWorkspace();
		const minimalConfig = resolveMinimalInstallConfig({
			QINGYAN_CONFIG_PATH: workspace.configPath,
			QINGYAN_INSTALL_DISABLED: "true",
		});

		expect(minimalConfig.disabled).toBe(true);
		expect(minimalConfig.configPath).toBe(workspace.configPath);
	});

	it("does not schedule restart when install apply uses manual restart mode", async () => {
		const workspace = createWorkspace();
		const scheduled: unknown[] = [];
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
			scheduleRestart: (transition) => scheduled.push(transition),
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			transition: {
				mode: "manual",
				adminUrl: "http://localhost:4401/qingyan/admin",
				restartRequired: true,
			},
		});
		expect(scheduled).toEqual([]);
	});

	it("schedules transition after successful install apply when transition mode is exit_for_supervisor", async () => {
		const workspace = createWorkspace();
		const scheduled: unknown[] = [];
		const minimalConfig: MinimalInstallConfig = {
			...createMinimalConfig(workspace.configPath),
			transitionMode: "exit_for_supervisor",
		};
		const app = buildInstallApp({
			minimalConfig,
			scheduleRestart: (transition) => scheduled.push(transition),
		});
		cleanups.push(() => app.close());

		const installCookie = await getInstallCookie(app);
		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			cookies: {
				qingyan_install: installCookie?.value ?? "",
			},
			payload: installFormPayload(workspace.databaseFile),
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			transition: {
				mode: "exit_for_supervisor",
				adminUrl: "http://localhost:4401/qingyan/admin",
				restartRequired: true,
			},
		});
		expect(scheduled).toEqual([response.json().transition]);
	});

	it("does not schedule restart when install apply fails", async () => {
		const workspace = createWorkspace();
		const scheduled: unknown[] = [];
		const minimalConfig: MinimalInstallConfig = {
			...createMinimalConfig(workspace.configPath),
			transitionMode: "exit_for_supervisor",
		};
		const app = buildInstallApp({
			minimalConfig,
			scheduleRestart: (transition) => scheduled.push(transition),
		});
		cleanups.push(() => app.close());

		const response = await app.inject({
			method: "POST",
			url: "/qingyan/admin/install",
			payload: installPayload(workspace.databaseFile, "bad-token"),
		});

		expect(response.statusCode).toBe(403);
		expect(scheduled).toEqual([]);
	});

	it("keeps install mode out of root UI and normal admin session routes", async () => {
		const workspace = createWorkspace();
		const app = buildInstallApp({
			minimalConfig: createMinimalConfig(workspace.configPath),
		});
		cleanups.push(() => app.close());

		const rootInstall = await app.inject({
			method: "GET",
			url: "/install?token=install-token",
		});
		expect(rootInstall.statusCode).toBe(404);

		const legacyApi = await app.inject({
			method: "GET",
			url: "/qingyan/api/install/state?token=install-token",
		});
		expect(legacyApi.statusCode).toBe(404);

		const adminInstallApi = await app.inject({
			method: "GET",
			url: "/qingyan/api/admin/install/state?token=install-token",
		});
		expect(adminInstallApi.statusCode).toBe(404);

		const adminSession = await app.inject({
			method: "GET",
			url: "/qingyan/api/admin/session/me",
		});
		expect(adminSession.statusCode).toBe(404);

		const publicApi = await app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=default&pageKey=home",
		});
		expect(publicApi.statusCode).toBe(404);
	});
});
