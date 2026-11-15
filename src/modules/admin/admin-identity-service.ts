import { eq, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import { adminBootstrapState, adminUsers } from "../../db/schema";
import type { AdminBootstrap } from "./bootstrap-service";
import { AdminUsersRepository } from "./admin-users-repository";
import { systemGroups } from "./permissions";

const INITIAL_ADMIN_EMAIL = "admin@localhost.invalid";

export class AdminIdentityService {
	private readonly repository: AdminUsersRepository;

	public constructor(private readonly db: DatabaseExecutor) {
		this.repository = new AdminUsersRepository(db);
	}

	public async ensureSystemGroups() {
		for (const group of systemGroups) {
			await this.repository.upsertSystemGroup(group);
		}
	}

	public async ensureInitialAdmin(bootstrap: AdminBootstrap) {
		return this.db.transaction(async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(174007, 1)`);
			const repository = new AdminUsersRepository(tx);
			const identity = new AdminIdentityService(tx);
			await identity.ensureSystemGroups();
			const [existing] = await tx
				.select()
				.from(adminUsers)
				.where(eq(adminUsers.isInitialAdmin, true))
				.limit(1);
			if (existing) return existing;
			const user = await repository.createInitialAdmin({
				username: bootstrap.username,
				email: INITIAL_ADMIN_EMAIL,
				passwordHash: bootstrap.passwordHash,
				displayName: bootstrap.username,
			});
			if (!user) throw new Error("ADMIN_INITIALIZATION_FAILED");
			const adminGroup = await repository.getGroupByKey("admin");
			if (!adminGroup) throw new Error("ADMIN_GROUP_NOT_FOUND");
			await repository.setUserGroup({
				userId: user.id,
				groupId: adminGroup.id,
			});
			await tx
				.insert(adminBootstrapState)
				.values({
					id: 1,
					consolePath: bootstrap.consolePath,
					initialAdminUserId: user.id,
				})
				.onConflictDoUpdate({
					target: adminBootstrapState.id,
					set: { initialAdminUserId: user.id },
				});
			return user;
		});
	}
}
