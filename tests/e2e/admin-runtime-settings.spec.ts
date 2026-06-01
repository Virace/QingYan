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

async function openSiteSettings(page: Page): Promise<void> {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}
	await page.getByRole("button", { name: "站点设置" }).click();
	await expect(page.getByRole("heading", { name: "站点设置" })).toBeVisible();
}

async function ensureSwitchState(
	page: Page,
	name: string,
	checked: boolean,
): Promise<void> {
	const control = page.getByRole("switch", { name, exact: true });
	await expect(control).toBeVisible();
	const currentChecked = await control.evaluate((element) => {
		const maybeInput = element as { checked?: unknown };
		return typeof maybeInput.checked === "boolean"
			? maybeInput.checked
			: element.getAttribute("aria-checked") === "true";
	});
	if (currentChecked !== checked) {
		await control.click();
	}
	await expect(control).toBeChecked({ checked });
}

async function fieldBox(page: Page, label: string) {
	return page.locator(`[data-field-label="${label}"]`).boundingBox();
}

async function labelBox(page: Page, label: string) {
	return page
		.locator(`[data-field-label="${label}"]`)
		.locator("span", { hasText: label })
		.boundingBox();
}

async function controlBox(page: Page, label: string) {
	return page
		.locator(`[data-field-label="${label}"]`)
		.locator("xpath=./*[2]")
		.boundingBox();
}

async function expectFieldRowsAligned(
	page: Page,
	labels: [string, string],
): Promise<void> {
	const [firstLabel, secondLabel] = labels;
	const firstBox = await fieldBox(page, firstLabel);
	const secondBox = await fieldBox(page, secondLabel);

	if (!firstBox || !secondBox) {
		throw new Error(
			`Expected ${firstLabel} and ${secondLabel} fields to have bounds.`,
		);
	}
	expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThanOrEqual(1);
}

async function expectFieldControlGap(
	page: Page,
	label: string,
	maxGap: number,
): Promise<void> {
	const labelBounds = await labelBox(page, label);
	const controlBounds = await controlBox(page, label);

	if (!labelBounds || !controlBounds) {
		throw new Error(`Expected ${label} label and control to have bounds.`);
	}
	expect(
		controlBounds.y - (labelBounds.y + labelBounds.height),
	).toBeLessThanOrEqual(maxGap);
}

async function expectFieldControlsNearlyAligned(
	page: Page,
	labels: [string, string],
	maxDelta: number,
): Promise<void> {
	const [firstLabel, secondLabel] = labels;
	const firstBox = await controlBox(page, firstLabel);
	const secondBox = await controlBox(page, secondLabel);

	if (!firstBox || !secondBox) {
		throw new Error(
			`Expected ${firstLabel} and ${secondLabel} controls to have bounds.`,
		);
	}
	expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThanOrEqual(maxDelta);
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
	await expect(
		page.getByRole("switch", { name: "评论", exact: true }),
	).toBeVisible();
	await expect(page.getByText("验证码模式")).toBeVisible();
	await expect(page.getByText("请求元数据")).toBeVisible();
	await expect(page.getByRole("checkbox", { name: "昵称" })).toBeVisible();
	await expect(page.getByRole("checkbox", { name: "邮箱" })).toBeVisible();
	await expect(page.getByRole("checkbox", { name: "站点" })).toBeVisible();
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

test("system settings mixed description fields keep switch controls aligned", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1536, height: 900 });
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "系统设置" }).click();
	await ensureSwitchState(page, "外部头像 URL", true);
	await expect(page.getByText("头像接口地址")).toBeVisible();
	await expectFieldRowsAligned(page, ["外部头像 URL", "头像接口地址"]);
	await expectFieldControlsNearlyAligned(
		page,
		["外部头像 URL", "头像接口地址"],
		3,
	);
	await expectFieldControlGap(page, "外部头像 URL", 14);

	await ensureSwitchState(page, "系统邮件", true);
	await expect(page.getByText("SMTP Host")).toBeVisible();
	await expectFieldRowsAligned(page, ["系统邮件", "SMTP Host"]);
	await expectFieldControlsNearlyAligned(page, ["系统邮件", "SMTP Host"], 3);
	await expectFieldControlGap(page, "SMTP Host", 14);
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

	await openSiteSettings(page);
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
	await openSiteSettings(page);
	await ensureSwitchState(page, "访客记录", false);
	await expect(page.getByRole("switch", { name: "访客记录" })).toBeVisible();
	await expect(page.getByRole("switch", { name: "页面浏览量" })).toBeVisible();
	await expect(page.getByRole("switch", { name: "页面点赞" })).toBeVisible();
	await expect(page.getByRole("switch", { name: "评论投票" })).toBeVisible();
	await ensureSwitchState(page, "页面浏览量", true);
	await ensureSwitchState(page, "页面点赞", true);
	await ensureSwitchState(page, "评论投票", true);
	await expectFieldRowsAligned(page, ["页面浏览量", "页面点赞"]);
	await expectFieldControlsNearlyAligned(page, ["页面浏览量", "页面点赞"], 1);
	await expectFieldControlGap(page, "页面浏览量", 14);
	await expect(page.getByText("低可信", { exact: true })).toBeVisible();
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

test("site settings comment group switch hides and restores comment details", async ({
	page,
}) => {
	await openSiteSettings(page);

	const commentSwitch = page.getByRole("switch", { name: "评论", exact: true });
	await expect(commentSwitch).toBeVisible();

	await ensureSwitchState(page, "评论", false);
	await expect(page.getByText("评论已关闭。已保存的审核")).toBeVisible();
	await expect(page.getByText("默认状态")).toHaveCount(0);
	await expect(page.getByText("审核模式")).toHaveCount(0);
	await expect(page.getByText("验证码模式")).toHaveCount(0);

	await ensureSwitchState(page, "评论", true);
	await expect(page.getByText("默认状态")).toBeVisible();
	await expect(page.getByText("审核模式", { exact: true })).toBeVisible();
	await expect(page.getByText("验证码模式")).toBeVisible();
});

test("site settings comment details stay inside the comment config group", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openSiteSettings(page);
	await ensureSwitchState(page, "评论", true);

	const commentGroup = page.getByTestId("settings-group-comments");
	await expect(commentGroup).toBeVisible();

	const groupBox = await commentGroup.boundingBox();
	const defaultStatusBox = await page.getByText("默认状态").boundingBox();
	const moderationBox = await page
		.getByText("审核模式", { exact: true })
		.boundingBox();

	if (!groupBox || !defaultStatusBox || !moderationBox) {
		throw new Error("Expected comment group and field labels to have bounds.");
	}
	expect(defaultStatusBox.x).toBeGreaterThanOrEqual(groupBox.x);
	expect(defaultStatusBox.x + defaultStatusBox.width).toBeLessThanOrEqual(
		groupBox.x + groupBox.width,
	);
	expect(moderationBox.x).toBeGreaterThanOrEqual(groupBox.x);
	expect(moderationBox.x + moderationBox.width).toBeLessThanOrEqual(
		groupBox.x + groupBox.width,
	);
});

test("admin content keeps a centered max width on wide screens", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openSiteSettings(page);

	const content = page.getByTestId("admin-content");
	await expect(content).toBeVisible();
	const box = await content.boundingBox();

	if (!box) {
		throw new Error("Expected admin content to have bounds.");
	}
	expect(box.width).toBeLessThanOrEqual(1536);
	expect(box.x).toBeGreaterThan(0);
});

test("site settings visual states render without overlay on desktop and mobile", async ({
	page,
}, testInfo) => {
	const consoleIssues: string[] = [];
	page.on("console", (message) => {
		if (["error", "warning"].includes(message.type())) {
			consoleIssues.push(`${message.type()}: ${message.text()}`);
		}
	});

	await page.setViewportSize({ width: 1536, height: 900 });
	await openSiteSettings(page);
	await ensureSwitchState(page, "评论", false);
	await expect(page.getByText("评论已关闭。已保存的审核")).toBeVisible();
	await expect(page.locator("#vite-error-overlay")).toHaveCount(0);
	await testInfo.attach("site-settings-comments-off-desktop", {
		body: await page.screenshot({ fullPage: false }),
		contentType: "image/png",
	});

	await ensureSwitchState(page, "评论", true);
	await expect(page.getByText("审核模式", { exact: true })).toBeVisible();
	await testInfo.attach("site-settings-comments-on-desktop", {
		body: await page.screenshot({ fullPage: false }),
		contentType: "image/png",
	});

	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await page
		.getByRole("combobox", { name: "管理模块" })
		.selectOption("settings");
	await expect(page.getByRole("heading", { name: "站点设置" })).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "评论", exact: true }),
	).toBeVisible();
	await expect(page.locator("#vite-error-overlay")).toHaveCount(0);
	await testInfo.attach("site-settings-mobile", {
		body: await page.screenshot({ fullPage: false }),
		contentType: "image/png",
	});

	expect(consoleIssues.filter((item) => !item.includes("favicon"))).toEqual([]);
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
