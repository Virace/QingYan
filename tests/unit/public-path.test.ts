import { describe, expect, it } from "vitest";

import {
	buildPublicUrl,
	joinPublicPath,
	normalizePublicPath,
	qingyanCookiePath,
} from "../../src/config/public-path";

describe("public path helpers", () => {
	it.each([
		[undefined, "/qingyan"],
		["", "/qingyan"],
		["qingyan", "/qingyan"],
		["/qingyan", "/qingyan"],
		["qingyan/", "/qingyan"],
		["/qingyan/", "/qingyan"],
		["qingyan/api", "/qingyan/api"],
		["/qingyan/api/", "/qingyan/api"],
	])("normalizes %s to %s", (input, expected) => {
		expect(normalizePublicPath(input)).toBe(expected);
	});

	it.each([
		"/",
		"//",
		"///",
		"qingyan//api",
		"//qingyan",
		"/../api",
		"/qingyan?x=1",
		"/qingyan#top",
		"/qingyan/%2Fapi",
		"/qingyan\\api",
	])("rejects unsafe publicPath %s", (input) => {
		expect(() => normalizePublicPath(input)).toThrow(/server.publicPath/);
	});

	it("joins external paths by URL path segment", () => {
		expect(joinPublicPath("/qingyan", "/api/comments")).toBe(
			"/qingyan/api/comments",
		);
		expect(joinPublicPath("/qingyan/", "api/comments/")).toBe(
			"/qingyan/api/comments",
		);
	});

	it("derives the cookie path from the normalized public path", () => {
		expect(qingyanCookiePath("/qingyan")).toBe("/qingyan");
	});

	it("builds full public URLs without dropping the public path", () => {
		expect(buildPublicUrl("https://x-item.com", "/qingyan", "/admin")).toBe(
			"https://x-item.com/qingyan/admin",
		);
		expect(buildPublicUrl("https://x-item.com/", "/qingyan", "/admin")).toBe(
			"https://x-item.com/qingyan/admin",
		);
	});
});
