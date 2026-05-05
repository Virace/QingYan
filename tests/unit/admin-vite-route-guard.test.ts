import { describe, expect, it } from "vitest";

import {
	isAllowedAdminHtmlPath,
	resolveAdminDevPaths,
} from "../../apps/admin/route-guard";

describe("admin vite route guard", () => {
	it("defaults to the configured /admin development entry only", () => {
		expect(resolveAdminDevPaths({})).toEqual(["/admin"]);

		expect(isAllowedAdminHtmlPath("/admin", ["/admin"])).toBe(true);
		expect(isAllowedAdminHtmlPath("/admin/", ["/admin"])).toBe(true);
		expect(isAllowedAdminHtmlPath("/", ["/admin"])).toBe(false);
		expect(isAllowedAdminHtmlPath("/admin/install", ["/admin"])).toBe(false);
		expect(isAllowedAdminHtmlPath("/anything", ["/admin"])).toBe(false);
	});

	it("allows only the configured hidden entry and explicit dev alias", () => {
		const paths = resolveAdminDevPaths({
			QINGYAN_ADMIN_DEV_PATHS: "/hidden-admin,/admin",
		});

		expect(paths).toEqual(["/hidden-admin", "/admin"]);
		expect(isAllowedAdminHtmlPath("/hidden-admin", paths)).toBe(true);
		expect(isAllowedAdminHtmlPath("/hidden-admin/", paths)).toBe(true);
		expect(isAllowedAdminHtmlPath("/admin", paths)).toBe(true);
		expect(isAllowedAdminHtmlPath("/admin/install", paths)).toBe(false);
		expect(isAllowedAdminHtmlPath("/", paths)).toBe(false);
	});
});
