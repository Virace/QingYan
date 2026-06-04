import { describe, expect, it } from "vitest";

import {
	deriveCanonicalPageKeyFromPathname,
	deriveCanonicalPageKeyFromUrl,
} from "../../src/modules/shared/canonical-page-key";

describe("canonical page key", () => {
	it.each([
		["/", "/"],
		["", "/"],
		["/posts/a/", "/posts/a/"],
		["/posts/a", "/posts/a"],
		["/A//B/", "/A//B/"],
		["posts/a/", "/posts/a/"],
	])("derives canonical key from pathname %s", (pathname, expected) => {
		expect(deriveCanonicalPageKeyFromPathname(pathname)).toBe(expected);
	});

	it("derives canonical key from URL pathname only", () => {
		expect(
			deriveCanonicalPageKeyFromUrl("https://x-item.com/posts/a/?q=1#top"),
		).toBe("/posts/a/");
		expect(
			deriveCanonicalPageKeyFromUrl(
				new URL("https://x-item.com/lol_voice_collation.html?from=rss"),
			),
		).toBe("/lol_voice_collation.html");
	});
});
