import { describe, expect, it } from "vitest";

import { createServerLifecycle } from "../../src/server";

describe("server lifecycle", () => {
	it("reloads in process without calling exit", async () => {
		const events: string[] = [];
		const lifecycle = createServerLifecycle({
			resolveMode: async () =>
				events.includes("installed") ? "normal" : "install",
			startInstall: async ({ scheduleTransition }) => {
				events.push("start-install");
				events.push("installed");
				await scheduleTransition({ mode: "reload_in_process" });
			},
			startUpgrade: async () => {
				events.push("start-upgrade");
			},
			startNormal: async () => {
				events.push("start-normal");
			},
			exitProcess: () => {
				events.push("exit");
			},
			delay: async () => {},
		});

		await lifecycle.start();

		expect(events).toEqual(["start-install", "installed", "start-normal"]);
	});
});
