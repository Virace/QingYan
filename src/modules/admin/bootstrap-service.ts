import { eq } from "drizzle-orm";

import type { AppRuntimeOptions } from "../../config/runtime-options";
import type { AppConfig } from "../../config/types";
import type { DatabaseExecutor } from "../../db/client";
import { adminBootstrapState, adminUsers } from "../../db/schema";
import { AdminIdentityService } from "./admin-identity-service";
import { AdminUsersRepository } from "./admin-users-repository";
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
	initialAdminUserId?: number;
	development?: boolean;
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
	db: DatabaseExecutor,
	runtimeOptions?: AppRuntimeOptions,
): Promise<AdminBootstrap> {
	const [existing] = await db
		.select({
			consolePath: adminBootstrapState.consolePath,
			initialAdminUserId: adminUsers.id,
			username: adminUsers.username,
			passwordHash: adminUsers.passwordHash,
		})
		.from(adminBootstrapState)
		.innerJoin(
			adminUsers,
			eq(adminUsers.id, adminBootstrapState.initialAdminUserId),
		)
		.where(eq(adminBootstrapState.id, 1))
		.limit(1);
	if (existing)
		return applyDevAdminCredentials(
			{
				...existing,
				consolePath: config.admin.console.path ?? existing.consolePath,
			},
			runtimeOptions,
		);
	const configured = resolveConfiguredBootstrap(config);

	if (runtimeOptions?.devMode.enabled) {
		return createDevAdminBootstrap(
			config.admin.console.path ?? "/admin",
			runtimeOptions,
		);
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

	const selected = configured ?? bootstrap;
	const user = await new AdminIdentityService(db).ensureInitialAdmin(selected);
	return {
		...selected,
		username: user.username,
		passwordHash: user.passwordHash,
	};
}

function applyDevAdminCredentials(
	bootstrap: AdminBootstrap,
	runtimeOptions?: AppRuntimeOptions,
): AdminBootstrap {
	if (!runtimeOptions?.devMode.enabled) {
		return bootstrap;
	}

	return {
		...createDevAdminBootstrap(bootstrap.consolePath, runtimeOptions),
		initialAdminUserId: bootstrap.initialAdminUserId,
	};
}

function createDevAdminBootstrap(
	consolePath: string,
	runtimeOptions: AppRuntimeOptions,
): AdminBootstrap {
	const username = runtimeOptions.devMode.adminUsername ?? "admin";
	const password = runtimeOptions.devMode.adminPassword ?? "admin";
	return {
		consolePath,
		username,
		passwordHash: createPasswordHash(password),
		generatedPassword: password,
		development: true,
	};
}

export async function resetAdminPassword(
	db: DatabaseExecutor,
	password: string,
): Promise<void> {
	const [state] = await db
		.select()
		.from(adminBootstrapState)
		.where(eq(adminBootstrapState.id, 1))
		.limit(1);
	if (!state) throw new Error("ADMIN_BOOTSTRAP_NOT_FOUND");
	await new AdminUsersRepository(db).updateUserPassword({
		userId: state.initialAdminUserId,
		passwordHash: createPasswordHash(password),
		passwordChangeRequired: false,
	});
}
