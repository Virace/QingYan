import { createHash } from "node:crypto";

const blockedObviousAddresses = new Set([
	"root@root.root",
	"test@test.test",
	"admin@admin.admin",
	"a@a.a",
]);

export function normalizeNotificationEmail(value?: string | null): string {
	return (value ?? "").trim().toLowerCase();
}

export function hashNotificationEmail(value?: string | null): string | null {
	const normalized = normalizeNotificationEmail(value);
	if (!normalized) {
		return null;
	}

	return createHash("sha256").update(normalized).digest("hex");
}

export function isAcceptableNotificationEmail(value?: string | null): boolean {
	const email = normalizeNotificationEmail(value);
	if (!email || blockedObviousAddresses.has(email)) {
		return false;
	}

	const parts = email.split("@");
	if (parts.length !== 2) {
		return false;
	}

	const [local, domain] = parts;
	if (!local || !domain?.includes(".")) {
		return false;
	}

	const labels = domain.split(".");
	const tld = labels.at(-1) ?? "";
	if (labels.some((label) => !label) || tld.length < 2) {
		return false;
	}

	return true;
}
