import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	buildSuggestedMapping,
	renderMigrationReportMarkdown,
} from "../src/modules/import-export/report";
import { analyzeWordPressComments } from "../src/modules/import-export/wordpress/analyzer";
import { convertReportToImportPlan } from "../src/modules/import-export/wordpress/convert";
import type {
	ExplicitMapping,
	PageKeyStrategy,
} from "../src/modules/import-export/wordpress/page-key";

interface CliOptions {
	command: string;
	file?: string;
	siteKey?: string;
	sourceBasePath?: string;
	targetDistRoot?: string;
	pageKeyStrategy?: PageKeyStrategy;
	mapping?: string;
	report?: string;
	out?: string;
	markdownOut?: string;
	mappingOut?: string;
}

const strategyValues = new Set<PageKeyStrategy>([
	"path_without_leading_slash",
	"path_with_leading_slash",
	"page_url_path",
	"custom_template",
	"explicit_only",
]);

function parseArgs(argv: string[]): CliOptions {
	const [command, ...rest] = argv;
	const options: CliOptions = { command: command ?? "" };
	for (let index = 0; index < rest.length; index += 2) {
		const key = rest[index];
		const value = rest[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error(`Invalid argument pair: ${key ?? ""}`);
		}
		switch (key) {
			case "--file":
				options.file = value;
				break;
			case "--site-key":
				options.siteKey = value;
				break;
			case "--source-base-path":
				options.sourceBasePath = value;
				break;
			case "--target-dist-root":
				options.targetDistRoot = value;
				break;
			case "--page-key-strategy":
				if (!strategyValues.has(value as PageKeyStrategy)) {
					throw new Error(`Unsupported page key strategy: ${value}`);
				}
				options.pageKeyStrategy = value as PageKeyStrategy;
				break;
			case "--mapping":
				options.mapping = value;
				break;
			case "--report":
				options.report = value;
				break;
			case "--out":
				options.out = value;
				break;
			case "--markdown-out":
				options.markdownOut = value;
				break;
			case "--mapping-out":
				options.mappingOut = value;
				break;
			default:
				throw new Error(`Unsupported argument: ${key}`);
		}
	}
	return options;
}

function readJsonFile<T>(filePath: string): T {
	return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function requireFile(filePath: string | undefined, label: string): string {
	if (!filePath) {
		throw new Error(`Missing required ${label}`);
	}
	if (!existsSync(filePath)) {
		throw new Error(`${label} does not exist: ${filePath}`);
	}
	return filePath;
}

function requireValue(value: string | undefined, label: string): string {
	if (!value) {
		throw new Error(`Missing required ${label}`);
	}
	return value;
}

function writeJson(filePath: string, value: unknown): void {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function runAnalyze(options: CliOptions): void {
	const wxrFile = requireFile(options.file, "--file");
	const siteKey = requireValue(options.siteKey, "--site-key");
	const mapping = options.mapping
		? readJsonFile<ExplicitMapping>(requireFile(options.mapping, "--mapping"))
		: undefined;
	const report = analyzeWordPressComments({
		xml: readFileSync(wxrFile, "utf-8"),
		fileName: wxrFile,
		siteKey,
		sourceBasePath: options.sourceBasePath,
		targetDistRoot: options.targetDistRoot,
		pageKeyStrategy: options.pageKeyStrategy,
		mapping,
	});
	const out = options.out ?? ".temp/wp-comment-migration-report.json";
	const markdownOut =
		options.markdownOut ?? ".temp/wp-comment-migration-report.md";
	const mappingOut = options.mappingOut ?? ".temp/wp-comment-mapping.json";
	writeJson(out, report);
	writeFileSync(markdownOut, renderMigrationReportMarkdown(report), "utf-8");
	writeJson(mappingOut, buildSuggestedMapping(report));
	console.log(`Wrote JSON report: ${path.resolve(out)}`);
	console.log(`Wrote Markdown report: ${path.resolve(markdownOut)}`);
	console.log(`Wrote suggested mapping: ${path.resolve(mappingOut)}`);
	console.log("No database writes occurred.");
}

function runConvert(options: CliOptions): void {
	const reportFile = requireFile(options.report, "--report");
	const report =
		readJsonFile<Parameters<typeof convertReportToImportPlan>[0]["report"]>(
			reportFile,
		);
	const plan = convertReportToImportPlan({ report });
	const out = options.out ?? ".temp/qingyan-comment-import-plan.json";
	writeJson(out, plan);
	console.log(`Wrote import plan: ${path.resolve(out)}`);
	console.log("No database writes occurred.");
}

function main(): void {
	const options = parseArgs(process.argv.slice(2));
	switch (options.command) {
		case "analyze":
			runAnalyze(options);
			return;
		case "convert":
			runConvert(options);
			return;
		default:
			throw new Error("Expected subcommand: analyze or convert");
	}
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
