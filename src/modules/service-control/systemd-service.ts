import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ServiceState = "running" | "stopped" | "unknown";

export interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

export type CommandRunner = (
	command: string,
	args: string[],
) => Promise<CommandResult>;

export interface ServiceControlController {
	status(): Promise<ServiceState>;
	start(): Promise<void>;
	stop(): Promise<void>;
	restart(): Promise<void>;
}

async function defaultRunner(
	command: string,
	args: string[],
): Promise<CommandResult> {
	try {
		const result = await execFileAsync(command, args);
		return {
			code: 0,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (error) {
		const execError = error as {
			code?: number;
			stdout?: string;
			stderr?: string;
		};
		return {
			code: typeof execError.code === "number" ? execError.code : 1,
			stdout: execError.stdout ?? "",
			stderr: execError.stderr ?? "",
		};
	}
}

export class SystemdServiceController {
	private readonly unit: string;
	private readonly runner: CommandRunner;
	private readonly platform: NodeJS.Platform;

	public constructor(options?: {
		unit?: string;
		runner?: CommandRunner;
		platform?: NodeJS.Platform;
	}) {
		this.unit = options?.unit ?? "qingyan.service";
		this.runner = options?.runner ?? defaultRunner;
		this.platform = options?.platform ?? process.platform;
	}

	private assertAvailable(): void {
		if (this.platform !== "linux") {
			throw new Error("SYSTEMD_UNAVAILABLE");
		}
	}

	private async systemctl(...args: string[]): Promise<CommandResult> {
		this.assertAvailable();
		return this.runner("systemctl", args);
	}

	public async status(): Promise<ServiceState> {
		const result = await this.systemctl("is-active", this.unit);
		const status = result.stdout.trim();
		if (result.code === 0 && status === "active") {
			return "running";
		}
		if (status === "inactive" || status === "failed" || result.code === 3) {
			return "stopped";
		}
		return "unknown";
	}

	public async start(): Promise<void> {
		const result = await this.systemctl("start", this.unit);
		if (result.code !== 0) {
			throw new Error(result.stderr.trim() || "SERVICE_START_FAILED");
		}
	}

	public async stop(): Promise<void> {
		const result = await this.systemctl("stop", this.unit);
		if (result.code !== 0) {
			throw new Error(result.stderr.trim() || "SERVICE_STOP_FAILED");
		}
	}

	public async restart(): Promise<void> {
		const result = await this.systemctl("restart", this.unit);
		if (result.code !== 0) {
			throw new Error(result.stderr.trim() || "SERVICE_RESTART_FAILED");
		}
	}

	public async runWithStoppedService<T>(
		action: () => Promise<T>,
	): Promise<{ result: T; wasRunning: boolean }> {
		const state = await this.status();
		const wasRunning = state === "running";
		if (wasRunning) {
			await this.stop();
		}
		try {
			const result = await action();
			if (wasRunning) {
				await this.start();
			}
			return { result, wasRunning };
		} catch (error) {
			if (wasRunning) {
				await this.start();
			}
			throw error;
		}
	}
}
