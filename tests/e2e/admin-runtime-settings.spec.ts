import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const authStatePath = path.resolve(
	process.cwd(),
	".temp",
	"playwright",
	"admin-auth.json",
);

async function isLoggedIn(page: Page): Promise<boolean> {
	await page.goto("/qingyan/admin/");
	const response = await page.request.get("/qingyan/api/admin/session/me");
	return response.ok();
}

async function login(page: Page): Promise<void> {
	await page.goto("/qingyan/admin/");
	await page.getByLabel("用户名").fill("admin");
	await page.getByLabel("密码").fill("admin");
	await page.locator("#admin-captcha").fill("2468");
	await page.getByRole("button", { name: "登录后台" }).click();
	await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
	mkdirSync(path.dirname(authStatePath), { recursive: true });
	await page.context().storageState({ path: authStatePath });
}

test.use({
	storageState: existsSync(authStatePath) ? authStatePath : undefined,
});

test("site settings page renders editable controls", async ({ page }) => {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "站点设置" }).click();
	await expect(page.getByRole("heading", { name: "站点设置" })).toBeVisible();
	await expect(page.getByText("请选择站点")).toHaveCount(0);
	await expect(page.getByText("评论").first()).toBeVisible();
	await expect(page.getByText("验证码模式")).toBeVisible();
	await expect(page.getByText("请求元数据")).toBeVisible();
	await expect(page.getByText("IPv4 下载源")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "保存站点设置" }),
	).toBeVisible();
});

test("system settings page renders database-owned install settings", async ({
	page,
}) => {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "系统设置" }).click();
	await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "系统邮件" })).toBeVisible();
	await expect(page.getByText("SMTP Host")).toHaveCount(0);
	await expect(page.getByText("已保存的 SMTP 配置会保留")).toBeVisible();
	await expect(page.getByRole("heading", { name: "外部头像" })).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "外部头像 URL" }),
	).toBeVisible();
	await expect(page.getByText("头像接口地址")).toHaveCount(0);
	await expect(page.getByText("邮箱哈希算法")).toHaveCount(0);
	await expect(page.getByText("头像 URL 参数")).toHaveCount(0);
	await expect(page.getByText("已保存的 base URL")).toBeVisible();
	await expect(page.getByRole("heading", { name: "验证码服务" })).toBeVisible();
	await expect(page.getByText("图片宽度")).toBeVisible();
	await expect(page.getByText("Turnstile Site Key")).toHaveCount(0);
	await expect(page.getByText("IPv4 下载源")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "保存系统设置" }),
	).toBeVisible();
});

test("system settings captcha provider shows only matching fields", async ({
	page,
}) => {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "系统设置" }).click();
	const provider = page.getByLabel("验证码服务");
	await expect(provider).toBeVisible();
	await expect(page.getByText("图片宽度")).toBeVisible();
	await expect(page.getByText("Turnstile Site Key")).toHaveCount(0);
	await expect(page.getByText("hCaptcha Secret Key")).toHaveCount(0);
	await expect(page.getByText("reCAPTCHA API Key")).toHaveCount(0);
	await expect(page.getByText("GeeTest API Server")).toHaveCount(0);

	await provider.selectOption("turnstile");
	await expect(page.getByText("Turnstile Site Key")).toBeVisible();
	await expect(page.getByText("图片宽度")).toHaveCount(0);
	await expect(page.getByText("hCaptcha Secret Key")).toHaveCount(0);

	await provider.selectOption("hcaptcha");
	await expect(page.getByText("hCaptcha Secret Key")).toBeVisible();
	await expect(page.getByText("Turnstile Site Key")).toHaveCount(0);

	await provider.selectOption("recaptcha");
	await expect(page.getByText("reCAPTCHA API Key")).toBeVisible();
	await expect(page.getByText("hCaptcha Secret Key")).toHaveCount(0);

	await provider.selectOption("geetest");
	await expect(page.getByText("GeeTest API Server")).toBeVisible();
	await expect(page.getByText("reCAPTCHA API Key")).toHaveCount(0);
});

test("site settings save failure shows request id and field errors", async ({
	page,
}) => {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.route("**/api/admin/sites/*/settings", async (route) => {
		if (route.request().method() === "PUT") {
			await route.fulfill({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({
					error: {
						code: "VALIDATION_FAILED",
						message: "请求参数无效。",
						requestId: "req_settings_visible",
						fields: [
							{
								path: "engagement.commentVotes.enabled",
								code: "invalid_type",
								expected: "boolean",
								received: "number",
								message: "必须是 JSON boolean，不能使用 0/1。",
							},
						],
					},
				}),
			});
			return;
		}
		await route.fallback();
	});

	await page.getByRole("button", { name: "站点设置" }).click();
	await page.getByRole("button", { name: "保存站点设置" }).click();
	await expect(page.getByText("站点设置保存失败")).toBeVisible();
	await expect(page.getByText("req_settings_visible")).toBeVisible();
	await expect(page.getByText("engagement.commentVotes.enabled")).toBeVisible();
	await expect(
		page.getByText("必须是 JSON boolean，不能使用 0/1。").first(),
	).toBeVisible();
});

test("site settings keeps independent counters visible when visitors are off", async ({
	page,
}) => {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "站点设置" }).click();
	await expect(page.getByRole("switch", { name: "访客记录" })).toBeVisible();
	await expect(page.getByRole("switch", { name: "页面浏览量" })).toBeVisible();
	await expect(page.getByRole("switch", { name: "页面点赞" })).toBeVisible();
	await expect(page.getByRole("switch", { name: "评论投票" })).toBeVisible();
});

test("system mail disabled hides smtp details without removing site notification control", async ({
	page,
}) => {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "系统设置" }).click();
	await expect(page.getByRole("heading", { name: "系统邮件" })).toBeVisible();
	await expect(page.getByText("SMTP Host")).toHaveCount(0);
	await expect(page.getByText("已保存的 SMTP 配置会保留")).toBeVisible();

	await page.getByRole("button", { name: "站点设置" }).click();
	await expect(page.getByText("当前站点邮件通知")).toBeVisible();
});

test("ops page renders update plan and upgrade dry-run", async ({ page }) => {
	await page.route("**/api/admin/ops/update/check", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				state: "no_release",
				currentVersion: "0.1.0",
				autoUpdatable: false,
				source: {
					provider: "github-releases",
					owner: "Virace",
					repo: "QingYan",
					url: "https://github.com/Virace/QingYan",
				},
				message:
					"更新规则已配置，但当前仓库尚未发布首个 Release，暂时没有可安装更新。",
				checkedAt: "2026-05-07T00:00:00.000Z",
			}),
		});
	});
	await page.route("**/api/admin/ops/update/plan", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				kind: "program-update",
				executor: "qingyan.service",
				description: "使用服务动作执行程序更新。",
				estimatedRestartSeconds: {
					min: 30,
					max: 60,
				},
				steps: ["创建整站备份", "执行 qyctl upgrade"],
				manualCommands: ["qyctl status"],
			}),
		});
	});
	await page.route("**/api/admin/ops/upgrade/dry-run", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				state: "normal_current",
				plan: null,
				manualCommands: [
					"systemctl status qingyan.service",
					"journalctl -u qingyan.service -n 120 --no-pager",
					"qyctl status",
				],
			}),
		});
	});

	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	const mobileModuleSelect = page.getByLabel("管理模块");
	if (await mobileModuleSelect.isVisible()) {
		await mobileModuleSelect.selectOption("ops");
	} else {
		await page.getByRole("button", { name: "运维" }).click();
	}
	await expect(page.getByRole("heading", { name: "运维" })).toBeVisible();
	await expect(page.getByText("qingyan.full-backup / sqlite")).toBeVisible();
	await expect(page.getByText("service-action")).toBeVisible();
	await expect(page.getByText("更新检测")).toBeVisible();
	await expect(page.getByText("GitHub Release / Virace/QingYan")).toBeVisible();

	await page.getByRole("button", { name: "检查更新" }).click();
	await expect(page.getByText("尚未发布 Release")).toBeVisible();
	await expect(page.getByText("当前仓库尚未发布首个 Release")).toBeVisible();
	await page.getByRole("button", { name: "查看更新计划" }).click();
	await expect(
		page.getByRole("heading", { name: "更新执行计划" }),
	).toBeVisible();
	await expect(page.getByText("创建整站备份")).toBeVisible();
	await expect(page.getByText("执行 qyctl upgrade")).toBeVisible();

	await page.getByRole("button", { name: "数据升级预检" }).click();
	await expect(
		page.getByRole("heading", { name: "数据库升级检查" }),
	).toBeVisible();
	await expect(page.getByText('"state": "normal_current"')).toBeVisible();
	await expect(
		page.getByText("systemctl status qingyan.service", { exact: true }),
	).toBeVisible();
});
