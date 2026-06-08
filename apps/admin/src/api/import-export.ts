import { requestJson } from "./client";

export type MigrationItemState =
	| "ready"
	| "needs_user_mapping"
	| "ambiguous"
	| "unverified"
	| "conflict"
	| "skipped";

export interface MigrationReportSummary {
	totalItems: number;
	ready: number;
	needsUserMapping: number;
	ambiguous: number;
	unverified: number;
	conflict: number;
	skipped: number;
	totalComments: number;
	maxCommentDepth: number;
	warningCount: number;
}

export interface MigrationReportItem {
	state: MigrationItemState;
	wpPostId: string;
	postType: "post" | "page";
	title: string;
	link: string;
	sourcePath: string;
	sourceRelativePath: string;
	target?: {
		pageKey: string;
		pageUrl?: string;
		confidence: number;
		source: "explicit_mapping" | "strategy" | "metadata" | "none";
	};
	evidence: {
		status: "verified" | "unverified" | "ambiguous" | "missing" | "skipped";
		distPath?: string;
		title?: string;
		h1?: string;
		canonical?: string;
		ogTitle?: string;
		confidence: number;
		reasons: string[];
	};
	commentSummary: {
		total: number;
		migratable: number;
		skipped: number;
		maxDepth: number;
	};
	comments: Array<{
		oldCommentId: string;
		oldParentCommentId: string | null;
		status: string;
		authorName: string;
		authorEmail?: string;
		content: string;
		depth: number;
		warnings: string[];
		authorMatch?: {
			kind:
				| "staff_strong"
				| "staff_existing_user"
				| "staff_email_candidate"
				| "registered_unknown"
				| "visitor";
			wpAuthorId?: string;
			email?: string;
			adminUser?: {
				id: number;
				displayName: string;
				username?: string;
				status?: string;
			};
		};
	}>;
	warnings: string[];
}

export interface MigrationReport {
	siteKey: string;
	source: {
		type: "wordpress-wxr";
		fileName: string;
	};
	sourceBasePath: string;
	createdAt: string;
	wxr: {
		title?: string;
		link?: string;
		baseSiteUrl?: string;
		baseBlogUrl?: string;
		version?: string;
	};
	authorSummary?: {
		totalAuthors: number;
		staffStrong: number;
		staffExistingUser?: number;
		staffEmailCandidate: number;
		registeredUnknown: number;
		visitor: number;
	};
	htmlContentSummary?: {
		htmlLikeComments: number;
		examples: Array<{
			oldCommentId: string;
			snippet: string;
		}>;
	};
	items: MigrationReportItem[];
	summary: MigrationReportSummary;
}

export interface SuggestedMapping {
	siteKey: string;
	sourceBasePath: string;
	items: Array<{
		wpPostId: string;
		sourceRelativePath: string;
		state: MigrationItemState;
		title: string;
		decision: "map";
		target: {
			pageKey: string;
			pageUrl: string;
		};
		reason: string;
	}>;
}

export interface WordPressAnalyzePayload {
	siteKey: string;
	fileName: string;
	file: File;
	sourceBasePath?: string;
	targetDistRoot?: string;
	pageKeyStrategy?: string;
	postPathTemplate?: string;
	pagePathTemplate?: string;
	mapping?: unknown;
}

export interface WordPressAnalyzeResult {
	job: {
		id: string;
		status: "analyzed";
	};
	report: MigrationReport;
	suggestedMapping: SuggestedMapping;
}

export interface ImportPlanSummary {
	itemCount: number;
	commentCount: number;
	maxCommentDepth: number;
	warningCount: number;
}

export interface WordPressPlanResult {
	job: {
		id: string;
		status: "planned";
	};
	plan: {
		summary: ImportPlanSummary;
	};
}

export interface ImportDryRunResult {
	job: {
		id: string;
		status: "dry_run_passed" | "dry_run_failed";
	};
	dryRun: {
		summary: {
			willCreatePageThreads: number;
			willReusePageThreads: number;
			willCreateComments: number;
			willSkipExistingComments: number;
			conflicts: number;
			warnings: number;
		};
	};
}

export interface ImportApplyResult {
	job: {
		id: string;
		status: "applied";
	};
	apply: {
		summary: {
			createdPageThreads: number;
			reusedPageThreads: number;
			createdComments: number;
			skippedExistingComments: number;
			importRecordsCreated: number;
		};
	};
	backup: ImportJobBackup | null;
}

export interface QingYanExportPayload {
	format: "qingyan.export.v1";
	formatVersion: 2;
	scope: {
		type: "site";
		siteKey: string;
	};
	data: {
		site: unknown;
		siteSettings?: unknown;
		systemSettings?: unknown;
		pageThreads: unknown[];
		visitors: unknown[];
		comments: unknown[];
		voteRecords: unknown[];
		pageFeedbackRecords: unknown[];
		blacklistRules: unknown[];
	};
}

export interface QingYanDryRunResult {
	job: {
		id: string;
		status: "dry_run_passed" | "dry_run_failed";
	};
	dryRun: {
		summary: {
			willCreatePageThreads: number;
			willReusePageThreads: number;
			willCreateVisitors: number;
			willReuseVisitors: number;
			willCreateComments: number;
			willSkipExistingComments: number;
			conflicts: number;
			warnings: number;
		};
	};
}

export interface QingYanApplyResult {
	job: {
		id: string;
		status: "applied";
	};
	apply: {
		summary: {
			createdPageThreads: number;
			reusedPageThreads: number;
			createdVisitors: number;
			reusedVisitors: number;
			createdComments: number;
			skippedExistingComments: number;
			importRecordsCreated: number;
		};
	};
	backup: ImportJobBackup | null;
}

export interface ImportJobBackupFile {
	role: "database" | "wal" | "shm" | "metadata";
	path: string;
	backupPath: string | null;
	present: boolean;
	size: number | null;
	sha256: string | null;
}

export interface ImportJobBackup {
	kind: "import_database_backup";
	engine: string;
	strategy: string;
	createdAt: string;
	backupDirectory: string;
	databaseBackupPath?: string;
	files: ImportJobBackupFile[];
	notes: string[];
}

export interface ImportJobListItem {
	id: string;
	siteId: number;
	sourceType: string;
	sourceFileName: string;
	format: string;
	formatVersion: number;
	status: string;
	createdAt: string;
	updatedAt: string;
	appliedAt: string | null;
	summary: unknown;
	backup: ImportJobBackup | null;
	error: unknown;
}

export interface ImportJobsResult {
	items: ImportJobListItem[];
	nextCursor: string | null;
}

export interface ImportJobDetailResult {
	job: ImportJobListItem;
}

function queryString(input: Record<string, string | undefined>) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(input)) {
		if (value !== undefined && value !== "") {
			params.set(key, value);
		}
	}

	return params.toString();
}

export function analyzeWordPressMigration(input: WordPressAnalyzePayload) {
	const mappingJson = input.mapping ? JSON.stringify(input.mapping) : undefined;
	const query = queryString({
		siteKey: input.siteKey,
		fileName: input.fileName,
		sourceBasePath: input.sourceBasePath,
		targetDistRoot: input.targetDistRoot,
		pageKeyStrategy: input.pageKeyStrategy,
		postPathTemplate: input.postPathTemplate,
		pagePathTemplate: input.pagePathTemplate,
		mappingJson,
	});
	return requestJson<WordPressAnalyzeResult>(
		`/api/admin/import-export/wordpress/analyze?${query}`,
		{
			method: "POST",
			headers: {
				"content-type": input.file.type || "application/xml",
			},
			body: input.file,
		},
	);
}

export function convertWordPressJobToPlan(
	jobId: string,
	input?: {
		authorDecisions?: Record<string, "staff" | "verified" | "visitor">;
	},
) {
	return requestJson<WordPressPlanResult>(
		`/api/admin/import-export/wordpress/jobs/${encodeURIComponent(jobId)}/plan`,
		{
			method: "POST",
			body: input ? JSON.stringify(input) : undefined,
		},
	);
}

export function dryRunImportJob(
	jobId: string,
	input: { existingStrategy: "fail_on_existing" | "skip_existing" },
) {
	return requestJson<ImportDryRunResult>(
		`/api/admin/import-export/jobs/${encodeURIComponent(jobId)}/dry-run`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function applyImportJob(
	jobId: string,
	input: { existingStrategy: "fail_on_existing" | "skip_existing" },
) {
	return requestJson<ImportApplyResult>(
		`/api/admin/import-export/jobs/${encodeURIComponent(jobId)}/apply`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function exportQingYanData(input: {
	siteKey: string;
	include: {
		siteSettings?: boolean;
		systemSettings?: boolean;
		pageThreads: boolean;
		comments: boolean;
		rawUserAgent?: boolean;
		visitors: boolean;
		voteRecords: boolean;
		pageFeedbackRecords: boolean;
		blacklistRules: boolean;
	};
}) {
	return requestJson<QingYanExportPayload>("/api/admin/import-export/export", {
		method: "POST",
		body: JSON.stringify({
			siteKey: input.siteKey,
			format: "qingyan.export.v1",
			include: input.include,
		}),
	});
}

export function dryRunQingYanImport(input: {
	siteKey: string;
	fileName: string;
	payload: unknown;
	existingStrategy: "fail_on_existing" | "skip_existing";
}) {
	return requestJson<QingYanDryRunResult>(
		"/api/admin/import-export/qingyan/dry-run",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function applyQingYanImportJob(
	jobId: string,
	input: { existingStrategy: "fail_on_existing" | "skip_existing" },
) {
	return requestJson<QingYanApplyResult>(
		`/api/admin/import-export/qingyan/jobs/${encodeURIComponent(jobId)}/apply`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
}

export function listImportJobs(input: {
	siteKey?: string;
	status?: string;
	sourceType?: string;
	limit?: number;
}) {
	const query = queryString({
		siteKey: input.siteKey,
		status: input.status,
		sourceType: input.sourceType,
		limit: input.limit ? String(input.limit) : undefined,
	});
	return requestJson<ImportJobsResult>(
		`/api/admin/import-export/jobs?${query}`,
	);
}

export function getImportJob(jobId: string) {
	return requestJson<ImportJobDetailResult>(
		`/api/admin/import-export/jobs/${encodeURIComponent(jobId)}`,
	);
}
