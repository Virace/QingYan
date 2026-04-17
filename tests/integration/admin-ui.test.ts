import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin ui", () => {
	it("serves the admin shell at /admin", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/admin",
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
		expect(response.body).toContain("QingYan Admin");
		expect(response.body).toContain("Admin Token");
		expect(response.body).toContain("评论管理");
		expect(response.body).toContain("页面管理");
		expect(response.body).toContain("用户管理");
		expect(response.body).toContain("访客管理");
		expect(response.body).toContain("站点管理");
	});

	it("inlines admin login captcha flow and management endpoints", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "GET",
			url: "/admin",
		});

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("/api/admin/session/me");
		expect(response.body).toContain("/api/admin/session/captcha");
		expect(response.body).toContain("/api/admin/session/login");
		expect(response.body).toContain("/api/admin/comments");
		expect(response.body).toContain("/api/admin/pages");
		expect(response.body).toContain("/api/admin/users");
		expect(response.body).toContain("/api/admin/visitors");
		expect(response.body).toContain("/api/admin/blacklist");
		expect(response.body).toContain("/api/admin/sites");
		expect(response.body).toContain("/api/admin/settings");
		expect(response.body).toContain("管理员登录验证码");
		expect(response.body).toContain("从第 N 次写操作开始要求验证码");
		expect(response.body).toContain("pageUrl");
		expect(response.body).toContain("identity.require");
		expect(response.body).toContain("开启评论功能");
		expect(response.body).toContain("允许作者提交站点链接");
		expect(response.body).toContain("开启邮件通知");
		expect(response.body).toContain("用于通知、回访和用户聚合");
	});
});
