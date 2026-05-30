import path from "node:path";

import { loadConfig } from "../src/config/load-config";
import { createDatabaseClients } from "../src/db/client";
import {
	commentRequestMetadata,
	comments,
	siteSettings,
	visitorRequestMetadata,
} from "../src/db/schema";
import {
	DefaultCommentMetadataResolver,
	type CommentMetadataSnapshot,
} from "../src/modules/comments/metadata/resolver";
import {
	defaultCommentMetadata,
	type CommentMetadataSettings,
} from "../src/modules/shared/site-settings-defaults";
import { RuntimeSystemSettingsService } from "../src/modules/system-settings/service";
import { eq } from "drizzle-orm";

type Scope = "missing" | "all";

interface Stats {
	processed: number;
	refreshed: number;
	skipped: number;
	failed: number;
}

interface RequestMetadataRow {
	ip?: string | null;
	userAgent?: string | null;
	ipCountry?: string | null;
	ipRegion?: string | null;
	ipCity?: string | null;
	ipIsp?: string | null;
	ipLocationSource?: string | null;
	ipLocationUpdatedAt?: string | null;
	ipLocationError?: string | null;
	deviceBrowser?: string | null;
	deviceBrowserVersion?: string | null;
	deviceOs?: string | null;
	deviceOsVersion?: string | null;
	deviceType?: string | null;
	deviceIcon?: string | null;
	deviceSource?: string | null;
	deviceUpdatedAt?: string | null;
	deviceError?: string | null;
}

function parseArgs(argv: string[]) {
	const scope: Scope = argv.includes("--all") ? "all" : "missing";
	const dryRun = argv.includes("--dry-run");
	return { scope, dryRun };
}

function hasLocation(row: RequestMetadataRow) {
	return Boolean(
		row.ipCountry ||
			row.ipRegion ||
			row.ipCity ||
			row.ipIsp ||
			row.ipLocationSource ||
			row.ipLocationUpdatedAt ||
			row.ipLocationError,
	);
}

function hasDevice(row: RequestMetadataRow) {
	return Boolean(
		row.deviceBrowser ||
			row.deviceBrowserVersion ||
			row.deviceOs ||
			row.deviceOsVersion ||
			row.deviceType ||
			row.deviceIcon ||
			row.deviceSource ||
			row.deviceUpdatedAt ||
			row.deviceError,
	);
}

function nonEmpty(value?: string | null) {
	const trimmed = value?.trim();
	return trimmed ? (value ?? undefined) : undefined;
}

function initialStats(): Stats {
	return {
		processed: 0,
		refreshed: 0,
		skipped: 0,
		failed: 0,
	};
}

function needsRefresh(row: RequestMetadataRow, scope: Scope) {
	if (scope === "all") {
		return Boolean(nonEmpty(row.ip) || nonEmpty(row.userAgent));
	}

	const needsLocation = Boolean(nonEmpty(row.ip) && !hasLocation(row));
	const needsDevice = Boolean(nonEmpty(row.userAgent) && !hasDevice(row));
	return needsLocation || needsDevice;
}

function snapshotToColumns(snapshot: CommentMetadataSnapshot) {
	return {
		ipCountry: snapshot.authorIpCountry,
		ipRegion: snapshot.authorIpRegion,
		ipCity: snapshot.authorIpCity,
		ipIsp: snapshot.authorIpIsp,
		ipLocationRaw: snapshot.authorIpLocationRaw,
		ipLocationSource: snapshot.authorIpLocationSource,
		ipLocationDbHash: snapshot.authorIpLocationDbHash,
		ipLocationUpdatedAt: snapshot.authorIpLocationUpdatedAt,
		ipLocationError: snapshot.authorIpLocationError,
		deviceBrowser: snapshot.authorDeviceBrowser,
		deviceBrowserVersion: snapshot.authorDeviceBrowserVersion,
		deviceOs: snapshot.authorDeviceOs,
		deviceOsVersion: snapshot.authorDeviceOsVersion,
		deviceType: snapshot.authorDeviceType,
		deviceIcon: snapshot.authorDeviceIcon,
		deviceSource: snapshot.authorDeviceSource,
		deviceParserVersion: snapshot.authorDeviceParserVersion,
		deviceUpdatedAt: snapshot.authorDeviceUpdatedAt,
		deviceError: snapshot.authorDeviceError,
		updatedAt: new Date().toISOString(),
	};
}

function mergeCommentMetadataSettings(
	payload?: string | null,
): CommentMetadataSettings {
	if (!payload) {
		return defaultCommentMetadata;
	}

	try {
		const parsed = JSON.parse(payload) as Partial<CommentMetadataSettings>;
		return {
			...defaultCommentMetadata,
			...parsed,
			ipRegion: {
				...defaultCommentMetadata.ipRegion,
				...parsed.ipRegion,
			},
			device: {
				...defaultCommentMetadata.device,
				...parsed.device,
				display: {
					...defaultCommentMetadata.device.display,
					...parsed.device?.display,
				},
			},
		};
	} catch {
		return defaultCommentMetadata;
	}
}

async function main(): Promise<void> {
	const { scope, dryRun } = parseArgs(process.argv.slice(2));
	const config = await loadConfig();
	const databaseFile = path.resolve(process.cwd(), config.database.sqlite.file);
	const { db, sqlite } = createDatabaseClients(databaseFile);
	const resolver = new DefaultCommentMetadataResolver();
	const systemSettings = new RuntimeSystemSettingsService(db);
	const ipRegion = await systemSettings.getIpRegionSettings();
	const visitorStats = initialStats();
	const commentStats = initialStats();

	try {
		const settingsRows = await db.select().from(siteSettings);
		const metadataBySite = new Map(
			settingsRows.map((row) => [
				row.siteId,
				mergeCommentMetadataSettings(row.commentMetadataJson),
			]),
		);

		for (const row of await db.select().from(visitorRequestMetadata)) {
			visitorStats.processed += 1;
			const metadata = metadataBySite.get(row.siteId);
			if (!metadata || !needsRefresh(row, scope)) {
				visitorStats.skipped += 1;
				continue;
			}

			try {
				const snapshot = await resolver.resolve({
					ip: metadata.collectIp ? nonEmpty(row.ip) : undefined,
					userAgent: metadata.collectUserAgent
						? nonEmpty(row.userAgent)
						: undefined,
					metadata,
					ipRegion,
				});
				if (!dryRun) {
					await db
						.update(visitorRequestMetadata)
						.set(snapshotToColumns(snapshot))
						.where(eq(visitorRequestMetadata.id, row.id));
				}
				visitorStats.refreshed += 1;
			} catch {
				visitorStats.failed += 1;
			}
		}

		const commentRows = await db
			.select({
				siteId: comments.siteId,
				commentId: commentRequestMetadata.commentId,
				authorIp: commentRequestMetadata.authorIp,
				authorUserAgent: commentRequestMetadata.authorUserAgent,
				ipCountry: commentRequestMetadata.ipCountry,
				ipRegion: commentRequestMetadata.ipRegion,
				ipCity: commentRequestMetadata.ipCity,
				ipIsp: commentRequestMetadata.ipIsp,
				ipLocationSource: commentRequestMetadata.ipLocationSource,
				ipLocationUpdatedAt: commentRequestMetadata.ipLocationUpdatedAt,
				ipLocationError: commentRequestMetadata.ipLocationError,
				deviceBrowser: commentRequestMetadata.deviceBrowser,
				deviceBrowserVersion: commentRequestMetadata.deviceBrowserVersion,
				deviceOs: commentRequestMetadata.deviceOs,
				deviceOsVersion: commentRequestMetadata.deviceOsVersion,
				deviceType: commentRequestMetadata.deviceType,
				deviceIcon: commentRequestMetadata.deviceIcon,
				deviceSource: commentRequestMetadata.deviceSource,
				deviceUpdatedAt: commentRequestMetadata.deviceUpdatedAt,
				deviceError: commentRequestMetadata.deviceError,
			})
			.from(commentRequestMetadata)
			.innerJoin(comments, eq(commentRequestMetadata.commentId, comments.id));
		for (const row of commentRows) {
			commentStats.processed += 1;
			const metadata = metadataBySite.get(row.siteId);
			if (
				!metadata ||
				!needsRefresh(
					{
						ip: row.authorIp,
						userAgent: row.authorUserAgent,
						ipCountry: row.ipCountry,
						ipRegion: row.ipRegion,
						ipCity: row.ipCity,
						ipIsp: row.ipIsp,
						ipLocationSource: row.ipLocationSource,
						ipLocationUpdatedAt: row.ipLocationUpdatedAt,
						ipLocationError: row.ipLocationError,
						deviceBrowser: row.deviceBrowser,
						deviceBrowserVersion: row.deviceBrowserVersion,
						deviceOs: row.deviceOs,
						deviceOsVersion: row.deviceOsVersion,
						deviceType: row.deviceType,
						deviceIcon: row.deviceIcon,
						deviceSource: row.deviceSource,
						deviceUpdatedAt: row.deviceUpdatedAt,
						deviceError: row.deviceError,
					},
					scope,
				)
			) {
				commentStats.skipped += 1;
				continue;
			}

			try {
				const snapshot = await resolver.resolve({
					ip: metadata.collectIp ? nonEmpty(row.authorIp) : undefined,
					userAgent: metadata.collectUserAgent
						? nonEmpty(row.authorUserAgent)
						: undefined,
					metadata,
					ipRegion,
				});
				if (!dryRun) {
					await db
						.update(commentRequestMetadata)
						.set(snapshotToColumns(snapshot))
						.where(eq(commentRequestMetadata.commentId, row.commentId));
				}
				commentStats.refreshed += 1;
			} catch {
				commentStats.failed += 1;
			}
		}
	} finally {
		resolver.close();
		sqlite.close();
	}

	console.log("request metadata backfill completed");
	console.log(
		`visitor processed: ${visitorStats.processed}, refreshed: ${visitorStats.refreshed}, skipped: ${visitorStats.skipped}, failed: ${visitorStats.failed}`,
	);
	console.log(
		`comment processed: ${commentStats.processed}, refreshed: ${commentStats.refreshed}, skipped: ${commentStats.skipped}, failed: ${commentStats.failed}`,
	);
	console.log(`dryRun: ${dryRun}`);
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
