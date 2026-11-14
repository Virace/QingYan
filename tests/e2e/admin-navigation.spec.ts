import { existsSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

const authStatePath = path.resolve(
	process.cwd(),
	".temp",
	"playwright",
	"admin-auth.json",
);

test.use({
	storageState: existsSync(authStatePath) ? authStatePath : undefined,
});

async function openAdmin(page: Page) {
	await page.goto("/qingyan/admin/");
	const loginButton = page.getByRole("button", {
		name: "登录后台",
		exact: true,
	});
	await expect(
		loginButton.or(page.getByRole("button", { name: "退出", exact: true })),
	).toBeVisible();
	if (await loginButton.isVisible()) {
		await page.getByLabel("用户名").fill("admin");
		await page.getByLabel("密码").fill("admin");
		await page.locator("#admin-captcha").fill("2468");
		await loginButton.click();
	}
	await expect(
		page.getByRole("button", { name: "退出", exact: true }),
	).toBeVisible();
}

test("site context survives internal links, reload and browser history", async ({
	page,
}) => {
	await openAdmin(page);
	await page
		.getByRole("navigation")
		.getByRole("button", { name: "站点", exact: true })
		.click();
	await page.getByRole("button", { name: "新增站点", exact: true }).click();
	const siteKey = `navigation-${Date.now()}`;
	const dialog = page.getByRole("dialog", { name: "新增站点" });
	await dialog.getByLabel("站点 key").fill(siteKey);
	await dialog.getByLabel("站点名称").fill("Navigation Site");
	await dialog
		.getByLabel("前端站点 Origin")
		.fill("https://navigation.example.com");
	await dialog.getByRole("button", { name: "创建站点", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await page.getByLabel("当前站点", { exact: true }).selectOption(siteKey);
	await page
		.getByRole("navigation")
		.getByRole("button", { name: "站点设置", exact: true })
		.click();
	await page.getByRole("tab", { name: "页面注册", exact: true }).click();
	await page
		.getByRole("combobox", { name: "模式", exact: true })
		.selectOption("authoritative");
	await page.getByRole("link", { name: "打开任务中心", exact: true }).click();
	await page
		.getByRole("alertdialog", { name: "放弃未保存的更改？" })
		.getByRole("button", { name: "放弃更改并离开", exact: true })
		.click();
	await expect(page).toHaveURL(
		new RegExp(`view=tasks.*siteKey=${siteKey}|siteKey=${siteKey}.*view=tasks`),
	);
	await expect(page.getByLabel("当前站点", { exact: true })).toHaveValue(
		siteKey,
	);
	await page.reload();
	await expect(page.getByLabel("当前站点", { exact: true })).toHaveValue(
		siteKey,
	);
	await page.goBack();
	await expect(
		page.getByRole("tab", { name: "页面注册", exact: true }),
	).toHaveAttribute("data-state", "active");
	await expect(page.getByLabel("当前站点", { exact: true })).toHaveValue(
		siteKey,
	);
	await page.goForward();
	await expect(page.locator("header h1")).toHaveText("任务");
	await expect(page.getByLabel("当前站点", { exact: true })).toHaveValue(
		siteKey,
	);
});

test("canceling navigation or logout keeps unsaved settings", async ({
	page,
}) => {
	await openAdmin(page);
	await page
		.getByRole("navigation")
		.getByRole("button", { name: "站点设置", exact: true })
		.click();
	const comments = page.getByRole("switch", { name: "评论", exact: true });
	await expect(comments).toBeVisible();
	const wasChecked = await comments.isChecked();
	await comments.click();
	await page.evaluate(() => {
		const link = document.createElement("a");
		link.href = "?view=settings&siteTab=engagement";
		link.textContent = "查看访客设置";
		document.querySelector("header")?.append(link);
	});
	await page.getByRole("link", { name: "查看访客设置", exact: true }).click();
	await expect(
		page.getByRole("tab", { name: "访客与计数", exact: true }),
	).toHaveAttribute("data-state", "active");
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await page.goBack();
	await expect(comments).toBeChecked({ checked: !wasChecked });
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await page.goForward();
	await expect(
		page.getByRole("tab", { name: "访客与计数", exact: true }),
	).toHaveAttribute("data-state", "active");
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await page.getByRole("tab", { name: "评论", exact: true }).click();
	await expect(comments).toBeChecked({ checked: !wasChecked });
	await page
		.getByRole("navigation")
		.getByRole("button", { name: "任务", exact: true })
		.click();
	const confirmation = page.getByRole("alertdialog", {
		name: "放弃未保存的更改？",
	});
	await expect(confirmation).toBeVisible();
	await confirmation
		.getByRole("button", { name: "继续编辑", exact: true })
		.click();
	await expect(comments).toBeChecked({ checked: !wasChecked });
	await expect(page.locator("header h1")).toHaveText("站点设置");
	await page.getByRole("button", { name: "退出", exact: true }).click();
	await confirmation
		.getByRole("button", { name: "继续编辑", exact: true })
		.click();
	await expect(comments).toBeChecked({ checked: !wasChecked });
	await page
		.getByRole("navigation")
		.getByRole("button", { name: "任务", exact: true })
		.click();
	await confirmation
		.getByRole("button", { name: "放弃更改并离开", exact: true })
		.click();
	await expect(page.locator("header h1")).toHaveText("任务");
});

test("deleted pages link scrolls to deletion recovery after SPA navigation", async ({
	page,
}) => {
	await openAdmin(page);
	await page
		.getByRole("navigation")
		.getByRole("button", { name: "页面", exact: true })
		.click();
	await page.getByLabel("页面状态", { exact: true }).selectOption("deleted");
	await page.getByRole("link", { name: "查看删除恢复", exact: true }).click();
	await expect(page).toHaveURL(/view=ops.*#deletion-recovery$/);
	const recovery = page.locator("#deletion-recovery");
	await expect(recovery).toBeVisible();
	await expect
		.poll(async () =>
			recovery.evaluate((element) => element.getBoundingClientRect().top),
		)
		.toBeLessThan(40);
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBeGreaterThan(0);
});
