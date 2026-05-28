import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
	buildExternalAvatarUrl,
	normalizeExternalAvatarBaseUrl,
	validateExternalAvatarQuery,
} from "../../src/modules/comments/gravatar";

const aliceEmail = "Alice@Example.COM ";
const aliceNormalizedEmail = "alice@example.com";
const aliceSha256 = createHash("sha256")
	.update(aliceNormalizedEmail)
	.digest("hex");
const aliceMd5 = createHash("md5").update(aliceNormalizedEmail).digest("hex");

describe("external avatar URL", () => {
	it("does not return a URL when disabled", () => {
		expect(
			buildExternalAvatarUrl({
				enabled: false,
				email: aliceEmail,
				baseUrl: "https://gravatar.com/avatar",
				hashAlgorithm: "sha256",
				query: "s=80&d=404&r=g",
			}),
		).toBeUndefined();
	});

	it("does not return a URL without an email", () => {
		expect(
			buildExternalAvatarUrl({
				enabled: true,
				email: null,
				baseUrl: "https://gravatar.com/avatar",
				hashAlgorithm: "sha256",
				query: "s=80&d=404&r=g",
			}),
		).toBeUndefined();
	});

	it("builds the default SHA-256 Gravatar-compatible URL", () => {
		expect(
			buildExternalAvatarUrl({
				enabled: true,
				email: aliceEmail,
				baseUrl: "https://gravatar.com/avatar",
				hashAlgorithm: "sha256",
				query: "s=80&d=404&r=g",
			}),
		).toBe(`https://gravatar.com/avatar/${aliceSha256}?s=80&d=404&r=g`);
	});

	it("builds an MD5 Cravatar-style URL", () => {
		expect(
			buildExternalAvatarUrl({
				enabled: true,
				email: aliceEmail,
				baseUrl: "https://cravatar.cn/avatar/",
				hashAlgorithm: "md5",
				query: "s=160&d=identicon&f=y",
			}),
		).toBe(`https://cravatar.cn/avatar/${aliceMd5}?s=160&d=identicon&f=y`);
	});

	it("omits the question mark for an empty query", () => {
		expect(
			buildExternalAvatarUrl({
				enabled: true,
				email: aliceEmail,
				baseUrl: "https://gravatar.com/avatar/",
				hashAlgorithm: "sha256",
				query: "",
			}),
		).toBe(`https://gravatar.com/avatar/${aliceSha256}`);
	});

	it("normalizes endpoint base URLs", () => {
		expect(normalizeExternalAvatarBaseUrl("https://cravatar.cn/avatar/")).toBe(
			"https://cravatar.cn/avatar",
		);
	});

	it("rejects non-http avatar base URLs", () => {
		expect(() => normalizeExternalAvatarBaseUrl("file:///tmp/avatar")).toThrow(
			"External avatar base URL must use http or https",
		);
		expect(() => normalizeExternalAvatarBaseUrl("/avatar")).toThrow(
			"Invalid external avatar base URL",
		);
	});

	it("rejects query strings with a leading question mark", () => {
		expect(() => validateExternalAvatarQuery("?s=80&d=404")).toThrow(
			"External avatar query must not start with ?",
		);
	});

	it("rejects query strings with fragments or whitespace", () => {
		expect(() => validateExternalAvatarQuery("s=80#frag")).toThrow(
			"External avatar query must not include #",
		);
		expect(() => validateExternalAvatarQuery("s=80&d=bad value")).toThrow(
			"External avatar query must not include whitespace",
		);
	});
});
