import path from "node:path";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
	adminUsers,
	securityPenalties,
	siteSettings,
} from "../../src/db/schema";
import { readAbusePolicy } from "../../src/modules/comments/abuse-policy";
import { AbuseRepository } from "../../src/modules/comments/abuse-repository";
import { loginAsAdmin } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

test("email policy drafts, local review and penalty recovery use persisted server state", async ({
	page,
}, testInfo) => {
	test.setTimeout(90000);
	const address = "http://127.0.0.1:4417";
	const fixture = await createTestApp({
		adminDistDirectory: path.resolve("dist/admin"),
		mutateConfig: (config) => {
			config.server.publicBaseUrl = address;
			config.security.adminOriginGuard.allowedOrigins = [address];
		},
	});
	try {
		const site = fixture.app.siteRegistry.getRegisteredSite("fangyuan");
		if (!site) throw new Error("Expected fixture site");
		await fixture.app.db
			.update(siteSettings)
			.set({
				verifiedAuthorJson: JSON.stringify({
					enabled: false,
					displayName: "管理员",
					email: "",
					website: "",
					badgeLabel: "管理员",
				}),
			})
			.where(eq(siteSettings.siteId, site.id));
		const penalties = await Promise.all(
			[70, 71].map((suffix) =>
				new AbuseRepository(fixture.app.db).createPenalty({
					siteId: site.id,
					ip: `203.0.113.${suffix}`,
					scope: "post",
					reason: "rate_limited",
					policy: readAbusePolicy(),
					count: 10,
				}),
			),
		);
		await fixture.app.listen({ host: "127.0.0.1", port: 4417 });
		const { adminCookie } = await loginAsAdmin(fixture.app);
		await page
			.context()
			.addCookies([
				{ name: "qingyan_admin", value: adminCookie.value, url: address },
			]);
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto(`${address}/qingyan/admin/`);
		await page
			.getByRole("navigation")
			.getByRole("button", { name: "站点设置", exact: true })
			.click();
		await page.getByRole("tab", { name: "访客与计数", exact: true }).click();
		const pageViews = page.getByRole("switch", {
			name: "页面浏览量",
			exact: true,
		});
		await expect(pageViews).toHaveAttribute("data-state", "checked");
		await pageViews.click();
		await page.getByRole("tab", { name: "评论", exact: true }).click();
		await page.getByRole("button", { name: "添加禁止项", exact: true }).click();
		await page.getByLabel("禁止项 1 内容", { exact: true }).fill("example.org");
		await page
			.getByLabel("访客邮箱", { exact: true })
			.fill("visitor@example.org");
		const preview = page.waitForResponse((response) =>
			response.url().endsWith("/email-policy/preview"),
		);
		await page.getByRole("button", { name: "预览匹配", exact: true }).click();
		expect((await preview).status()).toBe(200);
		await expect(page.getByText(/草稿结果：该邮箱暂不支持/u)).toBeVisible();
		const [admin] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		await page.getByLabel("访客邮箱", { exact: true }).fill(admin.email);
		await page.getByRole("button", { name: "预览匹配", exact: true }).click();
		await expect(page.getByText(/草稿结果：允许使用/u)).toBeVisible();
		await page
			.getByLabel("站点人员", { exact: true })
			.selectOption(admin.email);
		await expect(
			page.getByText("草稿已变化，请重新预览。", { exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "预览匹配", exact: true }).click();
		await expect(page.getByText(/草稿结果：需要登录后使用/u)).toBeVisible();
		const [beforeSave] = await fixture.app.db
			.select()
			.from(siteSettings)
			.where(eq(siteSettings.siteId, site.id));
		expect(JSON.parse(beforeSave.emailPolicyJson ?? "{}").denied ?? []).toEqual(
			[],
		);
		expect(JSON.parse(beforeSave.verifiedAuthorJson ?? "{}").email).toBe("");
		await page
			.getByLabel("评论审核策略", { exact: true })
			.selectOption("akismet_auto");
		await page
			.getByRole("switch", { name: "Akismet 通过后仍需本地审核", exact: true })
			.click();
		const saved = page.waitForResponse(
			(response) =>
				response.request().method() === "PATCH" &&
				response.url().endsWith("/sections/comments"),
		);
		await page
			.getByRole("button", { name: "保存评论设置", exact: true })
			.click();
		expect((await saved).status()).toBe(200);
		await page.getByRole("tab", { name: "访客与计数", exact: true }).click();
		await expect(pageViews).toHaveAttribute("data-state", "unchecked");
		await page.getByRole("tab", { name: "评论", exact: true }).click();
		await page
			.getByLabel("禁止项 1 内容", { exact: true })
			.fill("invalid-domain");
		const failedSave = page.waitForResponse(
			(response) =>
				response.request().method() === "PATCH" &&
				response.url().endsWith("/sections/comments"),
		);
		await page
			.getByRole("button", { name: "保存评论设置", exact: true })
			.click();
		expect((await failedSave).status()).toBe(400);
		await expect(page.getByLabel("禁止项 1 内容", { exact: true })).toHaveValue(
			"invalid-domain",
		);
		await page.getByRole("tab", { name: "访客与计数", exact: true }).click();
		await expect(pageViews).toHaveAttribute("data-state", "unchecked");
		await page.getByRole("button", { name: "放弃更改", exact: true }).click();
		await page.getByRole("tab", { name: "评论", exact: true }).click();
		await page.getByRole("button", { name: "放弃更改", exact: true }).click();
		await page.reload();
		await expect(page.getByLabel("禁止项 1 内容", { exact: true })).toHaveValue(
			"example.org",
		);
		await expect(
			page.getByRole("switch", {
				name: "Akismet 通过后仍需本地审核",
				exact: true,
			}),
		).toHaveAttribute("data-state", "checked");
		const emailSection = page
			.getByRole("heading", { name: "邮箱使用规则", exact: true })
			.locator("..")
			.locator("..");
		await emailSection.screenshot({
			path: testInfo.outputPath("email-policy-desktop.png"),
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await emailSection.screenshot({
			path: testInfo.outputPath("email-policy-narrow.png"),
		});
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page
			.getByRole("navigation")
			.getByRole("button", { name: "黑名单", exact: true })
			.click();
		for (const [index, kind] of ["revoked", "released"].entries()) {
			const penalty = penalties[index];
			await page
				.getByText(penalty.ip, { exact: true })
				.locator("..")
				.locator("..")
				.getByRole("button", { name: "解除限制", exact: true })
				.click();
			const dialog = page.getByRole("dialog", {
				name: "解除来源限制",
				exact: true,
			});
			await dialog.getByLabel("处理方式", { exact: true }).selectOption(kind);
			await dialog
				.getByLabel("处理原因", { exact: true })
				.fill(
					kind === "revoked"
						? "确认是正常共享出口，撤销本次误判。"
						: "已核对来源，提前恢复访问。",
				);
			if (index === 0) {
				await dialog.screenshot({
					path: testInfo.outputPath("penalty-release-desktop.png"),
				});
				await page.setViewportSize({ width: 390, height: 844 });
				await dialog.screenshot({
					path: testInfo.outputPath("penalty-release-narrow.png"),
				});
			}
			const released = page.waitForResponse(
				(response) =>
					response.request().method() === "POST" &&
					response.url().endsWith(`/${penalty.sourceRuleId}/release`),
			);
			await dialog
				.getByRole("button", {
					name: kind === "revoked" ? "撤销误判" : "解除限制",
					exact: true,
				})
				.click();
			expect((await released).status()).toBe(200);
			await expect(dialog).not.toBeVisible();
			const [stored] = await fixture.app.db
				.select()
				.from(securityPenalties)
				.where(eq(securityPenalties.id, penalty.id));
			expect(stored.releaseKind).toBe(kind);
			await page.setViewportSize({ width: 1440, height: 1000 });
		}
		await page.reload();
		await expect(page.getByText(/已撤销误判/u)).toBeVisible();
		await expect(page.getByText(/已提前解除/u)).toBeVisible();
	} finally {
		await fixture.cleanup();
	}
});
