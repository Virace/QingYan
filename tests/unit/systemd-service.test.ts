import { describe, expect, it } from "vitest";

import {
	type CommandRunner,
	SystemdServiceController,
} from "../../src/modules/service-control/systemd-service";

function createRunner(
	outputs: Array<{ code: number; stdout?: string; stderr?: string }>,
) {
	const calls: Array<{ command: string; args: string[] }> = [];
	const runner: CommandRunner = async (command, args) => {
		calls.push({ command, args });
		const next = outputs.shift() ?? { code: 0, stdout: "" };
		return {
			code: next.code,
			stdout: next.stdout ?? "",
			stderr: next.stderr ?? "",
		};
	};
	return { calls, runner };
}

describe("SystemdServiceController", () => {
	it("maps active status to running", async () => {
		const fake = createRunner([{ code: 0, stdout: "active\n" }]);
		const controller = new SystemdServiceController({
			runner: fake.runner,
			platform: "linux",
		});

		await expect(controller.status()).resolves.toBe("running");
		expect(fake.calls[0]).toEqual({
			command: "systemctl",
			args: ["is-active", "qingyan.service"],
		});
	});

	it("maps inactive status to stopped", async () => {
		const fake = createRunner([{ code: 3, stdout: "inactive\n" }]);
		const controller = new SystemdServiceController({
			runner: fake.runner,
			platform: "linux",
		});

		await expect(controller.status()).resolves.toBe("stopped");
	});

	it("rejects non-linux platforms", async () => {
		const fake = createRunner([]);
		const controller = new SystemdServiceController({
			runner: fake.runner,
			platform: "win32",
		});

		await expect(controller.status()).rejects.toThrow("SYSTEMD_UNAVAILABLE");
	});

	it("stops and restarts around actions when service is running", async () => {
		const fake = createRunner([
			{ code: 0, stdout: "active\n" },
			{ code: 0 },
			{ code: 0 },
		]);
		const controller = new SystemdServiceController({
			runner: fake.runner,
			platform: "linux",
		});

		const result = await controller.runWithStoppedService(async () => "done");

		expect(result).toEqual({ result: "done", wasRunning: true });
		expect(fake.calls.map((call) => call.args[0])).toEqual([
			"is-active",
			"stop",
			"start",
		]);
	});

	it("keeps stopped services stopped after actions", async () => {
		const fake = createRunner([{ code: 3, stdout: "inactive\n" }]);
		const controller = new SystemdServiceController({
			runner: fake.runner,
			platform: "linux",
		});

		const result = await controller.runWithStoppedService(async () => "done");

		expect(result).toEqual({ result: "done", wasRunning: false });
		expect(fake.calls.map((call) => call.args[0])).toEqual(["is-active"]);
	});
});
