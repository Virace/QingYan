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
	await page.goto("/admin/");
	const response = await page.request.get("/api/admin/session/me");
	return response.ok();
}

async function login(page: Page): Promise<void> {
	await page.goto("/admin/");
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
