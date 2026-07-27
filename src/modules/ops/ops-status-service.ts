import type { UpgradeRuntimeState } from "../upgrade/state";
import type { UpgradeService } from "../upgrade/upgrade-service";
import type {
	UpdateCheckResult,
	UpdateCheckService,
} from "./update-check-service";

export interface OpsStatus {
	version: {
		current: string;
	};
	update: {
		supported: boolean;
		entry: "compose-script";
		description: string;
		estimatedRestartSeconds: {
			min: 30;
			max: 60;
		};
		check: UpdateCheckResult;
	};
	upgrade: {
		state: UpgradeRuntimeState["state"];
		plan?: unknown;
	};
	backup: {
		format: "qingyan.full-backup";
		provider: "sqlite";
	};
	recovery: {
		manualCommands: string[];
	};
}

export interface UpdatePlan {
	kind: "program-update";
	executor: "./scripts/update.sh";
	description: string;
	estimatedRestartSeconds: {
		min: 30;
		max: 60;
	};
	steps: string[];
	manualCommands: string[];
}

export class OpsStatusService {
	public constructor(
		private readonly input: {
			version: string;
			upgradeService: Pick<UpgradeService, "publicState">;
			updateCheckService: Pick<UpdateCheckService, "cachedState" | "check">;
		},
	) {}

	public getStatus(): OpsStatus {
		const upgradeState = this.input.upgradeService.publicState();
		return {
			version: {
				current: this.input.version,
			},
			update: {
				supported: true,
				entry: "compose-script",
				description:
					"Docker Compose 部署使用 scripts/update.sh 完成备份、Release 切换、镜像构建、数据升级和健康检查。",
				estimatedRestartSeconds: {
					min: 30,
					max: 60,
				},
				check: this.input.updateCheckService.cachedState(),
			},
			upgrade: {
				state: upgradeState.state,
				plan:
					upgradeState.state === "upgrade_required"
						? upgradeState.plan
						: undefined,
			},
			backup: {
				format: "qingyan.full-backup",
				provider: "sqlite",
			},
			recovery: {
				manualCommands: dockerRecoveryCommands(),
			},
		};
	}

	public async checkForUpdates(): Promise<UpdateCheckResult> {
		return this.input.updateCheckService.check();
	}

	public getUpdatePlan(): UpdatePlan {
		return OpsStatusService.defaultUpdatePlan();
	}

	public static defaultUpdatePlan(): UpdatePlan {
		return {
			kind: "program-update",
			executor: "./scripts/update.sh",
			description:
				"Docker Compose 更新由 scripts/update.sh 统一编排；脚本会在写入前显示 UpgradePlan，并在失败时报告备份与恢复信息。",
			estimatedRestartSeconds: {
				min: 30,
				max: 60,
			},
			steps: [
				"创建升级前整站备份",
				"获取并切换目标 Release tag",
				"构建 Docker Compose 镜像",
				"启动新容器并确认进程运行",
				"展示并确认 UpgradePlan",
				"应用数据升级",
				"重启并校验版本与健康状态",
			],
			manualCommands: ["./scripts/update.sh"],
		};
	}
}

function dockerRecoveryCommands(): string[] {
	return ["docker compose ps", "docker compose logs --tail=200 qingyan"];
}
