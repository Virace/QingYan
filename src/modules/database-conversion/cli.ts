import path from "node:path";
import { parseArgs } from "node:util";
import {
	analyzeSqliteSource,
	convertSqliteDatabase,
	safeConversionError,
	switchConversionConfiguration,
	verifyConversionArtifact,
} from "./service";

export async function runDatabaseConversionCli(
	args = process.argv.slice(2),
): Promise<number> {
	try {
		const { values, positionals } = parseArgs({
			args,
			allowPositionals: true,
			options: {
				source: { type: "string" },
				output: { type: "string" },
				config: { type: "string" },
				"source-root": { type: "string" },
				"source-runtime-root": { type: "string" },
				"database-url-env": { type: "string", default: "QINGYAN_DATABASE_URL" },
				"source-stopped": { type: "boolean", default: false },
				destination: { type: "string" },
				"expected-config-checksum": { type: "string" },
				help: { type: "boolean" },
			},
		});
		const operation = positionals[0] ?? "analyze";
		if (values.help) {
			console.log(
				"db:convert analyze|convert|verify|apply-config --source <0.2.5.db> --config <qingyan.yml> --output <new-directory> [--source-root <host-instance-root> --source-runtime-root /app] [--source-stopped] [--database-url-env QINGYAN_DATABASE_URL]\napply-config additionally requires --destination <existing-config> --expected-config-checksum <sha256>. Database URL is read only from the named environment variable.",
			);
			return 0;
		}
		if (!values.output) throw new Error("CONVERSION_OUTPUT_REQUIRED");
		const outputDirectory = path.resolve(values.output);
		if (operation === "analyze") {
			if (!values.source) throw new Error("CONVERSION_SOURCE_REQUIRED");
			console.log(
				JSON.stringify(
					await analyzeSqliteSource(
						path.resolve(values.source),
						outputDirectory,
					),
				),
			);
			return 0;
		}
		const databaseUrl = process.env[values["database-url-env"]];
		if (!databaseUrl) throw new Error("CONVERSION_DATABASE_URL_ENV_REQUIRED");
		if (operation === "verify") {
			const verification = await verifyConversionArtifact(
				databaseUrl,
				outputDirectory,
			);
			console.log(
				JSON.stringify({
					verified: verification.verified,
					comparedFields: verification.comparedFields,
					tables: verification.tables.length,
					elapsedMs: verification.elapsedMs,
				}),
			);
			return 0;
		}
		if (operation === "apply-config") {
			if (!values.destination || !values["expected-config-checksum"])
				throw new Error("CONFIG_SWITCH_EXPLICIT_TARGET_REQUIRED");
			console.log(
				JSON.stringify(
					await switchConversionConfiguration(
						databaseUrl,
						outputDirectory,
						path.resolve(values.destination),
						values["expected-config-checksum"],
					),
				),
			);
			return 0;
		}
		if (operation !== "convert")
			throw new Error("CONVERSION_OPERATION_UNSUPPORTED");
		if (!values.source) throw new Error("CONVERSION_SOURCE_REQUIRED");
		const report = await convertSqliteDatabase({
			sourcePath: path.resolve(values.source),
			databaseUrl,
			outputDirectory,
			sourceConfigPath: values.config ? path.resolve(values.config) : undefined,
			sourceRoot: values["source-root"]
				? path.resolve(values["source-root"])
				: undefined,
			sourceRuntimeRoot: values["source-runtime-root"],
			sourceStopped: values["source-stopped"],
			onProgress: (table, count) =>
				console.log(JSON.stringify({ table, imported: count })),
		});
		console.log(
			JSON.stringify({
				conversionId: report.conversionId,
				verified: report.verification.verified,
				comparedFields: report.verification.comparedFields,
				elapsedMs: report.elapsedMs,
				peakRssBytes: report.peakRssBytes,
				targetBytes: report.targetBytes,
				configurationSwitchReady:
					report.configuration?.readyForConfigSwitch ?? false,
			}),
		);
		return 0;
	} catch (error) {
		console.error(safeConversionError(error));
		return 1;
	}
}
