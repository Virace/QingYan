import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { canonicalJson } from "../../db/values";
import type { WafAclRule } from "./gateway-client";

export function managedWafRule(penalty: {
	id: string;
	ip: string;
}): WafAclRule {
	if (!isIP(penalty.ip)) throw new Error("WAF_IP_INVALID");
	return {
		name: `qingyan-${penalty.id}`,
		rule: "",
		state: "on",
		description: `QingYan managed penalty ${penalty.id}`,
		conditions: [{ field: "IP", pattern: "eq", rule: penalty.ip, name: "" }],
		action: "deny",
		type: "acl",
		code: 403,
		ipBlock: "off",
		ipBlockTime: 600,
		res: "",
		expireTime: 24,
		unit: "h",
	};
}

export function wafRuleFingerprint(rule: WafAclRule) {
	return createHash("sha256").update(canonicalJson(rule)).digest("hex");
}

export function isKnownScan(log: {
	execRule: string;
	uri: string;
	action: string;
}) {
	return (
		log.action === "deny" &&
		["urlBlack", "defaultUrlBlack"].includes(log.execRule) &&
		/^(?:\/[^?]*\.php(?:[/?]|$)|\/(?:\.env|\.git(?:[/?]|$)|wp-admin(?:[/?]|$)|wp-login\.php(?:[/?]|$)))/iu.test(
			log.uri,
		)
	);
}
