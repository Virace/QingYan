import { describe, expect, it } from "vitest";

import type { GitHubLatestReleaseResult } from "../../src/modules/ops/github-release-client";
import { UpdateCheckService } from "../../src/modules/ops/update-check-service";

function checker(result: GitHubLatestReleaseResult) {
	return new UpdateCheckService({
		currentVersion: "0.1.0",
		source: {
			provider: "github-releases",
			owner: "Virace",
			repo: "QingYan",
			url: "https://github.com/Virace/QingYan",
		},
		fetchLatest: async () => result,
		now: () => new Date("2026-05-07T00:00:00.000Z"),
	});
}

describe("update check service", () => {
	it("returns no_release when GitHub has no published releases", async () => {
		const result = await checker({ kind: "not_found" }).check();

		expect(result).toMatchObject({
			state: "no_release",
			currentVersion: "0.1.0",
			autoUpdatable: false,
			message:
				"更新规则已配置，但当前仓库尚未发布首个 Release，暂时没有可安装更新。",
		});
		expect(result.source.repo).toBe("QingYan");
		expect(result.checkedAt).toBe("2026-05-07T00:00:00.000Z");
	});

	it("returns current when latest release equals current version", async () => {
		const result = await checker({
			kind: "found",
			release: {
				tagName: "v0.1.0",
				name: "QingYan 0.1.0",
				htmlUrl: "https://github.com/Virace/QingYan/releases/tag/v0.1.0",
				publishedAt: "2026-05-07T00:00:00.000Z",
				prerelease: false,
				assets: [],
			},
		}).check();

		expect(result.state).toBe("current");
		expect(result.latestVersion).toBe("0.1.0");
		expect(result.releaseName).toBe("QingYan 0.1.0");
	});

	it("returns update_available for a newer release without auto-update assets", async () => {
		const result = await checker({
			kind: "found",
			release: {
				tagName: "v0.2.0",
				name: "QingYan 0.2.0",
				htmlUrl: "https://github.com/Virace/QingYan/releases/tag/v0.2.0",
				publishedAt: "2026-05-07T00:00:00.000Z",
				prerelease: false,
				assets: [],
			},
		}).check();

		expect(result.state).toBe("update_available");
		expect(result.latestVersion).toBe("0.2.0");
		expect(result.autoUpdatable).toBe(false);
		expect(result.message).toContain("未提供 QingYan 自动更新 manifest");
		expect(result.message).toContain("./scripts/update.sh");
	});

	it("marks newer releases with required assets as auto-updatable", async () => {
		const result = await checker({
			kind: "found",
			release: {
				tagName: "v0.2.0",
				prerelease: false,
				assets: [
					{ name: "qingyan-v0.2.0-linux-x64.tar.gz" },
					{ name: "qingyan-v0.2.0-linux-x64.sha256" },
					{ name: "qingyan-update-manifest.json" },
				],
			},
		}).check();

		expect(result.state).toBe("update_available");
		expect(result.autoUpdatable).toBe(true);
	});

	it("returns unsupported_release for invalid release tags", async () => {
		const result = await checker({
			kind: "found",
			release: {
				tagName: "nightly",
				prerelease: false,
				assets: [],
			},
		}).check();

		expect(result.state).toBe("unsupported_release");
		expect(result.errorCode).toBe("UNSUPPORTED_RELEASE_TAG");
	});

	it("returns check_failed for network errors", async () => {
		const result = await checker({
			kind: "failed",
			errorCode: "NETWORK_ERROR",
			message: "fetch failed",
		}).check();

		expect(result.state).toBe("check_failed");
		expect(result.errorCode).toBe("NETWORK_ERROR");
	});
});
