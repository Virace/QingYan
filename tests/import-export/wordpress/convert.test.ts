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

function authorMatchReportFixture(
	kind: NonNullable<
		MigrationReport["items"][number]["comments"][number]["authorMatch"]
	>["kind"],
) {
	const report = reportFixture("ready");
	report.items[0].comments = [
		{
			oldCommentId: "1",
			oldParentCommentId: null,
			status: "approved",
			authorName: "Virace",
			authorEmail: "virace@aliyun.com",
			content: "root",
			depth: 1,
			warnings: [],
			authorMatch: {
				kind,
				wpAuthorId: kind === "visitor" ? undefined : "1",
				email: kind === "visitor" ? undefined : "virace@aliyun.com",
			},
		},
	];
	report.items[0].commentSummary = {
		total: 1,
		migratable: 1,
		skipped: 0,
		maxDepth: 1,
	};
	report.summary = buildMigrationReportSummary(report.items);
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

	it("marks strong WordPress author matches as verified staff comments", () => {
		const plan = convertReportToImportPlan({
			report: authorMatchReportFixture("staff_strong"),
		});

		expect(plan.items[0].comments[0].authorIdentity).toBe("verified");
	});

	it("requires explicit decisions for WordPress author email candidates", () => {
		expect(() =>
			convertReportToImportPlan({
				report: authorMatchReportFixture("staff_email_candidate"),
			}),
		).toThrow(/Unresolved WordPress author candidates/);
	});

	it("applies explicit WordPress author email candidate decisions", () => {
		const verifiedPlan = convertReportToImportPlan({
			report: authorMatchReportFixture("staff_email_candidate"),
			authorDecisions: {
				"1": "verified",
			},
		});
		const visitorPlan = convertReportToImportPlan({
			report: authorMatchReportFixture("staff_email_candidate"),
			authorDecisions: {
				"1": "visitor",
			},
		});

		expect(verifiedPlan.items[0].comments[0].authorIdentity).toBe("verified");
		expect(visitorPlan.items[0].comments[0].authorIdentity).toBe("visitor");
	});
});
