import { loadConfig, resolveConfigPath } from "./load-config";

async function main(): Promise<void> {
	const configPath = process.argv[2];
	const config = await loadConfig(configPath);
	console.log(`配置检查通过: ${resolveConfigPath(configPath)}`);
	console.log(`服务地址: ${config.server.host}:${config.server.port}`);
	console.log(`数据库文件: ${config.database.sqlite.file}`);
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
