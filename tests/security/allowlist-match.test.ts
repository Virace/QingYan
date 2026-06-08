import { describe, expect, it } from "vitest";

import { matchAllowlistRule } from "../../src/modules/shared/allowlist-match";

describe("matchAllowlistRule", () => {
	it("matches exact IP rules", () => {
		expect(
			matchAllowlistRule(
				{
					targetType: "ip",
					matchMode: "exact",
					targetValue: "203.0.113.9",
				},
				{
					ip: "203.0.113.9",
				},
			),
		).toBe(true);
		expect(
			matchAllowlistRule(
				{
					targetType: "ip",
					matchMode: "exact",
					targetValue: "203.0.113.9",
				},
				{
					ip: "203.0.113.10",
				},
			),
		).toBe(false);
	});

	it("matches IPv4 CIDR rules", () => {
		expect(
			matchAllowlistRule(
				{
					targetType: "ip",
					matchMode: "cidr",
					targetValue: "192.168.12.0/24",
				},
				{
					ip: "192.168.12.25",
				},
			),
		).toBe(true);
		expect(
			matchAllowlistRule(
				{
					targetType: "ip",
					matchMode: "cidr",
					targetValue: "192.168.12.0/24",
				},
				{
					ip: "192.168.13.25",
				},
			),
		).toBe(false);
	});

	it("matches exact email rules case-insensitively", () => {
		expect(
			matchAllowlistRule(
				{
					targetType: "email",
					matchMode: "exact",
					targetValue: "author@example.com",
				},
				{
					email: "Author@Example.COM",
				},
			),
		).toBe(true);
	});

	it("matches email domain rules", () => {
		expect(
			matchAllowlistRule(
				{
					targetType: "email",
					matchMode: "domain",
					targetValue: "example.com",
				},
				{
					email: "writer@example.com",
				},
			),
		).toBe(true);
		expect(
			matchAllowlistRule(
				{
					targetType: "email",
					matchMode: "domain",
					targetValue: "example.com",
				},
				{
					email: "writer@sub.example.com",
				},
			),
		).toBe(false);
	});

	it("matches visitor exact rules", () => {
		expect(
			matchAllowlistRule(
				{
					targetType: "visitor",
					matchMode: "exact",
					targetValue: "visitor-1",
				},
				{
					visitorKey: "visitor-1",
				},
			),
		).toBe(true);
	});

	it("does not match invalid CIDR rules", () => {
		expect(
			matchAllowlistRule(
				{
					targetType: "ip",
					matchMode: "cidr",
					targetValue: "192.168.12.0/33",
				},
				{
					ip: "192.168.12.25",
				},
			),
		).toBe(false);
	});
});
