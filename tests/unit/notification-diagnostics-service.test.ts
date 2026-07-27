import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
	adminUserSiteAccess,
	adminUsers,
	notificationChannelConfigs,
	siteSettings,
	sites,
} from "../../src/db/schema";
import { AdminSystemSettingsRepository } from "../../src/modules/admin/system-settings-repository";
import { BackendUserNotificationPreferencesRepository } from "../../src/modules/notifications/backend-user-preferences-repository";
import {
	type SiteBackendNotificationEventType,
	SiteNotificationEventsRepository,
} from "../../src/modules/notifications/site-notification-events-repository";
import { CommenterPreferencesRepository } from "../../src/modules/notifications/commenter-preferences-repository";
import { EmailReputationRepository } from "../../src/modules/notifications/email-reputation-repository";
import {
	type NotificationDiagnosticFlowKey,
	NotificationDiagnosticsService,
} from "../../src/modules/notifications/notification-diagnostics-service";
import type { NotificationRuntimeState } from "../../src/modules/notifications/notification-runtime";
import { TaskRunRepository } from "../../src/modules/tasks/task-run-repository";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

type Fixture = Awaited<ReturnType<typeof createTestApp>>;

type ReadyContext = {
	fixture: Fixture;
	siteId: number;
	userId: number;
	runtimeState: NotificationRuntimeState;
	systemSettings: AdminSystemSettingsRepository;
	events: SiteNotificationEventsRepository;
	preferences: BackendUserNotificationPreferencesRepository;
	service: NotificationDiagnosticsService;
};

const readyRuntimeState = (): NotificationRuntimeState => ({
	started: true,
	running: false,
	lastTickAt: "2026-07-26T10:00:00.000Z",
	lastError: null,
});

async function replaceEmailRoutes(
	context: ReadyContext,
	eventTypes: SiteBackendNotificationEventType[],
	channelConfigId = "email:default",
) {
	await context.events.replaceSiteEvents({
		siteId: context.siteId,
		events: siteNotificationEventTypes.map((eventType) => ({
			eventType,
			recipientUserIds: eventTypes.includes(eventType) ? [context.userId] : [],
			externalChannelConfigIds:
				eventTypes.includes(eventType) && channelConfigId !== "email:default"
					? [channelConfigId]
					: [],
		})),
	});
}

const siteNotificationEventTypes: SiteBackendNotificationEventType[] = [
	"admin_comment_pending",
	"admin_comment_approved",
];

async function createReadyContext(): Promise<ReadyContext> {
	const fixture = await createTestApp();
	cleanups.push(fixture.cleanup);
	const [site] = await fixture.app.db
		.select()
		.from(sites)
		.where(eq(sites.siteKey, "fangyuan"));
	const [user] = await fixture.app.db.select().from(adminUsers).limit(1);
	if (!site || !user) {
		throw new Error("Expected seeded site and admin user.");
	}
	await fixture.app.db
		.insert(adminUserSiteAccess)
		.values({ userId: user.id, siteId: site.id })
		.onConflictDoNothing();
	await fixture.app.db
		.update(siteSettings)
		.set({
			commentsEnabled: true,
			maxDepth: 3,
			commenterReplyEmailEnabled: true,
			commenterReplyEmailDefaultChecked: false,
			backendNotificationsEnabled: true,
		})
		.where(eq(siteSettings.siteId, site.id));

	const systemSettings = new AdminSystemSettingsRepository(fixture.app.db);
	await systemSettings.upsert("mail", "enabled", true);
	await systemSettings.upsert("mail", "smtp.host", "smtp.example.test");
	await systemSettings.upsert("mail", "smtp.from", "notify@example.test");
	await systemSettings.upsert(
		"notifications",
		"delivery.queueBackend",
		"database",
	);

	const events = new SiteNotificationEventsRepository(fixture.app.db);
	const preferences = new BackendUserNotificationPreferencesRepository(
		fixture.app.db,
	);
	const runtimeState = readyRuntimeState();
	const context: ReadyContext = {
		fixture,
		siteId: site.id,
		userId: user.id,
		runtimeState,
		systemSettings,
		events,
		preferences,
		service: new NotificationDiagnosticsService(fixture.app.db, {
			notificationRuntimeState: () => runtimeState,
			now: () => new Date("2026-07-26T10:05:00.000Z"),
		}),
	};
	await replaceEmailRoutes(context, [
		"admin_comment_pending",
		"admin_comment_approved",
	]);
	return context;
}

function flowFor(
	diagnostic: Awaited<ReturnType<NotificationDiagnosticsService["diagnose"]>>,
	key: NotificationDiagnosticFlowKey,
) {
	const flow = diagnostic.flows.find((item) => item.key === key);
	if (!flow) {
		throw new Error(`Missing diagnostic flow ${key}`);
	}
	return flow;
}

describe("notification diagnostics service", () => {
	it("returns ready admin flows and a conditional commenter flow", async () => {
		const context = await createReadyContext();

		const diagnostic = await context.service.diagnose("fangyuan");

		expect(diagnostic.savedConfigOnly).toBe(true);
		expect(diagnostic.overall).toBe("conditional");
		expect(diagnostic.runtime).toEqual({
			notificationWorker: "ready",
			queueBackend: "database",
			lastTickAt: "2026-07-26T10:00:00.000Z",
		});
		expect(flowFor(diagnostic, "admin_comment_pending_email").status).toBe(
			"ready",
		);
		expect(flowFor(diagnostic, "admin_comment_approved_email").status).toBe(
			"ready",
		);
		const commenter = flowFor(diagnostic, "commenter_reply_email");
		expect(commenter.status).toBe("conditional");
		expect(commenter.blockers).toEqual([]);
		expect(commenter.warnings.map((warning) => warning.code)).toEqual(
			expect.arrayContaining([
				"commenter_email_required",
				"commenter_opt_in_required",
				"commenter_unsubscribe_check_required",
				"commenter_reputation_check_required",
				"reply_actor_identity_check_required",
				"reply_email_default_unchecked",
			]),
		);
	});

	it.each<{
		name: string;
		flow: NotificationDiagnosticFlowKey;
		code: string;
		status?: "blocked" | "conditional";
		mutate: (context: ReadyContext) => Promise<void>;
	}>([
		{
			name: "system mail is disabled",
			flow: "admin_comment_pending_email",
			code: "system_mail_disabled",
			mutate: async ({ systemSettings }) => {
				await systemSettings.upsert("mail", "enabled", false);
			},
		},
		{
			name: "SMTP host is missing",
			flow: "admin_comment_pending_email",
			code: "smtp_host_missing",
			mutate: async ({ systemSettings }) => {
				await systemSettings.upsert("mail", "smtp.host", "");
			},
		},
		{
			name: "SMTP from is missing",
			flow: "admin_comment_pending_email",
			code: "smtp_from_missing",
			mutate: async ({ systemSettings }) => {
				await systemSettings.upsert("mail", "smtp.from", "");
			},
		},
		{
			name: "recipient user is inactive",
			flow: "admin_comment_pending_email",
			code: "event_email_recipient_inactive",
			mutate: async ({ fixture, userId }) => {
				await fixture.app.db
					.update(adminUsers)
					.set({ status: "disabled" })
					.where(eq(adminUsers.id, userId));
			},
		},
		{
			name: "external target is disabled",
			flow: "admin_comment_pending_email",
			code: "event_external_target_unavailable",
			status: "conditional",
			mutate: async (context) => {
				await context.fixture.app.db.insert(notificationChannelConfigs).values({
					id: "webhook:disabled",
					type: "webhook",
					name: "Disabled webhook",
					description: null,
					enabled: false,
					configJson: '{"url":"https://example.test/hook"}',
					secretConfigJson: "{}",
				});
				await replaceEmailRoutes(
					context,
					["admin_comment_pending", "admin_comment_approved"],
					"webhook:disabled",
				);
			},
		},
		{
			name: "personal email preference is disabled",
			flow: "admin_comment_pending_email",
			code: "recipient_email_preference_disabled",
			status: "conditional",
			mutate: async ({ preferences, userId }) => {
				await preferences.updatePreference({
					userId,
					channel: "email",
					channelConfigRef: "email:default",
					enabled: false,
				});
			},
		},
		{
			name: "digest delays immediate delivery",
			flow: "admin_comment_pending_email",
			code: "recipient_email_digest_delayed",
			status: "conditional",
			mutate: async ({ preferences, userId }) => {
				await preferences.updatePreference({
					userId,
					channel: "email",
					channelConfigRef: "email:default",
					digestMode: "interval",
					digestIntervalMinutes: 30,
				});
			},
		},
		{
			name: "commenter reply feature is off",
			flow: "commenter_reply_email",
			code: "commenter_reply_email_disabled",
			mutate: async ({ fixture, siteId }) => {
				await fixture.app.db
					.update(siteSettings)
					.set({ commenterReplyEmailEnabled: false })
					.where(eq(siteSettings.siteId, siteId));
			},
		},
		{
			name: "queue backend is unsupported",
			flow: "commenter_reply_email",
			code: "queue_backend_unavailable",
			mutate: async ({ systemSettings }) => {
				await systemSettings.upsert(
					"notifications",
					"delivery.queueBackend",
					"bullmq",
				);
			},
		},
		{
			name: "notification worker is not started",
			flow: "commenter_reply_email",
			code: "notification_worker_not_started",
			mutate: async ({ runtimeState }) => {
				runtimeState.started = false;
				runtimeState.lastTickAt = null;
			},
		},
	])("$name", async ({ flow, code, status = "blocked", mutate }) => {
		const context = await createReadyContext();
		await mutate(context);

		const diagnostic = await context.service.diagnose("fangyuan");
		const result = flowFor(diagnostic, flow);

		expect(result.status).toBe(status);
		expect(diagnostic.overall).toBe(status);
		const issues = status === "blocked" ? result.blockers : result.warnings;
		expect(issues.map((issue) => issue.code)).toContain(code);
	});

	it("treats an empty event or the master switch being off as intentionally not sending", async () => {
		const context = await createReadyContext();
		await replaceEmailRoutes(context, ["admin_comment_approved"]);

		const emptyEvent = await context.service.diagnose("fangyuan");
		const pending = flowFor(emptyEvent, "admin_comment_pending_email");
		expect(pending.status).toBe("not_sending");
		expect(pending.blockers).toEqual([]);
		expect(pending.warnings.map((warning) => warning.code)).toContain(
			"event_has_no_targets",
		);

		await context.fixture.app.db
			.update(siteSettings)
			.set({ backendNotificationsEnabled: false })
			.where(eq(siteSettings.siteId, context.siteId));
		const disabled = await context.service.diagnose("fangyuan");
		expect(flowFor(disabled, "admin_comment_approved_email").status).toBe(
			"not_sending",
		);
	});

	it("resolves commenter opt-in, unsubscribe, and reputation for a specific email", async () => {
		const context = await createReadyContext();
		const commenterPreferences = new CommenterPreferencesRepository(
			context.fixture.app.db,
		);
		const reputation = new EmailReputationRepository(context.fixture.app.db);

		const noPreference = await context.service.diagnoseCommenterEmail(
			"fangyuan",
			"reader@example.com",
		);
		expect(
			flowFor(noPreference, "commenter_reply_email").warnings.map(
				(warning) => warning.code,
			),
		).toContain("commenter_opt_in_required");

		await commenterPreferences.upsertFromCommentForm({
			siteId: context.siteId,
			email: "reader@example.com",
			notifyOnReply: true,
		});
		const emailHash = noPreference.flows
			.flatMap((flow) => flow.recipients)
			.find((recipient) => recipient.email === "reader@example.com");
		expect(emailHash).toBeTruthy();

		const optedIn = await context.service.diagnoseCommenterEmail(
			"fangyuan",
			"reader@example.com",
		);
		expect(flowFor(optedIn, "commenter_reply_email").blockers).toEqual([]);

		const preference = await commenterPreferences.upsertFromCommentForm({
			siteId: context.siteId,
			email: "retired@example.com",
			notifyOnReply: true,
		});
		if (!preference) {
			throw new Error("Expected commenter preference.");
		}
		await commenterPreferences.unsubscribe({
			siteId: context.siteId,
			emailHash: preference.emailHash,
			nowIso: "2026-07-26T09:00:00.000Z",
		});
		const retired = await context.service.diagnoseCommenterEmail(
			"fangyuan",
			"retired@example.com",
		);
		expect(
			flowFor(retired, "commenter_reply_email").blockers.map(
				(blocker) => blocker.code,
			),
		).toContain("commenter_unsubscribed");

		for (let index = 0; index < 5; index += 1) {
			await reputation.recordRecipientFailure({
				siteId: context.siteId,
				email: "suppressed@example.com",
				reason: "mailbox_unavailable",
				nowIso: "2026-07-26T09:00:00.000Z",
			});
		}
		const suppressed = await context.service.diagnoseCommenterEmail(
			"fangyuan",
			"suppressed@example.com",
		);
		expect(
			flowFor(suppressed, "commenter_reply_email").blockers.map(
				(blocker) => blocker.code,
			),
		).toContain("commenter_email_suppressed");
	});

	it("adds bounded recent delivery and chain-test evidence without overriding blockers", async () => {
		const context = await createReadyContext();
		const tasks = new TaskRunRepository(context.fixture.app.db);
		const failedPendingTask = await tasks.create({
			type: "backend_user_comment_pending",
			category: "notification",
			siteId: context.siteId,
			siteKey: "fangyuan",
			payloadSummary: {},
			payload: {},
		});
		const failedPendingDelivery = await tasks.createDelivery({
			taskRunId: failedPendingTask.id,
			channel: "email",
			channelConfigRef: "email:default",
			recipientType: "backend_user",
			recipientAddressSnapshot: "admin@example.test",
			recipientIdentityKey: "user:1",
			eventFamily: "admin_comment_pending",
			templateKey: "backend_user.comment.pending",
		});
		await tasks.markDeliveryFailed({
			id: failedPendingDelivery.id,
			error: {
				code: "SMTP_REJECTED",
				secret: "must-not-leak",
				unsubscribeToken: "must-not-leak",
			},
		});

		const sentApprovedTask = await tasks.create({
			type: "backend_user_comment_approved",
			category: "notification",
			siteId: context.siteId,
			siteKey: "fangyuan",
			payloadSummary: {},
			payload: {},
		});
		const sentApprovedDelivery = await tasks.createDelivery({
			taskRunId: sentApprovedTask.id,
			channel: "email",
			channelConfigRef: "email:default",
			recipientType: "backend_user",
			recipientAddressSnapshot: "admin@example.test",
			recipientIdentityKey: "user:1",
			eventFamily: "admin_comment_approved",
			templateKey: "backend_user.comment.approved",
		});
		await tasks.markDeliverySent({
			id: sentApprovedDelivery.id,
			providerMessageId: "provider-secret-id",
		});

		const chainTask = await tasks.create({
			type: "notification_chain_test",
			category: "notification",
			siteId: context.siteId,
			siteKey: "fangyuan",
			payloadSummary: {},
			payload: {},
		});
		await tasks.markFailed(chainTask.id, {
			code: "CHAIN_FAILED",
			secret: "must-not-leak",
		});

		const evidence = await context.service.diagnose("fangyuan");
		const pending = flowFor(evidence, "admin_comment_pending_email");
		const approved = flowFor(evidence, "admin_comment_approved_email");
		expect(pending.status).toBe("conditional");
		expect(pending.warnings.map((warning) => warning.code)).toEqual(
			expect.arrayContaining([
				"recent_email_delivery_failed",
				"recent_chain_test_failed",
			]),
		);
		expect(approved.warnings.map((warning) => warning.code)).toEqual(
			expect.arrayContaining([
				"recent_email_delivery_sent",
				"recent_chain_test_failed",
			]),
		);
		expect(JSON.stringify(evidence)).not.toContain("must-not-leak");
		expect(JSON.stringify(evidence)).not.toContain("provider-secret-id");

		await context.systemSettings.upsert("mail", "enabled", false);
		const blocked = await context.service.diagnose("fangyuan");
		const blockedPending = flowFor(blocked, "admin_comment_pending_email");
		expect(blockedPending.status).toBe("blocked");
		expect(blockedPending.blockers.map((blocker) => blocker.code)).toContain(
			"system_mail_disabled",
		);
		expect(blockedPending.warnings.map((warning) => warning.code)).toContain(
			"recent_email_delivery_failed",
		);
	});
});
