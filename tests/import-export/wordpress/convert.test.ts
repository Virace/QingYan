import { describe, expect, it } from "vitest";

import { buildMigrationReportSummary } from "../../../src/modules/import-export/report";
import type { MigrationReport } from "../../../src/modules/import-export/report";
import { convertReportToImportPlan } from "../../../src/modules/import-export/wordpress/convert";

function reportFixture(state: MigrationReport["items"][number]["state"]) {
	const item: MigrationReport["items"][number] = {
		state,
		wpPostId: "1",
		postType: "post",
		title: "Termux",
		link: "https://x-item.com/termux.html",
		sourcePath: "/termux.html",
		sourceRelativePath: "termux.html",
		target:
			state === "needs_user_mapping"
				? undefined
				: {
						pageKey: "termux.html",
						pageUrl: "/termux.html",
						confidence: 90,
						source: "strategy",
					},
		evidence: {
			status: state === "ready" ? "verified" : "missing",
			confidence: state === "ready" ? 90 : 0,
			reasons: [],
		},
		comments: [
			{
				oldCommentId: "2",
				oldParentCommentId: "1",
				status: "approved",
				authorName: "Child",
				content: "child",
				depth: 2,
				warnings: [],
			},
			{
				oldCommentId: "1",
				oldParentCommentId: null,
				status: "approved",
				authorName: "Root",
				content: "root",
				depth: 1,
				warnings: [],
			},
		],
		commentSummary: {
			total: 2,
			migratable: 2,
			skipped: 0,
			maxDepth: 2,
		},
		warnings: [],
	};
	const report: MigrationReport = {
		siteKey: "fangyuan",
		source: { type: "wordpress-wxr", fileName: "fixture.xml" },
		sourceBasePath: "/",
		createdAt: "2026-05-04T00:00:00.000Z",
		wxr: {},
		sourcePathExamples: [],
		items: [item],
		summary: buildMigrationReportSummary([item]),
	};
	return report;
}

describe("convertReportToImportPlan", () => {
	it("rejects unresolved reports", () => {
		expect(() =>
			convertReportToImportPlan({
				report: reportFixture("needs_user_mapping"),
			}),
		).toThrow(/Cannot convert unresolved migration report/);
	});

	it("converts ready rows into parent-before-child import plan comments", () => {
		const plan = convertReportToImportPlan({
			report: reportFixture("ready"),
			now: new Date("2026-05-04T00:00:00.000Z"),
		});

		expect(plan.summary).toMatchObject({
			itemCount: 1,
			commentCount: 2,
			maxCommentDepth: 2,
		});
		expect(
			plan.items[0].comments.map((comment) => comment.source.oldCommentId),
		).toEqual(["1", "2"]);
	});
});
