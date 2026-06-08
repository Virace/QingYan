import type { AppDatabase } from "../../db/client";
import type { AdminBootstrap } from "./bootstrap-service";
import { AdminUsersRepository } from "./admin-users-repository";
import { systemGroups } from "./permissions";

const INITIAL_ADMIN_EMAIL = "admin@localhost.invalid";

export class AdminIdentityService {
	private readonly repository: AdminUsersRepository;

	public constructor(db: AppDatabase) {
		this.repository = new AdminUsersRepository(db);
	}

	public async ensureSystemGroups() {
		for (const group of systemGroups) {
			await this.repository.upsertSystemGroup(group);
		}
	}

	public async ensureInitialAdmin(bootstrap: AdminBootstrap) {
		await this.ensureSystemGroups();
		const existing = await this.repository.getUserByUsername(
			bootstrap.username,
		);
		const user = existing
			? await this.repository.updateInitialAdmin({
					userId: existing.id,
					email: existing.email || INITIAL_ADMIN_EMAIL,
					passwordHash: bootstrap.passwordHash,
					displayName: existing.displayName || bootstrap.username,
				})
			: await this.repository.createInitialAdmin({
					username: bootstrap.username,
					email: INITIAL_ADMIN_EMAIL,
					passwordHash: bootstrap.passwordHash,
					displayName: bootstrap.username,
				});
		const adminGroup = await this.repository.getGroupByKey("admin");
		if (user && adminGroup) {
			await this.repository.setUserGroup({
				userId: user.id,
				groupId: adminGroup.id,
			});
		}
		return user;
	}
}
