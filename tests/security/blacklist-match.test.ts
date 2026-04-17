import { describe, expect, it } from "vitest";

import { matchBlacklistRule } from "../../src/modules/shared/blacklist-match";

describe("matchBlacklistRule", () => {
	it("matches CIDR ip rules", () => {
		expect(
			matchBlacklistRule(
				{
					targetType: "ip",
					matchMode: "cidr",
					targetValue: "192.168.0.0/24",
				},
				{
					ip: "192.168.0.22",
				},
			),
		).toBe(true);
	});

	it("matches email wildcard rules", () => {
		expect(
			matchBlacklistRule(
				{
					targetType: "email",
					matchMode: "wildcard",
					targetValue: "*@spam.test",
				},
				{
					email: "bot@spam.test",
				},
			),
		).toBe(true);
	});
});
