import { describe, expect, it } from "vitest";

import {
	buildGravatarUrl,
	normalizeGravatarBaseUrl,
} from "../../src/modules/comments/gravatar";

const aliceHash =
	"ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976";

describe("comment Gravatar URL", () => {
	it("does not return a URL when disabled", () => {
		expect(
			buildGravatarUrl({
				enabled: false,
				emailHash: aliceHash,
				baseUrl: "https://gravatar.com/avatar",
			}),
		).toBeUndefined();
	});

	it("does not return a URL without an email hash", () => {
		expect(
			buildGravatarUrl({
				enabled: true,
				emailHash: null,
				baseUrl: "https://gravatar.com/avatar",
			}),
		).toBeUndefined();
	});

	it("builds the default Gravatar URL with fixed public parameters", () => {
		expect(
			buildGravatarUrl({
				enabled: true,
				emailHash: aliceHash,
				baseUrl: "https://gravatar.com/avatar",
				size: 80,
				defaultImage: "404",
				rating: "g",
				forceDefault: false,
			}),
		).toBe(`https://gravatar.com/avatar/${aliceHash}?s=80&d=404&r=g`);
	});

	it("builds Gravatar URL with configured public parameters", () => {
		expect(
			buildGravatarUrl({
				enabled: true,
				emailHash: aliceHash,
				baseUrl: "https://gravatar.com/avatar",
				size: 160,
				defaultImage: "identicon",
				rating: "pg",
				forceDefault: true,
			}),
		).toBe(
			`https://gravatar.com/avatar/${aliceHash}?s=160&d=identicon&r=pg&f=y`,
		);
	});

	it("normalizes a mirror base URL before building", () => {
		expect(normalizeGravatarBaseUrl("https://cravatar.cn/avatar/")).toBe(
			"https://cravatar.cn/avatar",
		);
		expect(
			buildGravatarUrl({
				enabled: true,
				emailHash: aliceHash,
				baseUrl: "https://cravatar.cn/avatar/",
				size: 80,
				defaultImage: "404",
				rating: "g",
				forceDefault: false,
			}),
		).toBe(`https://cravatar.cn/avatar/${aliceHash}?s=80&d=404&r=g`);
	});

	it("rejects non-http avatar base URLs", () => {
		expect(() => normalizeGravatarBaseUrl("file:///tmp/avatar")).toThrow(
			"Gravatar base URL must use http or https",
		);
		expect(() => normalizeGravatarBaseUrl("/avatar")).toThrow(
			"Invalid Gravatar base URL",
		);
	});
});
