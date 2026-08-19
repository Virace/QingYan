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

async function openSiteSettings(page: Page): Promise<void> {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}
	await page.getByRole("button", { name: "站点设置" }).click();
	await expect(page.getByRole("heading", { name: "站点设置" })).toBeVisible();
}

async function openSystemSettings(page: Page): Promise<void> {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}
	await page.getByRole("button", { name: "系统设置" }).click();
	await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
}

async function selectSettingsTab(page: Page, name: string): Promise<void> {
	await page.getByRole("tab", { name, exact: true }).click();
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
	await selectSettingsTab(page, "访客与计数");
	await expect(page.getByRole("switch", { name: "访客记录" })).toBeVisible();
	await selectSettingsTab(page, "通知");
	await expect(page.getByRole("heading", { name: "评论通知" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "新待审评论" })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "直接发布评论" }),
	).toBeVisible();
});

test("admin shell keeps the active users view after reload", async ({
	page,
}) => {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "用户", exact: true }).click();
	await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
	await expect(page).toHaveURL(/view=users/);
	await page.reload();
	await expect(page.getByRole("heading", { name: "用户" })).toBeVisible();
});

test("settings tabs sync to query without changing the active settings view", async ({
	page,
}) => {
	await openSiteSettings(page);
	await expect(page).toHaveURL(/view=settings/);
	await selectSettingsTab(page, "通知");
	await expect(page).toHaveURL(/view=settings/);
	await expect(page).toHaveURL(/siteTab=notifications/);
	await page.reload();
	await expect(page.getByRole("heading", { name: "站点设置" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "评论通知" })).toBeVisible();

	await page.getByRole("button", { name: "系统设置" }).click();
	await expect(page).toHaveURL(/view=system/);
	await selectSettingsTab(page, "邮件");
	await expect(page).toHaveURL(/view=system/);
	await expect(page).toHaveURL(/systemTab=mail/);
	await page.reload();
	await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "系统邮件" })).toBeVisible();
});

test("users page renders tabs, dialogs and session-aware logout", async ({
	page,
}) => {
	await page.route("**/api/admin/users?*", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				users: [
					{
						id: 1001,
						username: "offline-site-admin",
						email: "offline@example.com",
						displayName: "Offline Site Admin",
						status: "active",
						groupKey: "site_admin",
						groupName: "站点管理员",
						siteKeys: ["fangyuan"],
						isInitialAdmin: false,
						passwordChangeRequired: false,
						loginBlockedUntil: null,
						activeSessionCount: 0,
						lastSessionSeenAt: null,
						lastLoginAt: null,
						createdAt: "2026-06-02T00:00:00.000Z",
						updatedAt: "2026-06-02T00:00:00.000Z",
						deletedAt: null,
					},
				],
			}),
		});
	});
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "用户", exact: true }).click();
	await expect(
		page.getByRole("tab", { name: "用户", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("tab", { name: "用户组", exact: true }),
	).toBeVisible();
	await expect(page.getByText("无在线会话")).toBeVisible();
	await expect(page.getByRole("button", { name: "强制登出" })).toBeDisabled();
	await page.getByRole("button", { name: "新增用户" }).click();
	await expect(page.getByRole("dialog", { name: "新增用户" })).toBeVisible();
	await expect(page.getByLabel("用户名")).toBeVisible();
	await expect(page.getByLabel("邮箱")).toBeVisible();
	await expect(page.getByLabel("初始密码")).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "重置密码" }).click();
	const resetDialog = page.getByRole("dialog", { name: "重置密码" });
	await expect(resetDialog).toBeVisible();
	await expect(resetDialog.getByLabel("新密码", { exact: true })).toBeVisible();
	await expect(resetDialog.getByLabel("确认新密码")).toBeVisible();
});

test("site create and visitor filters use dialog-style controls", async ({
	page,
}) => {
	await page.route("**/api/admin/visitors?*", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				enabled: true,
				trustMode: "trusted",
				items: [
					{
						siteKey: "fangyuan",
						visitorKey: "visitor_e2e",
						lastSeenAt: "2026-06-02T00:00:00.000Z",
						createdAt: "2026-06-02T00:00:00.000Z",
						commentCount: 0,
						pageCount: 1,
						emailCount: 0,
						emails: [],
						ips: [],
						userAgents: [],
						lastIp: "203.0.113.8",
						lastUserAgent: "Mozilla/5.0 E2E",
						lastSeenPageKey: "post:e2e",
						lastSeenPageUrl: "https://example.com/posts/e2e/",
						lastRequestMeta: {
							ip: { raw: "203.0.113.8", location: null },
							userAgent: { raw: "Mozilla/5.0 E2E", device: null },
						},
						ipLocations: [],
						devices: [],
						blacklist: { ip: false, visitor: false },
					},
				],
				pagination: { limit: 20, offset: 0, totalCount: 1 },
			}),
		});
	});
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "站点", exact: true }).click();
	await page.getByRole("button", { name: "新增站点" }).click();
	await expect(page.getByRole("dialog", { name: "新增站点" })).toBeVisible();
	await expect(page.getByLabel("站点 key")).toBeVisible();
	await expect(page.getByLabel("站点名称")).toBeVisible();
	await expect(page.getByLabel("前端站点 Origin")).toBeVisible();
	await page.keyboard.press("Escape");

	await page
		.getByRole("navigation")
		.getByRole("button", { name: "访客", exact: true })
		.click();
	await expect(page.getByText("站点 fangyuan")).toBeVisible();
	await expect(page.getByText("https://example.com/posts/e2e/")).toBeVisible();
	await expect(page.getByText(/PageKey/)).toHaveCount(0);
	await page.getByText("筛选").click();
	await expect(page.getByLabel("IP")).toBeVisible();
	await expect(page.getByLabel("UA")).toBeVisible();
	await expect(page.getByLabel("完整链接")).toBeVisible();
	await expect(page.getByLabel("设备")).toBeVisible();
	await expect(page.getByLabel("地域")).toBeVisible();
	await expect(page.getByLabel("黑名单状态")).toBeVisible();
});

test("comment email status opens safe details and filtered task records", async ({
	page,
}) => {
	const delivery = {
		kind: "delivery",
		channel: "email",
		flow: "site_staff_comment",
		state: "accepted",
		phase: "accepted",
		recipient: { label: "站点人员", address: "a***@example.test" },
		attemptCount: 1,
		maxAttempts: 3,
		acceptedAt: "2026-08-19T00:00:02.000Z",
		updatedAt: "2026-08-19T00:00:02.000Z",
		reasonCode: null,
		errorKind: null,
		message: null,
	};
	const taskRun = {
		id: "task_e2e",
		scheduledTaskId: null,
		scheduledTaskNameSnapshot: null,
		type: "站点人员评论提醒",
		category: "notification",
		status: "succeeded",
		siteId: 1,
		siteKey: "fangyuan",
		scopeKind: null,
		trigger: "评论事件",
		ownerUserIdSnapshot: null,
		createdByUserId: null,
		skipReason: null,
		blockReason: null,
		runAfter: null,
		createdAt: "2026-08-19T00:00:00.000Z",
		startedAt: "2026-08-19T00:00:01.000Z",
		finishedAt: "2026-08-19T00:00:02.000Z",
		updatedAt: "2026-08-19T00:00:02.000Z",
		canViewLogs: true,
		visibility: "run_detail",
		workflow: "站点人员评论提醒",
		attempts: 1,
		maxAttempts: 3,
	};
	await page.route("**/api/admin/comments?*", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				items: [
					{
						id: "comment_e2e",
						parentId: null,
						status: "approved",
						authorName: "E2E",
						authorEmail: "e2e@example.com",
						authorAvatarUrl: null,
						authorIp: null,
						authorUserAgent: null,
						requestMeta: {
							ip: { raw: null, location: null },
							userAgent: { raw: null, device: null },
						},
						authorIpLocation: {
							country: null,
							region: null,
							city: null,
							isp: null,
							raw: null,
							source: null,
							dbHash: null,
							updatedAt: null,
							error: null,
						},
						blacklist: { email: false, ip: false },
						contentRaw: "hello",
						isPinned: false,
						isFolded: false,
						replyCount: 0,
						voteUpCount: 0,
						voteDownCount: 0,
						createdAt: "2026-06-02T00:00:00.000Z",
						updatedAt: "2026-06-02T00:00:00.000Z",
						siteKey: "fangyuan",
						pageKey: "post:e2e",
						pageTitle: "E2E Page",
						pageUrl: "https://example.com/posts/e2e/",
						emailDelivery: {
							state: "accepted",
							deliveryCount: 1,
							acceptedCount: 1,
							failedCount: 0,
							processingCount: 0,
							notSentDecisionCount: 0,
							lastUpdatedAt: "2026-08-19T00:00:02.000Z",
						},
					},
				],
				pagination: { limit: 20, offset: 0, totalCount: 1 },
			}),
		});
	});
	await page.route(
		"**/api/admin/comments/comment_e2e/email-delivery-status",
		async (route) => {
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					commentId: "comment_e2e",
					summary: {
						state: "accepted",
						deliveryCount: 1,
						acceptedCount: 1,
						failedCount: 0,
						processingCount: 0,
						notSentDecisionCount: 0,
						lastUpdatedAt: "2026-08-19T00:00:02.000Z",
					},
					groups: [
						{
							flow: "site_staff_comment",
							label: "站点人员评论提醒",
							state: "accepted",
							items: [delivery],
						},
					],
					canViewTaskRecords: true,
				}),
			});
		},
	);
	await page.route("**/api/admin/tasks/runs?*", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({ items: [taskRun], totalCount: 1 }),
		});
	});
	await page.route("**/api/admin/tasks/runs/task_e2e/logs*", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({ items: [], nextSequence: 0, hasMore: false }),
		});
	});
	await page.route("**/api/admin/tasks/runs/task_e2e", async (route) => {
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({ ...taskRun, deliveries: [delivery] }),
		});
	});
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "评论", exact: true }).click();
	await expect(page.getByText("站点 fangyuan")).toBeVisible();
	await page.getByRole("button", { name: "邮件：服务商已接受，1/1" }).click();
	const deliveryDialog = page.getByRole("dialog", { name: "邮件投递状态" });
	await expect(deliveryDialog).toBeVisible();
	await expect(deliveryDialog.getByText("站点人员评论提醒")).toBeVisible();
	await expect(deliveryDialog.getByText("a***@example.test")).toBeVisible();
	await deliveryDialog.getByRole("button", { name: "查看任务记录" }).click();
	await expect(page).toHaveURL(/view=tasks/);
	await expect(page).toHaveURL(/commentId=comment_e2e/);
	await expect(
		page.getByText("正在查看当前评论相关的通知运行记录。"),
	).toBeVisible();
	await page.getByRole("button", { name: "详情", exact: true }).click();
	const taskDialog = page.getByRole("dialog", { name: "运行详情" });
	await expect(
		taskDialog.getByRole("heading", { name: "投递结果" }),
	).toBeVisible();
	await expect(taskDialog.getByText("a***@example.test")).toBeVisible();
	await expect(page.getByText("task_e2e")).toHaveCount(0);
});

test("system settings page renders database-owned install settings", async ({
	page,
}) => {
	await openSystemSettings(page);
	await expect(page.getByRole("tab", { name: "后台与安全" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "限流" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "邮件" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "验证码" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "头像与公开接口" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "IP 地域" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "反垃圾" })).toBeVisible();

	await selectSettingsTab(page, "邮件");
	await expect(page.getByRole("heading", { name: "系统邮件" })).toBeVisible();
	await ensureSwitchState(page, "系统邮件", false);
	await expect(page.locator('[data-field-label="SMTP Host"]')).toHaveCount(0);
	await expect(page.getByText("已保存的 SMTP 配置会保留")).toBeVisible();
	await selectSettingsTab(page, "头像与公开接口");
	await expect(page.getByRole("heading", { name: "外部头像" })).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "外部头像 URL" }),
	).toBeVisible();
	await ensureSwitchState(page, "外部头像 URL", false);
	await expect(page.getByText("头像接口地址")).toHaveCount(0);
	await expect(page.getByText("邮箱哈希算法")).toHaveCount(0);
	await expect(page.getByText("头像 URL 参数")).toHaveCount(0);
	await expect(page.getByText("已保存的 base URL")).toBeVisible();
	await selectSettingsTab(page, "验证码");
	await expect(page.getByRole("heading", { name: "验证码服务" })).toBeVisible();
	await expect(page.getByText("图片宽度")).toBeVisible();
	await expect(page.getByText("Turnstile Site Key")).toHaveCount(0);
	await selectSettingsTab(page, "IP 地域");
	await expect(page.getByText("IPv4 下载源")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "保存 IP 地域设置" }),
	).toBeVisible();
});

test("system settings mixed description fields keep switch controls aligned", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1536, height: 900 });
	await openSystemSettings(page);
	await selectSettingsTab(page, "头像与公开接口");
	await ensureSwitchState(page, "外部头像 URL", true);
	await expect(page.getByText("头像接口地址")).toBeVisible();
	await expectFieldRowsAligned(page, ["外部头像 URL", "头像接口地址"]);
	await expectFieldControlsNearlyAligned(
		page,
		["外部头像 URL", "头像接口地址"],
		3,
	);
	await expectFieldControlGap(page, "外部头像 URL", 14);

	await selectSettingsTab(page, "邮件");
	await ensureSwitchState(page, "系统邮件", true);
	await expect(page.getByText("SMTP Host", { exact: true })).toBeVisible();
	await expectFieldRowsAligned(page, ["系统邮件", "SMTP Host"]);
	await expectFieldControlsNearlyAligned(page, ["系统邮件", "SMTP Host"], 3);
	await expectFieldControlGap(page, "SMTP Host", 14);
});

test("system mail test uses saved SMTP settings and synchronous mail endpoint", async ({
	page,
}) => {
	let mailTestCalled = false;
	await page.route("**/api/admin/system-settings/mail/test", async (route) => {
		mailTestCalled = true;
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				status: "sent",
				taskId: "task_mail_e2e",
				deliveryId: "delivery_mail_e2e",
				channel: "email",
				recipient: "admin@localhost.invalid",
				providerMessageId: "smtp-e2e",
				message: "测试邮件已发送。",
			}),
		});
	});

	await openSystemSettings(page);
	await selectSettingsTab(page, "邮件");
	await ensureSwitchState(page, "系统邮件", true);
	await page
		.locator('[data-field-label="SMTP Host"] input')
		.fill(`smtp-${Date.now()}.e2e.test`);
	await page.locator('[data-field-label="SMTP Port"] input').fill("587");
	await page
		.locator('[data-field-label="SMTP 用户名"] input')
		.fill("notify@example.test");
	await page
		.locator('[data-field-label="发件人"] input')
		.fill("notify@example.test");
	await expect(page.getByRole("button", { name: "测试邮件" })).toBeDisabled();
	await expect(page.getByText("请先保存邮件设置")).toBeVisible();

	await page.getByRole("button", { name: "保存邮件设置" }).click();
	await expect(page.getByText("系统设置保存失败")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "测试邮件" })).toBeEnabled();
	await page.getByRole("button", { name: "测试邮件" }).click();
	await expect(page.getByText("测试通知已交给默认邮件发送")).toBeVisible();
	await expect(page.getByText("task_mail_e2e")).toHaveCount(0);
	await expect(page.getByText("delivery_mail_e2e")).toHaveCount(0);
	expect(mailTestCalled).toBe(true);
});

test("system settings captcha provider shows only matching fields", async ({
	page,
}) => {
	await openSystemSettings(page);
	await selectSettingsTab(page, "验证码");
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

test("site settings save failure hides internal ids while retaining diagnostics", async ({
	page,
}) => {
	const apiConsoleErrors: string[] = [];
	page.on("console", (message) => {
		if (
			message.type() !== "error" ||
			!message.text().includes("QingYan Admin API error")
		) {
			return;
		}
		void (async () => {
			const values = await Promise.all(
				message.args().map(async (argument) => {
					try {
						return await argument.jsonValue();
					} catch {
						return message.text();
					}
				}),
			);
			apiConsoleErrors.push(JSON.stringify(values));
		})();
	});

	await page.route("**/api/admin/settings/*/sections/*", async (route) => {
		if (route.request().method() === "PATCH") {
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
	await selectSettingsTab(page, "访客与计数");
	const commentVotesSwitch = page.getByRole("switch", {
		name: "评论投票",
		exact: true,
	});
	const commentVotesChecked = await commentVotesSwitch.evaluate((element) => {
		const maybeInput = element as { checked?: unknown };
		return typeof maybeInput.checked === "boolean"
			? maybeInput.checked
			: element.getAttribute("aria-checked") === "true";
	});
	await ensureSwitchState(page, "评论投票", !commentVotesChecked);
	await page.getByRole("button", { name: "保存访客与计数设置" }).click();
	await expect(page.getByText("站点设置保存失败")).toBeVisible();
	await expect(page.getByText("req_settings_visible")).toHaveCount(0);
	await expect(page.getByText("engagement.commentVotes.enabled")).toHaveCount(
		0,
	);
	await expect(
		page.getByText("必须是 JSON boolean，不能使用 0/1。").first(),
	).toBeVisible();
	await expect
		.poll(() => apiConsoleErrors.join("\n"))
		.toContain("req_settings_visible");
	await expect
		.poll(() => apiConsoleErrors.join("\n"))
		.toContain("engagement.commentVotes.enabled");
});

test("settings save reports unchanged and successful states", async ({
	page,
}) => {
	let sitePatchCount = 0;
	let systemPatchCount = 0;
	await page.route(
		"**/qingyan/api/admin/settings/*/sections/*",
		async (route) => {
			if (route.request().method() === "PATCH") {
				sitePatchCount += 1;
			}
			await route.fallback();
		},
	);
	await page.route(
		"**/qingyan/api/admin/system-settings/sections/*",
		async (route) => {
			if (route.request().method() === "PATCH") {
				systemPatchCount += 1;
			}
			await route.fallback();
		},
	);

	await openSiteSettings(page);
	await page.getByRole("button", { name: "保存评论设置" }).click();
	await expect(page.getByText("配置无变化")).toBeVisible();
	await expect.poll(() => sitePatchCount).toBe(0);

	await selectSettingsTab(page, "访客与计数");
	const pageViewsSwitch = page.getByRole("switch", {
		name: "页面浏览量",
		exact: true,
	});
	const pageViewsChecked = await pageViewsSwitch.evaluate((element) => {
		const maybeInput = element as { checked?: unknown };
		return typeof maybeInput.checked === "boolean"
			? maybeInput.checked
			: element.getAttribute("aria-checked") === "true";
	});
	await ensureSwitchState(page, "页面浏览量", !pageViewsChecked);
	await page.getByRole("button", { name: "保存访客与计数设置" }).click();
	await expect(page.getByText("站点设置已保存")).toBeVisible();
	await expect.poll(() => sitePatchCount).toBe(1);

	await openSystemSettings(page);
	await selectSettingsTab(page, "后台与安全");
	await page.getByRole("button", { name: "保存后台与安全设置" }).click();
	await expect(page.getByText("配置无变化")).toBeVisible();
	await expect.poll(() => systemPatchCount).toBe(0);
});

test("site settings keeps independent counters visible when visitors are off", async ({
	page,
}) => {
	await openSiteSettings(page);
	await selectSettingsTab(page, "访客与计数");
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
	await openSystemSettings(page);
	await selectSettingsTab(page, "邮件");
	await expect(page.getByRole("heading", { name: "系统邮件" })).toBeVisible();
	await ensureSwitchState(page, "系统邮件", false);
	await expect(page.getByText("邮件测试")).toBeVisible();
	await expect(page.getByRole("button", { name: "测试邮件" })).toBeDisabled();
	await expect(page.locator('[data-field-label="SMTP Host"]')).toHaveCount(0);
	await expect(page.getByText("已保存的 SMTP 配置会保留")).toBeVisible();

	await selectSettingsTab(page, "发送服务");
	await expect(page.getByRole("button", { name: "测试邮件" })).toHaveCount(0);
	await expect(page.getByText("到邮件页签测试").first()).toBeVisible();

	await page.getByRole("button", { name: "站点设置" }).click();
	await selectSettingsTab(page, "通知");
	await expect(page.getByRole("heading", { name: "评论通知" })).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "启用评论通知" }),
	).toBeVisible();
});

test("notification channel workflow uses dialogs and shows created test task", async ({
	page,
}) => {
	await openSystemSettings(page);
	await selectSettingsTab(page, "发送服务");

	const channelName = `E2E Webhook ${Date.now()}`;
	await page.getByRole("button", { name: "添加 Webhook" }).click();
	const channelDialog = page.getByRole("dialog", { name: "添加通知渠道" });
	await expect(channelDialog).toBeVisible();
	await channelDialog
		.locator('[data-field-label="名称"] input')
		.fill(channelName);
	await channelDialog
		.locator('[data-field-label="Webhook URL"] input')
		.fill("https://example.test/qingyan-webhook");
	await channelDialog.getByRole("button", { name: "确认" }).click();
	await expect(channelDialog).toHaveCount(0);
	await expect(page.getByText(channelName)).toBeVisible();

	await page.getByRole("button", { name: "保存发送服务设置" }).click();
	await expect(page.getByText("系统设置保存失败")).toHaveCount(0);
	await selectSettingsTab(page, "发送服务");

	const channelRow = page.locator("tr", { hasText: channelName });
	await expect(channelRow).toBeVisible();
	await channelRow.getByRole("button", { name: "测试" }).click();
	const testDialog = page.getByRole("dialog", { name: "测试通知通道" });
	await expect(testDialog).toBeVisible();
	await testDialog
		.locator('[data-field-label="测试收件人 / 目标"] input')
		.fill("webhook-target@example.test");
	await testDialog.getByRole("button", { name: "发送测试通知" }).click();
	await expect(page.getByText("测试通知已交给")).toBeVisible();
});

test("site notification events use independent recipient selectors", async ({
	page,
}) => {
	await openSiteSettings(page);
	await selectSettingsTab(page, "通知");
	await expect(page.getByRole("heading", { name: "新待审评论" })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "直接发布评论" }),
	).toBeVisible();
	await ensureSwitchState(page, "启用评论通知", true);

	const recipientSelectors = page.getByRole("button", {
		name: "选择站点人员",
	});
	await expect(recipientSelectors).toHaveCount(2);
	await recipientSelectors.first().click();
	await expect(
		page.getByRole("textbox", { name: "搜索站点人员" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
});

test("blacklist rules are created from a dialog without leaking cancelled drafts", async ({
	page,
}) => {
	if (!(await isLoggedIn(page))) {
		await login(page);
	}

	await page.getByRole("button", { name: "黑名单", exact: true }).click();
	await expect(page.getByRole("heading", { name: "黑名单" })).toBeVisible();
	await expect(page.getByText("安全规则", { exact: true })).toBeVisible();
	const target = `cancelled-${Date.now()}@example.test`;
	await page.getByRole("button", { name: "新增规则" }).click();
	const dialog = page.getByRole("dialog", { name: "新增黑名单规则" });
	await expect(dialog).toBeVisible();
	await dialog.locator('[data-field-label="目标值"] input').fill(target);
	await dialog.getByRole("button", { name: "取消" }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByText(target)).toHaveCount(0);
});

test("notification template editor selects event, shows placeholders and previews", async ({
	page,
}) => {
	await openSystemSettings(page);
	await selectSettingsTab(page, "发送服务");
	await expect(page.getByText("模板管理")).toBeVisible();

	await page
		.locator('[data-field-label="通知事件"] select')
		.selectOption({ label: "评论回复已通过" });
	await page
		.locator('[data-field-label="通道 / 格式"] select')
		.selectOption({ label: "邮件 / 纯文本" });
	await expect(page.getByText("退订链接")).toBeVisible();
	await expect(page.getByText("评论订阅者")).toBeVisible();

	await page.getByRole("button", { name: "刷新预览" }).click();
	await expect(page.getByText("文本预览")).toBeVisible();
	await expect(page.getByText("Alice")).toBeVisible();
	await page.getByRole("button", { name: "测试发送" }).click();
	const testDialog = page.getByRole("dialog", { name: "测试发送模板" });
	await expect(testDialog).toBeVisible();
	await expect(
		testDialog.getByText("发送一条真实测试通知，结果可在任务中心查看。"),
	).toBeVisible();
	await expect(testDialog.getByText("template_test")).toHaveCount(0);
	await testDialog.getByRole("button", { name: "取消" }).click();
	await expect(testDialog).toHaveCount(0);
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
	await expect(page.getByText("评论审核策略", { exact: true })).toHaveCount(0);
	await expect(page.getByText("验证码模式")).toHaveCount(0);

	await ensureSwitchState(page, "评论", true);
	await expect(page.getByText("默认状态")).toHaveCount(0);
	await expect(page.getByText("审核模式")).toHaveCount(0);
	await expect(page.getByText("评论审核策略", { exact: true })).toBeVisible();
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
	const moderationBox = await page
		.getByText("评论审核策略", { exact: true })
		.boundingBox();
	const captchaBox = await page.getByText("验证码模式").boundingBox();

	if (!groupBox || !moderationBox || !captchaBox) {
		throw new Error("Expected comment group and field labels to have bounds.");
	}
	expect(moderationBox.x).toBeGreaterThanOrEqual(groupBox.x);
	expect(moderationBox.x + moderationBox.width).toBeLessThanOrEqual(
		groupBox.x + groupBox.width,
	);
	expect(captchaBox.x).toBeGreaterThanOrEqual(groupBox.x);
	expect(captchaBox.x + captchaBox.width).toBeLessThanOrEqual(
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
	await expect(page.getByText("评论审核策略", { exact: true })).toBeVisible();
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
				executor: "./scripts/update.sh",
				description: "使用 Docker Compose 更新脚本执行程序更新。",
				estimatedRestartSeconds: {
					min: 30,
					max: 60,
				},
				steps: ["创建升级前整站备份", "应用数据升级"],
				manualCommands: ["./scripts/update.sh"],
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
	await expect(page.getByText("compose-script")).toBeVisible();
	await expect(page.getByText("更新检测")).toBeVisible();
	await expect(page.getByText("GitHub Release / Virace/QingYan")).toBeVisible();

	await page.getByRole("button", { name: "检查更新" }).click();
	await expect(page.getByText("尚未发布 Release")).toBeVisible();
	await expect(page.getByText("当前仓库尚未发布首个 Release")).toBeVisible();
	await page.getByRole("button", { name: "查看更新计划" }).click();
	await expect(
		page.getByRole("heading", { name: "更新执行计划" }),
	).toBeVisible();
	await expect(page.getByText("创建升级前整站备份")).toBeVisible();
	await expect(page.getByText("应用数据升级")).toBeVisible();

	await page.getByRole("button", { name: "数据升级预检" }).click();
	await expect(
		page.getByRole("heading", { name: "数据库升级检查" }),
	).toBeVisible();
	const upgradeCheck = page
		.getByRole("heading", { name: "数据库升级检查" })
		.locator("..");
	await expect(upgradeCheck).toContainText('"state": "normal_current"');
	await expect(upgradeCheck).toContainText("systemctl status qingyan.service");
});
