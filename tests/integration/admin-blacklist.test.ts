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
			url: "/api/admin/blacklist",
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
			url: "/api/admin/blacklist?siteKey=fangyuan",
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
			url: `/api/admin/blacklist/${ruleId}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
		});
		expect(deleteResponse.statusCode).toBe(200);
		expect(deleteResponse.json()).toMatchObject({
			rule: {
				id: ruleId,
			},
		});
	});
});
