import { runDatabaseConversionCli } from "./cli";

void runDatabaseConversionCli().then((code) => {
	process.exitCode = code;
});
