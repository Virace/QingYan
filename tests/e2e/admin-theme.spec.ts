/// <reference lib="dom" />

import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const screenshotDir = path.resolve(
	process.cwd(),
	".temp",
	"playwright",
	"theme-smoke",
);

async function login(page: Page): Promise<void> {
	await page.goto("/qingyan/admin/");
	await page.getByLabel("用户名").fill("admin");
	await page.getByLabel("密码").fill("admin");
	await page.locator("#admin-captcha").fill("2468");
	await page.getByRole("button", { name: "登录后台" }).click();
	await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
}

async function ensureLoggedIn(page: Page): Promise<void> {
	await page.goto("/qingyan/admin/");
	const logoutButton = page.getByRole("button", { name: "退出", exact: true });
	const loginButton = page.getByRole("button", {
		name: "登录后台",
		exact: true,
	});
	await expect(logoutButton.or(loginButton)).toBeVisible();
	if (await logoutButton.isVisible()) {
		return;
	}
	await login(page);
}

async function chooseTheme(
	page: Page,
	label: "浅色" | "深色" | "跟随系统",
): Promise<void> {
	await page.getByRole("button", { name: /主题/u }).click();
	await page.getByRole("menuitem", { name: new RegExp(label, "u") }).click();
}

async function expectDarkTheme(page: Page): Promise<void> {
	await expect(page.locator(".radix-themes.dark").first()).toBeVisible();
	const rootColors = await page
		.locator(".radix-themes")
		.first()
		.evaluate((node) => {
			const styles = window.getComputedStyle(node);
			return {
				backgroundColor: styles.backgroundColor,
				color: styles.color,
			};
		});
	expect(rootColors.backgroundColor).not.toBe("rgb(255, 255, 255)");
	expect(rootColors.color).not.toBe("rgb(0, 0, 0)");
}

async function expectLightTheme(page: Page): Promise<void> {
	await expect(page.locator(".radix-themes.light").first()).toBeVisible();
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
	mkdirSync(screenshotDir, { recursive: true });
	await page.screenshot({
		path: path.join(screenshotDir, `${name}.png`),
		fullPage: true,
	});
}

async function assertHeaderControlsDoNotOverlap(page: Page): Promise<void> {
	const header = page.locator("header").first();
	await expect(header).toBeVisible();
	const controls = await header.locator("button, select").evaluateAll((nodes) =>
		nodes
			.map((node) => {
				const rect = node.getBoundingClientRect();
				const styles = window.getComputedStyle(node);
				return {
					visible:
						styles.display !== "none" &&
						styles.visibility !== "hidden" &&
						rect.width > 0 &&
						rect.height > 0,
					left: rect.left,
					right: rect.right,
					top: rect.top,
					bottom: rect.bottom,
					width: rect.width,
					height: rect.height,
					label:
						node.getAttribute("aria-label") ??
						node.textContent?.trim() ??
						node.tagName,
				};
			})
			.filter((control) => control.visible),
	);
	expect(controls.length).toBeGreaterThan(0);
	for (let index = 0; index < controls.length; index += 1) {
		const current = controls[index];
		expect(current.width, `${current.label} width`).toBeGreaterThan(0);
		expect(current.height, `${current.label} height`).toBeGreaterThan(0);
		for (
			let nextIndex = index + 1;
			nextIndex < controls.length;
			nextIndex += 1
		) {
			const next = controls[nextIndex];
			const overlaps =
				current.left < next.right &&
				current.right > next.left &&
				current.top < next.bottom &&
				current.bottom > next.top;
			expect(overlaps, `${current.label} overlaps ${next.label}`).toBe(false);
		}
	}
}

test("admin theme preference toggles, persists, and keeps header layout stable", async ({
	page,
}) => {
	await ensureLoggedIn(page);

	await chooseTheme(page, "深色");
	await expectDarkTheme(page);
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("qingyan.admin.theme")),
		)
		.toBe("dark");
	await assertHeaderControlsDoNotOverlap(page);
	await saveScreenshot(page, "desktop-dark-overview");

	await page.reload();
	await expectDarkTheme(page);

	await chooseTheme(page, "浅色");
	await expectLightTheme(page);
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("qingyan.admin.theme")),
		)
		.toBe("light");
	await saveScreenshot(page, "desktop-light-overview");

	await chooseTheme(page, "跟随系统");
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("qingyan.admin.theme")),
		)
		.toBe("system");
});

test("dark theme renders key admin views and overlays without obvious layout breakage", async ({
	page,
}) => {
	await ensureLoggedIn(page);
	await chooseTheme(page, "深色");
	await expectDarkTheme(page);

	const views = [
		{
			view: "comments",
			shellHeading: "评论",
			bodyText: "审核、置顶、折叠或删除评论。",
			screenshot: "desktop-dark-comments",
		},
		{
			view: "pages",
			shellHeading: "页面",
			bodyText: "页面级评论、访客、点赞聚合与页面状态治理。",
			screenshot: "desktop-dark-pages",
		},
		{
			view: "tasks",
			shellHeading: "任务",
			bodyText: "任务中心",
			screenshot: "desktop-dark-tasks",
		},
		{
			view: "ops",
			shellHeading: "运维",
			bodyText: "运维",
			screenshot: "desktop-dark-ops",
		},
		{
			view: "users",
			shellHeading: "用户",
			bodyText: "用户组",
			screenshot: "desktop-dark-users",
		},
		{
			view: "profile",
			shellHeading: "个人中心",
			bodyText: "个人资料",
			screenshot: "desktop-dark-profile",
		},
		{
			view: "settings",
			shellHeading: "站点设置",
			bodyText: "站点设置",
			screenshot: "desktop-dark-site-settings",
		},
		{
			view: "system",
			shellHeading: "系统设置",
			bodyText: "系统设置",
			screenshot: "desktop-dark-system-settings",
		},
	] as const;

	for (const item of views) {
		await page.goto(`/qingyan/admin/?view=${item.view}`);
		await expect(
			page.getByRole("heading", { name: item.shellHeading }),
		).toBeVisible();
		await expect(page.getByText(item.bodyText).first()).toBeVisible();
		await expectDarkTheme(page);
		await assertHeaderControlsDoNotOverlap(page);
		await saveScreenshot(page, item.screenshot);
	}

	await page.goto("/qingyan/admin/?view=users");
	await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
	const addUserButton = page.getByRole("button", { name: "新增用户" });
	if (await addUserButton.isVisible()) {
		await addUserButton.click();
		await expect(page.getByRole("dialog")).toBeVisible();
		await saveScreenshot(page, "desktop-dark-users-dialog");
		await page.keyboard.press("Escape");
	}
});

test("dark theme stays usable on a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await ensureLoggedIn(page);
	await chooseTheme(page, "深色");
	await expectDarkTheme(page);
	await assertHeaderControlsDoNotOverlap(page);
	await saveScreenshot(page, "mobile-dark-overview");
});
