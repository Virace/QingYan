import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/main";
import type { UpdateCheckResult } from "../../src/modules/ops/update-check-service";

const noReleaseResult: UpdateCheckResult = {
	state: "no_release",
	currentVersion: "0.1.0",
	autoUpdatable: false,
	source: {
		provider: "github-releases",
		owner: "Virace",
		repo: "QingYan",
		url: "https://github.com/Virace/QingYan",
	},
	message:
		"更新规则已配置，但当前仓库尚未发布首个 Release，暂时没有可安装更新。",
	checkedAt: "2026-05-07T00:00:00.000Z",
};

const updateAvailableResult: UpdateCheckResult = {
	state: "update_available",
	currentVersion: "0.1.0",
	latestVersion: "0.2.0",
	tagName: "v0.2.0",
	releaseName: "QingYan v0.2.0",
	releaseUrl: "https://github.com/Virace/QingYan/releases/tag/v0.2.0",
	publishedAt: "2026-07-27T06:36:04.000Z",
	prerelease: false,
	autoUpdatable: false,
	source: {
		provider: "github-releases",
		owner: "Virace",
		repo: "QingYan",
		url: "https://github.com/Virace/QingYan",
	},
	message:
		"发现新版本，但 release 未提供 QingYan 自动更新 manifest，需要手动处理。",
	checkedAt: "2026-07-27T07:00:00.000Z",
};

describe("qingyanctl update commands", () => {
	it("prints no-release update check without executing update", async () => {
		const result = await runCli(["update", "check"], {
			updateCheckService: {
				check: async () => noReleaseResult,
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.output.stdout.join("\n")).toContain("更新检测");
		expect(result.output.stdout.join("\n")).toContain("当前版本：0.1.0");
		expect(result.output.stdout.join("\n")).toContain(
			"更新源：GitHub Release / Virace/QingYan",
		);
		expect(result.output.stdout.join("\n")).toContain("尚未发布 Release");
	});

	it("prints the latest version when an update is available", async () => {
		const result = await runCli(["update", "check"], {
			updateCheckService: {
				check: async () => updateAvailableResult,
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.output.stdout.join("\n")).toContain("当前版本：0.1.0");
		expect(result.output.stdout.join("\n")).toContain("最新版本：0.2.0");
		expect(result.output.stdout.join("\n")).toContain("状态：发现新版本");
	});

	it("prints update plan without applying update", async () => {
		const result = await runCli(["update", "plan"], {
			updatePlanService: {
				getUpdatePlan: () => ({
					kind: "program-update",
					executor: "qingyan.service",
					description: "更新脚本会先创建整站备份。",
					estimatedRestartSeconds: { min: 30, max: 60 },
					steps: ["创建整站备份", "执行 qyctl upgrade"],
					manualCommands: ["qyctl status"],
				}),
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.output.stdout.join("\n")).toContain("更新执行计划");
		expect(result.output.stdout.join("\n")).toContain("执行 qyctl upgrade");
	});
});
