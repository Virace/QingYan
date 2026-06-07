import { randomBytes } from "node:crypto";

import { AppError } from "../../shared/errors";
import { buildSuggestedMapping, type MigrationReport } from "../report";
import {
	analyzeWordPressComments,
	type AnalyzeWordPressCommentsInput,
	type ExistingPageCandidate,
} from "./analyzer";
import type { WordPressAdminUserAuthorCandidate } from "./author-mapping";
import type { ExplicitMapping, PageKeyStrategy } from "./page-key";

export interface AnalyzeWordPressAdminInput {
	siteKey: string;
	fileName: string;
	xml: string;
	sourceBasePath?: string;
	targetDistRoot?: string;
	pageKeyStrategy?: PageKeyStrategy;
	postPathTemplate?: string;
	pagePathTemplate?: string;
	mapping?: ExplicitMapping;
	existingPages?: ExistingPageCandidate[];
	adminUsers?: WordPressAdminUserAuthorCandidate[];
}

export interface WordPressAnalyzeResult {
	job: {
		id: string;
		status: "analyzed";
	};
	report: MigrationReport;
	suggestedMapping: ReturnType<typeof buildSuggestedMapping>;
}

function createEphemeralJobId() {
	return `wp_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function toAnalyzeInput(
	input: AnalyzeWordPressAdminInput,
): AnalyzeWordPressCommentsInput {
	return {
		xml: input.xml,
		fileName: input.fileName,
		siteKey: input.siteKey,
		sourceBasePath: input.sourceBasePath,
		targetDistRoot: input.targetDistRoot,
		pageKeyStrategy: input.pageKeyStrategy,
		postPathTemplate: input.postPathTemplate,
		pagePathTemplate: input.pagePathTemplate,
		mapping: input.mapping,
		existingPages: input.existingPages,
		adminUsers: input.adminUsers,
	};
}

export class WordPressAdminImportService {
	public analyze(input: AnalyzeWordPressAdminInput): WordPressAnalyzeResult {
		try {
			const report = analyzeWordPressComments(toAnalyzeInput(input));
			if (report.items.length === 0) {
				throw new Error("no migratable WordPress comment items found");
			}
			return {
				job: {
					id: createEphemeralJobId(),
					status: "analyzed",
				},
				report,
				suggestedMapping: buildSuggestedMapping(report),
			};
		} catch (error) {
			throw new AppError(
				400,
				"INVALID_REQUEST",
				"WordPress WXR XML 解析失败，请确认文件格式正确。",
				{
					cause: error instanceof Error ? error.message : String(error),
				},
			);
		}
	}
}
