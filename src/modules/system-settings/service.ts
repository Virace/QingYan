import type { AppDatabase } from "../../db/client";
import { systemSettings } from "../../db/schema";
import { readSystemSettingsRows, type SystemSettingRow } from "./codec";
import {
	createSystemSettingsDefaults,
	type SystemSettings,
} from "./definitions";

export class RuntimeSystemSettingsService {
	public constructor(
		private readonly db: AppDatabase,
		private readonly defaults?: SystemSettings,
	) {}

	public async getSettings() {
		const rows = (await this.db
			.select()
			.from(systemSettings)) as SystemSettingRow[];
		return readSystemSettingsRows(rows, this.defaults);
	}

	public async getSecuritySettings() {
		return (await this.getSettings()).security;
	}

	public async getCaptchaSettings() {
		return (await this.getSettings()).captcha;
	}

	public async getAdminSessionSettings() {
		return (await this.getSettings()).admin.session;
	}

	public async getIpRegionSettings() {
		return (await this.getSettings()).ipRegion;
	}

	public async getAvatarSettings() {
		return (await this.getSettings()).avatar;
	}

	public async getPublicApiSettings() {
		return (await this.getSettings()).publicApi;
	}
}

export { createSystemSettingsDefaults };
