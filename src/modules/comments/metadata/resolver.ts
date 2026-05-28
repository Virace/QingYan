import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import Ip2Region from "ts-ip2region2";

import type { SystemSettings } from "../../system-settings/definitions";
import type { CommentMetadataSettings } from "../../shared/site-settings-defaults";
import { parseDeviceSnapshot } from "./device";
import { parseIpRegionText } from "./ip-region";

export interface CommentMetadataSnapshot {
	authorIpCountry?: string | null;
	authorIpRegion?: string | null;
	authorIpCity?: string | null;
	authorIpIsp?: string | null;
	authorIpLocationRaw?: string | null;
	authorIpLocationSource?: string | null;
	authorIpLocationDbHash?: string | null;
	authorIpLocationUpdatedAt?: string | null;
	authorIpLocationError?: string | null;
	authorDeviceBrowser?: string | null;
	authorDeviceBrowserVersion?: string | null;
	authorDeviceOs?: string | null;
	authorDeviceOsVersion?: string | null;
	authorDeviceType?: string | null;
	authorDeviceIcon?: string | null;
	authorDeviceSource?: string | null;
	authorDeviceParserVersion?: string | null;
	authorDeviceUpdatedAt?: string | null;
	authorDeviceError?: string | null;
}

export interface CommentMetadataResolver {
	resolve(input: {
		ip?: string;
		userAgent?: string;
		metadata: CommentMetadataSettings;
		ipRegion: SystemSettings["ipRegion"];
	}): Promise<CommentMetadataSnapshot> | CommentMetadataSnapshot;
	close?(): void;
}

type IpRegionConfig = SystemSettings["ipRegion"];
type IpVersion = "v4" | "v6";

interface SearcherEntry {
	dbHash: string;
	searcher: Ip2Region;
}

function fileHash(filePath: string): string {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function nowIso(): string {
	return new Date().toISOString();
}

class IpRegionSearcherPool {
	private readonly entries = new Map<string, SearcherEntry>();

	public search(ip: string, config: IpRegionConfig): CommentMetadataSnapshot {
		const version = this.getIpVersion(ip);
		if (!version) {
			return this.error("invalid_ip");
		}

		const database = version === "v4" ? config.ipv4 : config.ipv6;
		const dbPath = path.resolve(process.cwd(), database.dbPath);
		if (!existsSync(dbPath)) {
			return this.error("xdb_not_found");
		}

		try {
			const entry = this.getEntry(dbPath, version, config.cachePolicy);
			const region = parseIpRegionText(entry.searcher.search(ip).region);

			return {
				authorIpCountry: region.country,
				authorIpRegion: region.region,
				authorIpCity: region.city,
				authorIpIsp: region.isp,
				authorIpLocationRaw: region.raw,
				authorIpLocationSource: "ip2region",
				authorIpLocationDbHash: entry.dbHash,
				authorIpLocationUpdatedAt: nowIso(),
				authorIpLocationError: null,
			};
		} catch (error) {
			return this.error(
				error instanceof Error ? error.message : "query_failed",
			);
		}
	}

	public close(): void {
		for (const entry of this.entries.values()) {
			entry.searcher.close();
		}
		this.entries.clear();
	}

	private error(message: string): CommentMetadataSnapshot {
		return {
			authorIpLocationUpdatedAt: nowIso(),
			authorIpLocationError: message,
		};
	}

	private getEntry(
		dbPath: string,
		ipVersion: IpVersion,
		cachePolicy: IpRegionConfig["cachePolicy"],
	): SearcherEntry {
		const dbHash = fileHash(dbPath);
		const key = `${ipVersion}:${cachePolicy}:${dbPath}`;
		const cached = this.entries.get(key);
		if (cached?.dbHash === dbHash) {
			return cached;
		}
		cached?.searcher.close();

		const entry = {
			dbHash,
			searcher: new Ip2Region(dbPath, { cachePolicy, ipVersion }),
		};
		this.entries.set(key, entry);
		return entry;
	}

	private getIpVersion(ip: string): IpVersion | null {
		const version = isIP(ip);
		if (version === 4) {
			return "v4";
		}
		if (version === 6) {
			return "v6";
		}

		return null;
	}
}

export class DefaultCommentMetadataResolver implements CommentMetadataResolver {
	private readonly ipRegionPool = new IpRegionSearcherPool();

	public resolve(input: {
		ip?: string;
		userAgent?: string;
		metadata: CommentMetadataSettings;
		ipRegion: SystemSettings["ipRegion"];
	}): CommentMetadataSnapshot {
		const snapshot: CommentMetadataSnapshot = {};
		if (input.ip && input.metadata.ipRegion.enabled && input.ipRegion.enabled) {
			Object.assign(
				snapshot,
				this.ipRegionPool.search(input.ip, input.ipRegion),
			);
		}
		if (input.userAgent && input.metadata.device.enabled) {
			const device = parseDeviceSnapshot(input.userAgent);
			Object.assign(snapshot, {
				authorDeviceBrowser: device.browser,
				authorDeviceBrowserVersion: device.browserVersion,
				authorDeviceOs: device.os,
				authorDeviceOsVersion: device.osVersion,
				authorDeviceType: device.type,
				authorDeviceSource: device.source,
				authorDeviceParserVersion: device.parserVersion,
				authorDeviceUpdatedAt: nowIso(),
				authorDeviceError: device.error,
			});
		}

		return snapshot;
	}

	public close(): void {
		this.ipRegionPool.close();
	}
}
