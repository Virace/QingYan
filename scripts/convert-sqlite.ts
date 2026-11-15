import { runDatabaseConversionCli } from "../src/modules/database-conversion/cli";

void runDatabaseConversionCli().then((code) => {
	process.exitCode = code;
});
