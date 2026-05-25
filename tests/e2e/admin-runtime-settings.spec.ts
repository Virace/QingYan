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
	await expect(page.getByText("评论开关")).toBeVisible();
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
	await expect(page.getByText("SMTP Host")).toBeVisible();
	await expect(page.getByText("SMTP 密码")).toBeVisible();
	await expect(page.getByText("启用 Gravatar")).toBeVisible();
	await expect(page.getByText("Gravatar Base URL")).toBeVisible();
	await expect(page.getByText("验证码类型 Provider")).toBeVisible();
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
	const provider = page
		.getByText("验证码类型 Provider")
		.locator("..")
		.locator("select");
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
		page.getByText("systemctl status qingyan.service"),
	).toBeVisible();
});
