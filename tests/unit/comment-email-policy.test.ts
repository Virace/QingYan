import { describe, expect, it } from "vitest";
import {
	emailPolicySchema,
	evaluateEmailPolicy,
	normalizeCommentEmail,
	normalizedEmailSchema,
	isNumericComment,
} from "../../src/modules/comments/email-policy";

describe("comment email policy", () => {
	it("normalizes case and internationalized domains before matching", () => {
		expect(normalizeCommentEmail(" Alice@例子.公司 ")).toBe(
			"alice@xn--fsqu00a.xn--55qx5d",
		);
		const policy = emailPolicySchema.parse({
			denied: [{ type: "domain", value: " 例子.公司 " }],
		});
		expect(
			evaluateEmailPolicy({ email: "Alice@xn--fsqu00a.xn--55qx5d", policy })
				.result,
		).toBe("denied");
		expect(normalizeCommentEmail(" Visitor@😀.COM ")).toBe(
			"visitor@xn--e28h.com",
		);
	});
	it("matches exact domains and only explicitly included subdomains", () => {
		const exact = emailPolicySchema.parse({
			denied: [{ type: "domain", value: "gmail.com" }],
		});
		for (const email of [
			"a@notgmail.com",
			"a@gmail.com.example.org",
			"a@mail.gmail.com",
		])
			expect(evaluateEmailPolicy({ email, policy: exact }).result).toBe(
				"allowed",
			);
		expect(
			evaluateEmailPolicy({ email: "a@gmail.com", policy: exact }).result,
		).toBe("denied");
		const nested = emailPolicySchema.parse({
			denied: [{ type: "domain", value: "gmail.com", includeSubdomains: true }],
		});
		expect(
			evaluateEmailPolicy({ email: "a@mail.gmail.com", policy: nested }).result,
		).toBe("denied");
	});
	it("keeps protected identities and denials above ordinary allow rules", () => {
		const policy = emailPolicySchema.parse({
			mode: "allow_selected",
			allowed: [{ type: "domain", value: "x-item.com" }],
			denied: [{ type: "email", value: "denied@x-item.com" }],
			protectedDomains: [{ value: "x-item.com" }],
		});
		expect(
			evaluateEmailPolicy({ email: "owner@x-item.com", policy }).result,
		).toBe("login_required");
		expect(
			evaluateEmailPolicy({
				email: "owner@x-item.com",
				policy,
				authenticated: true,
			}).result,
		).toBe("allowed");
		const guestPolicy = emailPolicySchema.parse({
			...policy,
			protectedDomains: [],
		});
		expect(
			evaluateEmailPolicy({ email: "denied@x-item.com", policy: guestPolicy })
				.result,
		).toBe("denied");
		expect(
			evaluateEmailPolicy({ email: "a@elsewhere.org", policy: guestPolicy })
				.result,
		).toBe("denied");
		expect(evaluateEmailPolicy({ policy: guestPolicy }).result).toBe("allowed");
	});
	it("rejects empty allow-only policies and nonliteral rules", () => {
		expect(
			emailPolicySchema.safeParse({ mode: "allow_selected", allowed: [] })
				.success,
		).toBe(false);
		for (const value of [
			"",
			"*.example.org",
			"/example/",
			"https://example.org",
			"example.org/path",
			"example.org?x=1",
			"example.org#frag",
			"example.org\\evil",
			"%65xample.org",
			"exa\tmple.org",
			"exa\nmple.org",
			"127.1",
			"0x7f.1",
		])
			expect(
				emailPolicySchema.safeParse({ denied: [{ type: "domain", value }] })
					.success,
			).toBe(false);
	});
	it.each([
		"visitor@example.org/path",
		"visitor@example.org?x=1",
		"visitor@example.org#frag",
		"visitor@example.org\\evil",
		"visitor@%65xample.org",
		"visitor@exa\tmple.org",
		"visitor@exa\nmple.org",
		"visitor@ example.org",
		"visitor@127.1",
		"visitor@0x7f.1",
	])("rejects mailbox input that host parsing would rewrite: %j", (email) => {
		expect(normalizedEmailSchema.safeParse(email).success).toBe(false);
	});
});

describe("numeric-only comment rejection", () => {
	it.each(["1", "2026", "１２３", " 1 ２\n3 "])("rejects %j", (content) =>
		expect(isNumericComment(content)).toBe(true));
	it.each([
		"OK",
		"Thanks",
		"谢谢",
		"编号 123",
		"const n = 1;",
		" ",
	])("leaves %j to the normal validator and moderation", (content) =>
		expect(isNumericComment(content)).toBe(false));
});
