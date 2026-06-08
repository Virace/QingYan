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
		entry: "service-action";
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
	executor: "qingyan.service";
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
				entry: "service-action",
				description:
					"程序更新由 qingyan.service 相关 update action 或外部 shell 脚本执行，更新完成后调用 qyctl upgrade 升级数据。",
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
				manualCommands: manualRecoveryCommands(),
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
			executor: "qingyan.service",
			description:
				"更新脚本会先创建整站备份，再下载并替换程序文件，随后执行 qyctl upgrade 并重启服务。",
			estimatedRestartSeconds: {
				min: 30,
				max: 60,
			},
			steps: [
				"创建整站备份",
				"下载并校验新程序",
				"停止 qingyan.service",
				"替换程序文件",
				"执行 qyctl upgrade",
				"启动 qingyan.service",
				"检查服务状态",
			],
			manualCommands: manualRecoveryCommands(),
		};
	}
}

function manualRecoveryCommands(): string[] {
	return [
		"systemctl status qingyan.service",
		"journalctl -u qingyan.service -n 120 --no-pager",
		"qyctl status",
	];
}
