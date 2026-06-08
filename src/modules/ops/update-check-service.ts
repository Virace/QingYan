import type { GitHubLatestReleaseResult } from "./github-release-client";
import {
	compareParsedReleaseVersions,
	parseReleaseVersion,
} from "./release-version";

export type UpdateCheckState =
	| "not_checked"
	| "no_release"
	| "current"
	| "update_available"
	| "unsupported_release"
	| "check_failed";

export interface UpdateSourceInfo {
	provider: "github-releases";
	owner: string;
	repo: string;
	url: string;
}

export interface UpdateCheckResult {
	state: UpdateCheckState;
	currentVersion: string;
	latestVersion?: string;
	releaseName?: string;
	releaseUrl?: string;
	tagName?: string;
	publishedAt?: string;
	prerelease?: boolean;
	autoUpdatable: boolean;
	source: UpdateSourceInfo;
	message: string;
	checkedAt?: string;
	errorCode?: string;
}

export class UpdateCheckService {
	private cachedResult?: UpdateCheckResult;

	public constructor(
		private readonly options: {
			currentVersion: string;
			source: UpdateSourceInfo;
			fetchLatest: () => Promise<GitHubLatestReleaseResult>;
			now?: () => Date;
		},
	) {}

	public initialState(): UpdateCheckResult {
		return {
			state: "not_checked",
			currentVersion: this.options.currentVersion,
			autoUpdatable: false,
			source: this.options.source,
			message: "尚未检查更新。",
		};
	}

	public cachedState(): UpdateCheckResult {
		return this.cachedResult ?? this.initialState();
	}

	public async check(): Promise<UpdateCheckResult> {
		const checkedAt = (this.options.now?.() ?? new Date()).toISOString();
		const result = this.mapLatestResult(
			await this.options.fetchLatest(),
			checkedAt,
		);
		this.cachedResult = result;
		return result;
	}

	private mapLatestResult(
		latest: GitHubLatestReleaseResult,
		checkedAt: string,
	): UpdateCheckResult {
		if (latest.kind === "not_found") {
			return {
				state: "no_release",
				currentVersion: this.options.currentVersion,
				autoUpdatable: false,
				source: this.options.source,
				message:
					"更新规则已配置，但当前仓库尚未发布首个 Release，暂时没有可安装更新。",
				checkedAt,
			};
		}
		if (latest.kind === "rate_limited") {
			return {
				state: "check_failed",
				currentVersion: this.options.currentVersion,
				autoUpdatable: false,
				source: this.options.source,
				message: "GitHub Release 检查被限流，请稍后重试。",
				checkedAt,
				errorCode: "GITHUB_RATE_LIMITED",
			};
		}
		if (latest.kind === "failed") {
			return {
				state: "check_failed",
				currentVersion: this.options.currentVersion,
				autoUpdatable: false,
				source: this.options.source,
				message: "无法连接 GitHub Release 更新源，请稍后重试或手动检查。",
				checkedAt,
				errorCode: latest.errorCode,
			};
		}
		return this.mapFoundRelease(latest, checkedAt);
	}

	private mapFoundRelease(
		latest: Extract<GitHubLatestReleaseResult, { kind: "found" }>,
		checkedAt: string,
	): UpdateCheckResult {
		const currentVersion = parseReleaseVersion(this.options.currentVersion);
		const latestVersion = parseReleaseVersion(latest.release.tagName);
		if (!currentVersion || !latestVersion) {
			return {
				state: "unsupported_release",
				currentVersion: this.options.currentVersion,
				autoUpdatable: false,
				source: this.options.source,
				message: "发现 Release，但 tag 不符合 QingYan 版本规则。",
				checkedAt,
				errorCode: "UNSUPPORTED_RELEASE_TAG",
				tagName: latest.release.tagName,
			};
		}
		const base = {
			currentVersion: this.options.currentVersion,
			latestVersion: latestVersion.normalized,
			releaseName: latest.release.name,
			releaseUrl: latest.release.htmlUrl,
			tagName: latest.release.tagName,
			publishedAt: latest.release.publishedAt,
			prerelease: latest.release.prerelease,
			source: this.options.source,
			checkedAt,
		};
		if (compareParsedReleaseVersions(latestVersion, currentVersion) <= 0) {
			return {
				...base,
				state: "current",
				autoUpdatable: false,
				message: "当前已是最新版本。",
			};
		}
		const autoUpdatable = hasRequiredAutoUpdateAssets(
			latestVersion.normalized,
			latest.release.assets.map((asset) => asset.name),
		);
		return {
			...base,
			state: "update_available",
			autoUpdatable,
			message: autoUpdatable
				? "发现新版本，可由服务更新脚本处理。"
				: "发现新版本，但 release 未提供 QingYan 自动更新 manifest，需要手动处理。",
		};
	}
}

function hasRequiredAutoUpdateAssets(version: string, assetNames: string[]) {
	const names = new Set(assetNames);
	return [
		`qingyan-v${version}-linux-x64.tar.gz`,
		`qingyan-v${version}-linux-x64.sha256`,
		"qingyan-update-manifest.json",
	].every((name) => names.has(name));
}
