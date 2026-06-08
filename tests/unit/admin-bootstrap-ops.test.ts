import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createDatabaseClients } from "../../src/db/client";
import { adminBootstrapState, adminSessions } from "../../src/db/schema";
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
import { applyInitialMigration } from "../support/test-fixtures";

function createWorkspace() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-admin-ops-"));
	const databaseFile = path.join(directory, "qingyan.db");
	applyInitialMigration(databaseFile);
	const { db, sqlite } = createDatabaseClients(databaseFile);
	return {
		db,
		sqlite,
		async seed() {
			await db.insert(adminBootstrapState).values({
				id: 1,
				consolePath: "/admin",
				username: "admin",
				passwordHash: createPasswordHash("old-password"),
				passwordRotatedAt: null,
			});
			await db.insert(adminSessions).values({
				id: "session_1",
				tokenHash: "hash",
				expiresAt: new Date(Date.now() + 1000).toISOString(),
			});
		},
		close() {
			sqlite.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("admin bootstrap ops", () => {
	it("reads admin bootstrap info", async () => {
		const workspace = createWorkspace();
		try {
			await workspace.seed();

			await expect(readAdminInfo(workspace.db)).resolves.toMatchObject({
				consolePath: "/admin",
				username: "admin",
				passwordRotatedAt: null,
			});
		} finally {
			workspace.close();
		}
	});

	it("generates an 18 character password and clears sessions", async () => {
		const workspace = createWorkspace();
		try {
			await workspace.seed();

			const result = await resetAdminPasswordWithGenerated(workspace.db);
			const rows = await workspace.db.select().from(adminBootstrapState);
			const sessions = await workspace.db.select().from(adminSessions);

			expect(result.passwordGenerated).toBe(true);
			expect(result.password).toHaveLength(18);
			expect(
				verifyPasswordHash(result.password ?? "", rows[0]?.passwordHash ?? ""),
			).toBe(true);
			expect(rows[0]?.passwordRotatedAt).toBeTruthy();
			expect(sessions).toEqual([]);
		} finally {
			workspace.close();
		}
	});

	it("uses a supplied password without returning it", async () => {
		const workspace = createWorkspace();
		try {
			await workspace.seed();

			const result = await resetAdminPasswordWithGenerated(workspace.db, {
				password: "new-password",
			});
			const rows = await workspace.db.select().from(adminBootstrapState);

			expect(result.passwordGenerated).toBe(false);
			expect(result.password).toBeUndefined();
			expect(
				verifyPasswordHash("new-password", rows[0]?.passwordHash ?? ""),
			).toBe(true);
		} finally {
			workspace.close();
		}
	});

	it("resets the admin entrance and clears sessions", async () => {
		const workspace = createWorkspace();
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
			workspace.close();
		}
	});

	it("rejects reserved admin entrance paths", async () => {
		const workspace = createWorkspace();
		try {
			await workspace.seed();

			await expect(
				resetAdminEntrance(workspace.db, { path: "/api/admin" }),
			).rejects.toThrow("reserved system route");
		} finally {
			workspace.close();
		}
	});

	it("clears all admin sessions", async () => {
		const workspace = createWorkspace();
		try {
			await workspace.seed();

			await clearAdminSessions(workspace.db);

			await expect(workspace.db.select().from(adminSessions)).resolves.toEqual(
				[],
			);
		} finally {
			workspace.close();
		}
	});
});
