import { describe, expect, it } from "vitest";

import { normalizeSourcePath } from "../../../src/modules/import-export/wordpress/source-path";

describe("normalizeSourcePath", () => {
	it("uses root source base path by default", () => {
		expect(
			normalizeSourcePath("https://x-item.com/termux.html", "/"),
		).toMatchObject({
			sourcePath: "/termux.html",
			sourceRelativePath: "termux.html",
			valid: true,
			warnings: [],
		});
	});

	it("strips configured WordPress subdirectory only at path boundary", () => {
		expect(
			normalizeSourcePath("https://a.com/abc/2021/09/07/9954/", "/abc/"),
		).toMatchObject({
			sourcePath: "/abc/2021/09/07/9954/",
			sourceRelativePath: "2021/09/07/9954/",
			valid: true,
		});
	});

	it("does not strip a partial path segment", () => {
		expect(
			normalizeSourcePath("https://a.com/abcde/post/", "/abc/"),
		).toMatchObject({
			sourcePath: "/abcde/post/",
			sourceRelativePath: "abcde/post/",
			warnings: ["source_base_path_not_matched"],
		});
	});

	it("marks invalid URLs as not valid", () => {
		expect(normalizeSourcePath("not a url", "/")).toMatchObject({
			sourcePath: "",
			sourceRelativePath: "",
			valid: false,
			warnings: ["invalid_source_url"],
		});
	});
});
