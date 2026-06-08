import { randomBytes } from "node:crypto";

import { assertAdminConsolePath } from "../../config/admin-console-path";

const PATH_ALPHABET =
	"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function randomSegment(length: number): string {
	let value = "";
	const bytes = randomBytes(length);
	for (const byte of bytes) {
		value += PATH_ALPHABET[byte % PATH_ALPHABET.length];
	}
	return value;
}

export function createAdminConsolePath(): string {
	const pathname = `/qy-${randomSegment(12)}`;
	assertAdminConsolePath(pathname);
	return pathname;
}
