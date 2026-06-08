import { describe, expect, it } from "vitest";

import { resolvePageKey } from "../../../src/modules/import-export/wordpress/page-key";

const baseInput = {
	wpPostId: "123",
	postType: "post" as const,
	sourcePath: "/abc/post/",
	sourceRelativePath: "post/",
	strategy: "path_without_leading_slash" as const,
};

describe("resolvePageKey", () => {
	it("prefers explicit mapping by WordPress post ID", () => {
		expect(
			resolvePageKey({
				...baseInput,
				mapping: {
					items: [
						{
							wpPostId: "123",
							decision: "map",
							target: { pageKey: "mapped", pageUrl: "/mapped" },
						},
					],
				},
			}),
		).toMatchObject({
			decision: "map",
			pageKey: "mapped",
			confidence: 100,
			source: "explicit_mapping",
		});
	});

	it("supports explicit mapping by source relative path", () => {
		expect(
			resolvePageKey({
				...baseInput,
				mapping: {
					items: [
						{
							sourceRelativePath: "post/",
							decision: "map",
							target: { pageKey: "by-path" },
						},
					],
				},
			}),
		).toMatchObject({ pageKey: "by-path" });
	});

	it("requires mapping for explicit_only strategy", () => {
		expect(
			resolvePageKey({
				...baseInput,
				strategy: "explicit_only",
			}),
		).toMatchObject({
			decision: "needs_user_mapping",
			reason: "explicit_mapping_required",
		});
	});

	it("applies leading slash strategies", () => {
		expect(
			resolvePageKey({ ...baseInput, strategy: "path_with_leading_slash" }),
		).toMatchObject({
			pageKey: "/post/",
			pageUrl: "/post/",
		});
	});

	it("renders custom templates", () => {
		expect(
			resolvePageKey({
				...baseInput,
				strategy: "custom_template",
				postPathTemplate: "wp/%wpPostId%/%sourceRelativePath%",
			}),
		).toMatchObject({
			pageKey: "wp/123/post/",
			pageUrl: "/wp/123/post/",
		});
	});
});
