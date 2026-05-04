import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const PASSWORD_ALPHABET =
	"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function randomText(length: number, alphabet = PASSWORD_ALPHABET): string {
	let value = "";
	const bytes = randomBytes(length);
	for (const byte of bytes) {
		value += alphabet[byte % alphabet.length];
	}
	return value;
}

export function createInitialAdminUsername(): string {
	return `admin_${randomText(8)}`;
}

export function createInitialAdminPassword(): string {
	return randomText(24);
}

export function createPasswordHash(password: string): string {
	const salt = randomBytes(16).toString("hex");
	const key = scryptSync(password, salt, KEY_LENGTH).toString("hex");
	return `scrypt:${salt}:${key}`;
}

export function verifyPasswordHash(
	password: string,
	passwordHash: string,
): boolean {
	const [scheme, salt, expectedKey] = passwordHash.split(":");
	if (scheme !== "scrypt" || !salt || !expectedKey) {
		return false;
	}

	const expected = Buffer.from(expectedKey, "hex");
	const actual = scryptSync(password, salt, expected.length).toString("hex");
	const actualBuffer = Buffer.from(actual, "hex");
	return (
		expected.length === actualBuffer.length &&
		timingSafeEqual(expected, actualBuffer)
	);
}
