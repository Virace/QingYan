export interface GitHubReleaseAsset {
	name: string;
	browserDownloadUrl?: string;
	size?: number;
}

export interface GitHubRelease {
	tagName: string;
	name?: string;
	htmlUrl?: string;
	publishedAt?: string;
	prerelease: boolean;
	assets: GitHubReleaseAsset[];
}

export type GitHubLatestReleaseResult =
	| { kind: "found"; release: GitHubRelease }
	| { kind: "not_found" }
	| { kind: "rate_limited" }
	| { kind: "failed"; errorCode: string; message: string };

export interface ReleaseFetchResponse {
	status: number;
	ok: boolean;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

export type ReleaseFetch = (
	url: string,
	init: { headers: Record<string, string> },
) => Promise<ReleaseFetchResponse>;

export class GitHubReleaseClient {
	public constructor(
		private readonly options: {
			owner: string;
			repo: string;
			fetchImpl?: ReleaseFetch;
		},
	) {}

	public latestUrl(): string {
		return `https://api.github.com/repos/${this.options.owner}/${this.options.repo}/releases/latest`;
	}

	public sourceUrl(): string {
		return `https://github.com/${this.options.owner}/${this.options.repo}`;
	}

	public async fetchLatest(): Promise<GitHubLatestReleaseResult> {
		const fetchImpl = this.options.fetchImpl ?? fetch;
		try {
			const response = await fetchImpl(this.latestUrl(), {
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "QingYan-Update-Checker",
				},
			});
			if (response.status === 404) {
				return { kind: "not_found" };
			}
			if (response.status === 403) {
				return { kind: "rate_limited" };
			}
			if (!response.ok) {
				return {
					kind: "failed",
					errorCode: "GITHUB_RELEASE_REQUEST_FAILED",
					message: `GitHub release request failed with status ${response.status}`,
				};
			}
			return parseGitHubReleasePayload(await response.json());
		} catch (error) {
			return {
				kind: "failed",
				errorCode: "NETWORK_ERROR",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}
}

function parseGitHubReleasePayload(
	payload: unknown,
): GitHubLatestReleaseResult {
	if (!payload || typeof payload !== "object") {
		return {
			kind: "failed",
			errorCode: "INVALID_RELEASE_RESPONSE",
			message: "GitHub release response is not an object",
		};
	}
	const record = payload as Record<string, unknown>;
	if (typeof record.tag_name !== "string") {
		return {
			kind: "failed",
			errorCode: "INVALID_RELEASE_RESPONSE",
			message: "GitHub release response is missing tag_name",
		};
	}
	return {
		kind: "found",
		release: {
			tagName: record.tag_name,
			name: typeof record.name === "string" ? record.name : undefined,
			htmlUrl:
				typeof record.html_url === "string" ? record.html_url : undefined,
			publishedAt:
				typeof record.published_at === "string"
					? record.published_at
					: undefined,
			prerelease: record.prerelease === true,
			assets: parseAssets(record.assets),
		},
	};
}

function parseAssets(payload: unknown): GitHubReleaseAsset[] {
	if (!Array.isArray(payload)) {
		return [];
	}
	return payload.flatMap((asset): GitHubReleaseAsset[] => {
		if (!asset || typeof asset !== "object") {
			return [];
		}
		const record = asset as Record<string, unknown>;
		if (typeof record.name !== "string") {
			return [];
		}
		return [
			{
				name: record.name,
				browserDownloadUrl:
					typeof record.browser_download_url === "string"
						? record.browser_download_url
						: undefined,
				size: typeof record.size === "number" ? record.size : undefined,
			},
		];
	});
}
