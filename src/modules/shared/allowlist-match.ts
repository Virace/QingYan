function normalizeEmail(email?: string): string | undefined {
	return email?.trim().toLowerCase();
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

export interface AllowlistRuleMatchInput {
	targetType: string;
	targetValue: string;
	matchMode: string;
}

export interface AllowlistSubject {
	ip?: string;
	email?: string;
	visitorKey?: string;
}

export function matchAllowlistRule(
	rule: AllowlistRuleMatchInput,
	subject: AllowlistSubject,
): boolean {
	if (rule.targetType === "visitor") {
		return (
			rule.matchMode === "exact" && subject.visitorKey === rule.targetValue
		);
	}

	if (rule.targetType === "email") {
		const email = normalizeEmail(subject.email);
		if (!email) {
			return false;
		}

		if (rule.matchMode === "domain") {
			const domain = normalizeEmail(rule.targetValue);
			return Boolean(domain) && email.endsWith(`@${domain}`);
		}

		return (
			rule.matchMode === "exact" && email === normalizeEmail(rule.targetValue)
		);
	}

	if (rule.targetType === "ip") {
		if (!subject.ip) {
			return false;
		}

		if (rule.matchMode === "cidr") {
			return isIpInCidr(subject.ip, rule.targetValue);
		}

		return rule.matchMode === "exact" && subject.ip === rule.targetValue;
	}

	return false;
}
