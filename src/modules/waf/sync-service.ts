import type { AppDatabase } from "../../db/client";
import type { WafSiteMapping } from "./config";
import { type WafGatewayClient, WafGatewayError } from "./gateway-client";
import { type WafSyncRecord, WafSyncRepository } from "./repository";
import { managedWafRule, wafRuleFingerprint } from "./rules";

export class WafSyncService {
	private readonly repository: WafSyncRepository;
	public constructor(
		db: AppDatabase,
		private readonly client: Pick<
			WafGatewayClient,
			"findRule" | "createRule" | "updateRule" | "deleteRule" | "websites"
		>,
		private readonly mappings: WafSiteMapping[],
	) {
		this.repository = new WafSyncRepository(db);
	}

	public async execute(
		input: { siteId: number; recordId?: string },
		now = new Date(),
	) {
		if (process.env.QINGYAN_WAF_SYNC_PAUSED === "true")
			return { status: "paused", processed: 0 };
		const site = await this.repository.resolveSite(input.siteId);
		const mapping = this.mappings.find(
			(mapping) => mapping.siteKey === site?.siteKey,
		);
		if (!mapping) return { status: "not_configured", processed: 0 };
		const websites = await this.client.websites();
		if (
			!websites.some(
				(website) =>
					website.id === mapping.websiteId &&
					website.alias === mapping.websiteKey,
			)
		)
			throw new Error("WAF_SITE_MAPPING_CHANGED");
		let processed = 0;
		for (const candidate of await this.repository.listForSync(
			input.siteId,
			input.recordId,
		)) {
			const row = await this.repository.claim(
				candidate.id,
				candidate.revision,
				now,
			);
			if (!row) continue;
			processed++;
			try {
				await this.sync(row, mapping, now);
			} catch (error) {
				await this.repository.finish(row, {
					syncState: "failed",
					reasonCode:
						error instanceof WafGatewayError ? error.code : "WAF_SYNC_FAILED",
				});
				throw error instanceof WafGatewayError
					? error
					: new Error("WAF_SYNC_FAILED");
			}
		}
		return { status: "completed", processed };
	}

	private async sync(row: WafSyncRecord, mapping: WafSiteMapping, now: Date) {
		const penalty = await this.repository.penalty(row.penaltyId);
		if (!penalty)
			return this.repository.finish(row, {
				syncState: "failed",
				reasonCode: "WAF_PENALTY_MISSING",
			});
		if (penalty.stateVersion !== row.penaltyVersion)
			return this.repository.finish(row, {
				syncState: "pending",
				reasonCode: "WAF_STATE_CHANGED",
			});
		if (
			row.websiteId &&
			(row.websiteId !== mapping.websiteId ||
				row.websiteKey !== mapping.websiteKey)
		)
			return this.conflict(row, "WAF_SITE_MAPPING_CHANGED");
		const desired =
			!penalty.releasedAt &&
			penalty.expiresAt > now.toISOString() &&
			row.desiredState === "present";
		const expected = managedWafRule(penalty);
		const fingerprint = wafRuleFingerprint(expected);
		if (
			!(await this.repository.bind(
				row,
				mapping.websiteId,
				mapping.websiteKey,
				fingerprint,
			))
		)
			return;
		let remote = await this.client.findRule(mapping.websiteId, row.ruleName);
		if (
			remote &&
			wafRuleFingerprint(remote) !== fingerprint &&
			!row.restoreRequestedAt
		)
			return this.conflict(row, "WAF_RULE_CHANGED", wafRuleFingerprint(remote));
		if (desired && !remote && row.lastSyncedAt && !row.restoreRequestedAt)
			return this.conflict(row, "WAF_RULE_REMOVED");
		if (
			desired &&
			!row.sharedIpConfirmedAt &&
			(await this.repository.hasSharedIp(row.siteId, row.ip))
		)
			return this.repository.finish(row, {
				syncState: "conflict",
				reasonCode: "WAF_SHARED_IP_REVIEW",
				suspendedAt: now.toISOString(),
				observedState: remote ? "present" : "absent",
			});
		const current = await this.repository.get(row.id);
		if (!current || current.revision !== row.revision) return;
		if (desired) {
			if (!remote || row.restoreRequestedAt) {
				try {
					if (remote)
						await this.client.updateRule(
							mapping.websiteId,
							mapping.websiteKey,
							expected,
						);
					else
						await this.client.createRule(
							mapping.websiteId,
							mapping.websiteKey,
							expected,
						);
				} catch (error) {
					remote = await this.client.findRule(mapping.websiteId, row.ruleName);
					if (!remote || wafRuleFingerprint(remote) !== fingerprint)
						throw error;
				}
			}
			remote = await this.client.findRule(mapping.websiteId, row.ruleName);
			if (!remote || wafRuleFingerprint(remote) !== fingerprint)
				return this.conflict(
					row,
					"WAF_RULE_CHANGED",
					remote ? wafRuleFingerprint(remote) : undefined,
				);
		} else if (remote) {
			try {
				await this.client.deleteRule(mapping.websiteId, row.ruleName);
			} catch (error) {
				if (await this.client.findRule(mapping.websiteId, row.ruleName))
					throw error;
			}
			if (await this.client.findRule(mapping.websiteId, row.ruleName))
				throw new Error("WAF_DELETE_NOT_CONFIRMED");
		}
		const applied = await this.repository.finish(row, {
			websiteId: mapping.websiteId,
			websiteKey: mapping.websiteKey,
			expectedFingerprint: fingerprint,
			observedFingerprint: desired ? fingerprint : null,
			observedState: desired ? "present" : "absent",
			desiredState: desired ? "present" : "absent",
			syncState: "synced",
			reasonCode: desired
				? null
				: penalty.releasedAt
					? "WAF_RELEASED"
					: "WAF_EXPIRED",
			lastSyncedAt: now.toISOString(),
			restoreRequestedAt: null,
		});
		if (!applied && desired)
			await this.compensateReleased(row, mapping, fingerprint);
	}

	private async compensateReleased(
		row: WafSyncRecord,
		mapping: WafSiteMapping,
		fingerprint: string,
	) {
		const current = await this.repository.get(row.id);
		if (!current || current.suspendedAt || current.desiredState !== "absent")
			return;
		const claimed = await this.repository.claim(
			current.id,
			current.revision,
			new Date(),
		);
		if (!claimed) return;
		const remote = await this.client.findRule(mapping.websiteId, row.ruleName);
		if (remote && wafRuleFingerprint(remote) !== fingerprint) {
			await this.conflict(
				claimed,
				"WAF_RULE_CHANGED",
				wafRuleFingerprint(remote),
			);
			return;
		}
		if (remote) await this.client.deleteRule(mapping.websiteId, row.ruleName);
		if (
			claimed &&
			!(await this.client.findRule(mapping.websiteId, row.ruleName))
		)
			await this.repository.finish(claimed, {
				observedState: "absent",
				observedFingerprint: null,
				syncState: "synced",
				reasonCode: "WAF_RELEASED",
				lastSyncedAt: new Date().toISOString(),
			});
	}

	private conflict(
		row: WafSyncRecord,
		reasonCode: string,
		observedFingerprint?: string,
	) {
		return this.repository.finish(row, {
			syncState: "conflict",
			observedState: reasonCode === "WAF_RULE_REMOVED" ? "absent" : "conflict",
			reasonCode,
			observedFingerprint: observedFingerprint ?? null,
			suspendedAt: new Date().toISOString(),
		});
	}
}
