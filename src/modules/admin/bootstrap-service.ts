import { eq } from "drizzle-orm";

import type { AppRuntimeOptions } from "../../config/runtime-options";
import type { AppConfig } from "../../config/types";
import type { AppDatabase } from "../../db/client";
import { adminBootstrapState } from "../../db/schema";
import { createAdminConsolePath } from "./bootstrap-utils";
import {
	createInitialAdminPassword,
	createInitialAdminUsername,
	createPasswordHash,
} from "./password-hash";

export interface AdminBootstrap {
	consolePath: string;
	username: string;
	passwordHash: string;
	generatedPassword?: string;
}

function resolveConfiguredBootstrap(config: AppConfig): AdminBootstrap | null {
	const consolePath = config.admin.console.path;
	const username = config.admin.auth.username;
	const passwordHash = config.admin.auth.passwordHash;

	if (!consolePath || !username || !passwordHash) {
		return null;
	}

	return {
		consolePath,
		username,
		passwordHash,
	};
}

export async function resolveAdminBootstrap(
	config: AppConfig,
	db: AppDatabase,
	runtimeOptions?: AppRuntimeOptions,
): Promise<AdminBootstrap> {
	if (runtimeOptions?.devMode.enabled) {
		const username = runtimeOptions.devMode.adminUsername ?? "admin";
		const password = runtimeOptions.devMode.adminPassword ?? "admin";
		return {
			consolePath: config.admin.console.path ?? "/admin",
			username,
			passwordHash: createPasswordHash(password),
			generatedPassword: password,
		};
	}

	const configured = resolveConfiguredBootstrap(config);
	if (configured) {
		return configured;
	}

	const [existing] = await db
		.select()
		.from(adminBootstrapState)
		.where(eq(adminBootstrapState.id, 1))
		.limit(1);
	if (existing) {
		return {
			consolePath: config.admin.console.path ?? existing.consolePath,
			username: config.admin.auth.username ?? existing.username,
			passwordHash: config.admin.auth.passwordHash ?? existing.passwordHash,
		};
	}

	const generatedPassword = config.admin.auth.passwordHash
		? undefined
		: createInitialAdminPassword();
	const bootstrap = {
		consolePath: config.admin.console.path ?? createAdminConsolePath(),
		username: config.admin.auth.username ?? createInitialAdminUsername(),
		passwordHash:
			config.admin.auth.passwordHash ??
			createPasswordHash(generatedPassword ?? createInitialAdminPassword()),
		generatedPassword,
	};

	await db.insert(adminBootstrapState).values({
		id: 1,
		consolePath: bootstrap.consolePath,
		username: bootstrap.username,
		passwordHash: bootstrap.passwordHash,
		passwordRotatedAt: null,
	});

	return bootstrap;
}

export async function resetAdminPassword(
	db: AppDatabase,
	password: string,
): Promise<void> {
	await db
		.update(adminBootstrapState)
		.set({
			passwordHash: createPasswordHash(password),
			passwordRotatedAt: new Date().toISOString(),
		})
		.where(eq(adminBootstrapState.id, 1));
}
