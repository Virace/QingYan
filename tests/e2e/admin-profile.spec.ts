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
	const logoutButton = page.getByRole("button", { name: "退出", exact: true });
	const loginButton = page.getByRole("button", {
		name: "登录后台",
		exact: true,
	});
	await expect(logoutButton.or(loginButton)).toBeVisible();
	return logoutButton.isVisible();
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

async function openProfile(page: Page): Promise<void> {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}
	await page.goto("/qingyan/admin/?view=profile");
	await expect(page.getByRole("heading", { name: "个人中心" })).toBeVisible();
	await expect(page.getByText("个人资料")).toBeVisible();
	await expect(page.getByLabel("昵称")).toBeVisible();
}

test.use({
	storageState: existsSync(authStatePath) ? authStatePath : undefined,
});

test("profile password form sends confirm password without clearing the active session", async ({
	page,
}) => {
	await openProfile(page);

	await page.getByRole("tab", { name: "密码" }).click();
	await expect(page.getByLabel("确认新密码")).toBeVisible();

	let passwordPayload: unknown;
	await page.route("**/qingyan/api/admin/profile/password", async (route) => {
		passwordPayload = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				user: {
					id: 1,
					username: "admin",
					email: "admin@example.com",
					displayName: "Administrator",
					groupKey: "admin",
					groupName: "系统管理员",
					isInitialAdmin: true,
					passwordChangeRequired: false,
				},
				sites: [],
				session: {
					expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				},
			}),
		});
	});

	await page.getByLabel("当前密码").fill("admin");
	await page.getByLabel("新密码", { exact: true }).fill("admin-next-pass");
	await page.getByLabel("确认新密码").fill("admin-next-pass");
	await page.getByRole("button", { name: "保存密码" }).click();

	await expect
		.poll(() => passwordPayload)
		.toEqual({
			currentPassword: "admin",
			nextPassword: "admin-next-pass",
			confirmPassword: "admin-next-pass",
		});

	await expect(page.getByRole("heading", { name: "个人中心" })).toBeVisible();
	await expect(page.getByLabel("确认新密码")).toBeVisible();

	let profilePatchCsrfHeader: string | undefined;
	await page.route("**/qingyan/api/admin/profile", async (route) => {
		if (route.request().method() !== "PATCH") {
			await route.fallback();
			return;
		}
		profilePatchCsrfHeader = route.request().headers()["x-qingyan-csrf-token"];
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				user: {
					id: 1,
					username: "admin",
					email: "admin@example.com",
					displayName: "Administrator",
					groupKey: "admin",
					groupName: "系统管理员",
					isInitialAdmin: true,
					passwordChangeRequired: false,
				},
				sites: [],
				session: {
					expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				},
			}),
		});
	});
	await page.getByRole("tab", { name: "资料" }).click();
	await page.getByLabel("昵称").fill("Administrator CSRF");
	await page.getByRole("button", { name: "保存资料" }).click();
	await expect.poll(() => profilePatchCsrfHeader).toBeTruthy();
});

test("profile save reports unchanged and successful states", async ({
	page,
}) => {
	await openProfile(page);

	let profilePatchCount = 0;
	await page.route("**/qingyan/api/admin/profile", async (route) => {
		if (route.request().method() !== "PATCH") {
			await route.fallback();
			return;
		}
		profilePatchCount += 1;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				user: {
					id: 1,
					username: "admin",
					email: "admin@example.com",
					displayName: "Administrator Saved",
					website: "https://admin.example.test",
					avatarUrl: "",
					groupKey: "admin",
					groupName: "系统管理员",
					isInitialAdmin: true,
					passwordChangeRequired: false,
				},
				sites: [],
				session: {
					expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				},
			}),
		});
	});

	await page.getByRole("button", { name: "保存资料" }).click();
	await expect(page.getByText("资料无变化")).toBeVisible();
	await expect.poll(() => profilePatchCount).toBe(0);

	await page.getByLabel("昵称").fill("Administrator Saved");
	await page.getByLabel("网站").fill("https://admin.example.test");
	await page.getByRole("button", { name: "保存资料" }).click();
	await expect(page.getByText("个人资料已保存")).toBeVisible();
	await expect.poll(() => profilePatchCount).toBe(1);
});

test("profile email form requires current password and renders verification state", async ({
	page,
}) => {
	await openProfile(page);

	await page.getByRole("tab", { name: "邮箱" }).click();
	await expect(page.getByLabel("当前密码")).toBeVisible();

	let emailPayload: unknown;
	await page.route(
		"**/qingyan/api/admin/profile/email-change",
		async (route) => {
			emailPayload = route.request().postDataJSON();
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					status: "pending_verification",
					newEmail: "admin-new@example.com",
					expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
				}),
			});
		},
	);

	await page.getByLabel("邮箱", { exact: true }).fill("admin-new@example.com");
	await page.getByLabel("当前密码").fill("admin");
	await page.getByRole("button", { name: "提交邮箱变更" }).click();

	await expect
		.poll(() => emailPayload)
		.toEqual({
			newEmail: "admin-new@example.com",
			currentPassword: "admin",
		});
	await expect(page.getByText("验证码已发送到新邮箱")).toBeVisible();
	await expect(page.getByLabel("邮箱验证码")).toBeVisible();
	await expect(page.getByRole("button", { name: "确认邮箱" })).toBeVisible();
});
