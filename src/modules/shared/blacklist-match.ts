function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeEmail(email?: string): string | undefined {
	return email?.trim().toLowerCase();
}

function wildcardToRegExp(pattern: string): RegExp {
	const source = pattern
		.split("*")
		.map((part) => escapeRegExp(part))
		.join(".*");
	return new RegExp(`^${source}$`, "i");
}

function parseIpv4(ip: string): number | null {
	const parts = ip.split(".");
	if (parts.length !== 4) {
		return null;
	}

	const octets = parts.map((part) => Number(part));
	if (
		octets.some(
			(octet) =>
				Number.isNaN(octet) ||
				octet < 0 ||
				octet > 255 ||
				!Number.isInteger(octet),
		)
	) {
		return null;
	}

	return octets.reduce(
		(accumulator, octet) => ((accumulator << 8) | octet) >>> 0,
		0,
	);
}

function isIpInCidr(ip: string, cidr: string): boolean {
	const [network, prefixText] = cidr.split("/");
	if (!network || !prefixText) {
		return false;
	}

	const ipNumber = parseIpv4(ip);
	const networkNumber = parseIpv4(network);
	const prefix = Number(prefixText);
	if (
		ipNumber === null ||
		networkNumber === null ||
		!Number.isInteger(prefix) ||
		prefix < 0 ||
		prefix > 32
	) {
		return false;
	}

	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (ipNumber & mask) === (networkNumber & mask);
}

export interface BlacklistRuleMatchInput {
	targetType: string;
	targetValue: string;
	matchMode: string;
}

export interface BlacklistSubject {
	ip?: string;
	email?: string;
	visitorKey?: string;
}

export function matchBlacklistRule(
	rule: BlacklistRuleMatchInput,
	subject: BlacklistSubject,
): boolean {
	if (rule.targetType === "visitor") {
		return subject.visitorKey === rule.targetValue;
	}

	if (rule.targetType === "email") {
		const email = normalizeEmail(subject.email);
		if (!email) {
			return false;
		}

		return rule.matchMode === "wildcard"
			? wildcardToRegExp(rule.targetValue).test(email)
			: email === normalizeEmail(rule.targetValue);
	}

	if (rule.targetType === "ip") {
		if (!subject.ip) {
			return false;
		}

		return rule.matchMode === "cidr"
			? isIpInCidr(subject.ip, rule.targetValue)
			: subject.ip === rule.targetValue;
	}

	return false;
}
