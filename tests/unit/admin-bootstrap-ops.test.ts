import { describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import {
	adminBootstrapState,
	adminSessions,
	adminUsers,
} from "../../src/db/schema";
import {
	clearAdminSessions,
	readAdminInfo,
	resetAdminEntrance,
	resetAdminPasswordWithGenerated,
} from "../../src/modules/admin/bootstrap-admin-ops";
import {
	createPasswordHash,
	verifyPasswordHash,
} from "../../src/modules/admin/password-hash";
import {
	applyInitialMigration,
	createTestWorkspace,
} from "../support/test-fixtures";

async function createWorkspace() {
	const workspace = createTestWorkspace("qingyan-admin-ops-");
	await applyInitialMigration(workspace.databaseUrl);
	const { db, close } = createDatabaseClients(workspace.databaseUrl, {
		pool: { max: 2 },
	});
	return {
		db,
		async seed() {
			const [user] = await db
				.insert(adminUsers)
				.values({
					username: "admin",
					email: "admin@example.test",
					displayName: "Admin",
					passwordHash: createPasswordHash("old-password"),
					isInitialAdmin: true,
				})
				.returning();
			await db.insert(adminBootstrapState).values({
				id: 1,
				consolePath: "/admin",
				initialAdminUserId: user.id,
			});
			await db.insert(adminSessions).values({
				id: "session_1",
				tokenHash: "hash",
				expiresAt: new Date(Date.now() + 1000).toISOString(),
			});
		},
		async close() {
			await close();
			await workspace.cleanup();
		},
	};
}

describe("admin bootstrap ops", () => {
	it("reads admin bootstrap info", async () => {
		const workspace = await createWorkspace();
		try {
			await workspace.seed();

			await expect(readAdminInfo(workspace.db)).resolves.toMatchObject({
				consolePath: "/admin",
				username: "admin",
				passwordRotatedAt: null,
			});
		} finally {
			await workspace.close();
		}
	});

	it("generates an 18 character password and clears sessions", async () => {
		const workspace = await createWorkspace();
		try {
			await workspace.seed();

			const result = await resetAdminPasswordWithGenerated(workspace.db);
			const rows = await workspace.db.select().from(adminUsers);
			const sessions = await workspace.db.select().from(adminSessions);

			expect(result.passwordGenerated).toBe(true);
			expect(result.password).toHaveLength(18);
			expect(
				verifyPasswordHash(result.password ?? "", rows[0]?.passwordHash ?? ""),
			).toBe(true);
			expect(rows[0]?.passwordRotatedAt).toBeTruthy();
			expect(sessions).toEqual([]);
		} finally {
			await workspace.close();
		}
	});

	it("uses a supplied password without returning it", async () => {
		const workspace = await createWorkspace();
		try {
			await workspace.seed();

			const result = await resetAdminPasswordWithGenerated(workspace.db, {
				password: "new-password",
			});
			const rows = await workspace.db.select().from(adminUsers);

			expect(result.passwordGenerated).toBe(false);
			expect(result.password).toBeUndefined();
			expect(
				verifyPasswordHash("new-password", rows[0]?.passwordHash ?? ""),
			).toBe(true);
		} finally {
			await workspace.close();
		}
	});

	it("resets the admin entrance and clears sessions", async () => {
		const workspace = await createWorkspace();
		try {
			await workspace.seed();

			const result = await resetAdminEntrance(workspace.db, {
				path: "/hidden-admin",
			});
			const info = await readAdminInfo(workspace.db);
			const sessions = await workspace.db.select().from(adminSessions);

			expect(result).toEqual({
				consolePath: "/hidden-admin",
				pathGenerated: false,
			});
			expect(info?.consolePath).toBe("/hidden-admin");
			expect(sessions).toEqual([]);
		} finally {
			await workspace.close();
		}
	});

	it("rejects reserved admin entrance paths", async () => {
		const workspace = await createWorkspace();
		try {
			await workspace.seed();

			await expect(
				resetAdminEntrance(workspace.db, { path: "/api/admin" }),
			).rejects.toThrow("reserved system route");
		} finally {
			await workspace.close();
		}
	});

	it("clears all admin sessions", async () => {
		const workspace = await createWorkspace();
		try {
			await workspace.seed();

			await clearAdminSessions(workspace.db);

			await expect(workspace.db.select().from(adminSessions)).resolves.toEqual(
				[],
			);
		} finally {
			await workspace.close();
		}
	});
});
