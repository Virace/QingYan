import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { buildApp } from "../../src/app";
import { resolveRuntimeOptions } from "../../src/config/runtime-options";
import { loginAsAdmin } from "../support/admin-login";
import {
	applyCurrentMigrations,
	applyV010BaselineMigration,
	createTestConfig,
	createTestWorkspace,
} from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("notification reliability post-release migration", () => {
	it("upgrades v0.1.0 data and serves settings and bootstrap from the migrated database", async () => {
		const workspace = createTestWorkspace("qingyan-notification-upgrade-");
		applyV010BaselineMigration(workspace.databaseFile);

		const baseline = new Database(workspace.databaseFile);
		try {
			baseline.exec(`
				CREATE TABLE __qingyan_migrations (
					name text PRIMARY KEY NOT NULL,
					applied_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
				);
				INSERT INTO __qingyan_migrations (name) VALUES ('0000_initial.sql');
				INSERT INTO sites (site_key, name, allowed_origins_json)
				VALUES ('upgrade-site', 'Upgrade Site', '["http://localhost:4321"]');
				INSERT INTO site_settings (
					site_id,
					commenter_reply_email_enabled,
					default_status
				) VALUES (1, 1, 'approved');
				INSERT INTO page_threads (
					site_id,
					page_key,
					page_title,
					page_url,
					comment_count,
					root_comment_count
				) VALUES (
					1,
					'/posts/existing/',
					'Existing',
					'http://localhost:4321/posts/existing/',
					1,
					1
				);
				INSERT INTO site_page_registry (
					site_id,
					page_key,
					page_url,
					title,
					status
				) VALUES (
					1,
					'/posts/existing/',
					'http://localhost:4321/posts/existing/',
					'Existing',
					'active'
				);
				INSERT INTO comments (
					id,
					site_id,
					page_thread_id,
					author_identity,
					status,
					author_name,
					author_email,
					content_raw,
					content_html
				) VALUES (
					'comment_existing',
					1,
					1,
					'visitor',
					'approved',
					'Existing Reader',
					'reader@example.test',
					'Existing comment',
					'<p>Existing comment</p>'
				);
			`);
		} finally {
			baseline.close();
		}

		applyCurrentMigrations(workspace.databaseFile);

		const migrated = new Database(workspace.databaseFile);
		try {
			expect(migrated.pragma("integrity_check")).toEqual([
				{ integrity_check: "ok" },
			]);
			expect(
				migrated
					.prepare("SELECT name FROM __qingyan_migrations ORDER BY name")
					.all(),
			).toEqual([
				{ name: "0000_initial.sql" },
				{ name: "0001_notification_reliability.sql" },
				{ name: "0002_site_notification_events.sql" },
				{ name: "0003_comment_email_delivery_observability.sql" },
			]);
			expect(
				migrated
					.prepare(
						"SELECT commenter_reply_email_enabled AS enabled, commenter_reply_email_default_checked AS default_checked FROM site_settings WHERE site_id = 1",
					)
					.get(),
			).toEqual({ enabled: 1, default_checked: 0 });
			expect(
				migrated
					.prepare(
						"SELECT id, content_raw FROM comments WHERE id = 'comment_existing'",
					)
					.get(),
			).toEqual({
				id: "comment_existing",
				content_raw: "Existing comment",
			});
			expect(
				migrated
					.prepare(
						"SELECT kind FROM page_threads WHERE site_id = 1 AND page_key = '/posts/existing/'",
					)
					.get(),
			).toEqual({ kind: "public" });
		} finally {
			migrated.close();
		}

		const config = createTestConfig(
			workspace.databaseFile,
			workspace.logsDirectory,
		);
		const resolved = resolveRuntimeOptions(config, {});
		const app = await buildApp(resolved.config, resolved.runtimeOptions, {
			emailSender: async () => ({
				providerMessageId: "upgrade-test-message",
			}),
			startNotificationRuntime: false,
		});
		cleanups.push(async () => {
			await app.close();
			workspace.cleanup();
		});

		const { adminCookie } = await loginAsAdmin(app);
		const settings = await app.inject({
			method: "GET",
			url: "/qingyan/api/admin/sites/upgrade-site/settings",
			cookies: {
				qingyan_admin: adminCookie.value,
			},
		});
		expect(settings.statusCode).toBe(200);
		expect(settings.json()).toMatchObject({
			notifications: {
				commenter: {
					replyEmailEnabled: true,
					replyEmailDefaultChecked: false,
				},
			},
		});

		const bootstrap = await app.inject({
			method: "GET",
			url: "/qingyan/api/comments/bootstrap?siteKey=upgrade-site&pageTitle=Existing",
			headers: {
				referer: "http://localhost:4321/posts/existing/",
			},
		});
		expect(bootstrap.statusCode, bootstrap.body).toBe(200);
		expect(bootstrap.json()).toMatchObject({
			features: {
				replyEmailNotification: {
					defaultChecked: false,
				},
			},
			data: {
				comments: {
					items: [
						expect.objectContaining({
							id: "comment_existing",
							content: {
								html: "<p>Existing comment</p>",
								raw: "Existing comment",
							},
						}),
					],
				},
			},
		});
	});
});
