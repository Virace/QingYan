import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import { applyStartupEnvOverrides } from "./env-mapping";
import {
	configSchema,
	type AppConfig,
	withTransitionalRuntimeDefaults,
} from "./types";

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "config/qingyan.yml");

export function resolveConfigPath(
	configPath = process.env.QINGYAN_CONFIG_PATH,
): string {
	return configPath
		? path.resolve(process.cwd(), configPath)
		: DEFAULT_CONFIG_PATH;
}

export async function loadConfig(
	configPath = process.env.QINGYAN_CONFIG_PATH,
	environment: NodeJS.ProcessEnv = process.env,
): Promise<AppConfig> {
	const resolvedPath = resolveConfigPath(configPath);
	const fileContent = await readFile(resolvedPath, "utf-8");
	const parsed = parse(fileContent) as unknown;
	const validated = configSchema.safeParse(
		applyStartupEnvOverrides(parsed, environment),
	);

	if (!validated.success) {
		throw new Error(
			`配置文件校验失败: ${resolvedPath}\n${validated.error.issues
				.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
				.join("\n")}`,
		);
	}

	return withTransitionalRuntimeDefaults(validated.data);
}
