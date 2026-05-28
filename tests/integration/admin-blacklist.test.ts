import { afterEach, describe, expect, it } from "vitest";

import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("admin blacklist", () => {
	it("creates, lists and deletes blacklist rules", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		const createResponse = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/blacklist",
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				siteKey: "fangyuan",
				targetType: "email",
				matchMode: "wildcard",
				targetValue: "*@spam.test",
				scope: "all",
				reason: "wildcard ban",
			},
		});
		expect(createResponse.statusCode).toBe(200);
		expect(createResponse.json()).toMatchObject({
			rule: {
				targetType: "email",
				targetValue: "*@spam.test",
				matchMode: "wildcard",
				scope: "all",
			},
		});
		const ruleId = createResponse.json().rule.id as number;

		const listResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/blacklist?siteKey=fangyuan",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(listResponse.statusCode).toBe(200);
		expect(listResponse.json()).toMatchObject({
			items: [
				{
					id: ruleId,
					targetType: "email",
					matchMode: "wildcard",
					scope: "all",
				},
			],
		});

		const deleteResponse = await fixture.app.inject({
			method: "DELETE",
			url: `/qingyan/api/admin/blacklist/${ruleId}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});
		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			rule: {
				id: ruleId,
			},
		});
	});

	it("paginates and searches blacklist rules", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const { adminCookie, csrfToken } = await loginAsAdmin(fixture.app);

		for (const [index, payload] of [
			{
				targetType: "email",
				matchMode: "exact",
				targetValue: "first@spam.test",
				reason: "first rule",
			},
			{
				targetType: "ip",
				matchMode: "exact",
				targetValue: "203.0.113.20",
				reason: "needle network",
			},
			{
				targetType: "visitor",
				matchMode: "exact",
				targetValue: "visitor_blacklist_3",
				reason: "third rule",
			},
		].entries()) {
			const response = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/blacklist",
				...withAdminWriteAuth({ adminCookie, csrfToken }),
				payload: {
					siteKey: "fangyuan",
					scope: index === 0 ? "all" : "post",
					...payload,
				},
			});
			expect(response.statusCode).toBe(200);
		}

		const pageResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/blacklist?siteKey=fangyuan&limit=1&offset=1",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(pageResponse.statusCode).toBe(200);
		expect(pageResponse.json()).toMatchObject({
			items: [
				{
					targetValue: "203.0.113.20",
				},
			],
			pagination: {
				limit: 1,
				offset: 1,
				totalCount: 3,
			},
		});

		const searchResponse = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/api/admin/blacklist?siteKey=fangyuan&search=needle",
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
		});
		expect(searchResponse.statusCode).toBe(200);
		expect(searchResponse.json()).toMatchObject({
			items: [
				{
					targetType: "ip",
					targetValue: "203.0.113.20",
				},
			],
			pagination: {
				totalCount: 1,
			},
		});
	});
});
