import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import type { AppDatabase } from "../../db/client";
import { adminBootstrapState, adminSessions } from "../../db/schema";
import { assertAdminConsolePath } from "../../config/admin-console-path";
import { createAdminConsolePath } from "./bootstrap-utils";
import { createPasswordHash } from "./password-hash";

const PASSWORD_ALPHABET =
	"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export interface AdminInfo {
	consolePath: string;
	username: string;
	passwordRotatedAt: string | null;
}

function createRandomPassword(length: number): string {
	let value = "";
	const bytes = randomBytes(length);
	for (const byte of bytes) {
		value += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
	}
	return value;
}

export async function readAdminInfo(
	db: AppDatabase,
): Promise<AdminInfo | null> {
	const [row] = await db
		.select({
			consolePath: adminBootstrapState.consolePath,
			username: adminBootstrapState.username,
			passwordRotatedAt: adminBootstrapState.passwordRotatedAt,
		})
		.from(adminBootstrapState)
		.where(eq(adminBootstrapState.id, 1))
		.limit(1);

	return row ?? null;
}

export async function clearAdminSessions(db: AppDatabase): Promise<void> {
	await db.delete(adminSessions);
}

export async function resetAdminPasswordWithGenerated(
	db: AppDatabase,
	input: { password?: string; length?: number } = {},
): Promise<{
	username: string;
	password?: string;
	passwordGenerated: boolean;
}> {
	const info = await readAdminInfo(db);
	if (!info) {
		throw new Error("ADMIN_BOOTSTRAP_NOT_FOUND");
	}

	const password = input.password ?? createRandomPassword(input.length ?? 18);
	await db
		.update(adminBootstrapState)
		.set({
			passwordHash: createPasswordHash(password),
			passwordRotatedAt: new Date().toISOString(),
		})
		.where(eq(adminBootstrapState.id, 1));
	await clearAdminSessions(db);

	return {
		username: info.username,
		password: input.password ? undefined : password,
		passwordGenerated: !input.password,
	};
}

export async function resetAdminEntrance(
	db: AppDatabase,
	input: { path?: string } = {},
): Promise<{ consolePath: string; pathGenerated: boolean }> {
	const info = await readAdminInfo(db);
	if (!info) {
		throw new Error("ADMIN_BOOTSTRAP_NOT_FOUND");
	}

	const consolePath = input.path ?? createAdminConsolePath();
	assertAdminConsolePath(consolePath);
	await db
		.update(adminBootstrapState)
		.set({ consolePath })
		.where(eq(adminBootstrapState.id, 1));
	await clearAdminSessions(db);

	return {
		consolePath,
		pathGenerated: !input.path,
	};
}
