import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { buildApp } from "../../src/app";
import { comments } from "../../src/db/schema";
import {
	applyInitialMigration,
	createTestConfig,
} from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

async function createCustomTestApp(options?: {
	require?: Array<"nickname" | "email" | "website">;
	allowWebsite?: boolean;
}) {
	const directory = mkdtempSync(
		path.join(tmpdir(), "qingyan-comments-create-"),
	);
	const databaseFile = path.join(directory, "qingyan.db");
	applyInitialMigration(databaseFile);

	const config = createTestConfig(databaseFile);
	const siteConfig = config.sites[0];
	if (!siteConfig) {
		throw new Error("Expected test site config");
	}
	siteConfig.defaults.comments.identity.require = options?.require ?? [
		"nickname",
		"email",
	];
	siteConfig.defaults.comments.allowWebsite = options?.allowWebsite ?? true;

	const app = await buildApp(config);

	return {
		app,
		async cleanup() {
			await app.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

describe("POST /api/comments", () => {
	it("rejects requests missing configured required identity fields", async () => {
		const fixture = await createCustomTestApp();
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:required-email",
				pageTitle: "Required Email",
				pageUrl: "https://fangyuan.example.com/posts/required-email/",
				parentCommentId: null,
				author: {
					name: "Alice",
				},
				content: {
					raw: "hello",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: {
				code: "COMMENT_VALIDATION_FAILED",
			},
		});
	});

	it("accepts fully anonymous comments when no identity field is required", async () => {
		const fixture = await createCustomTestApp({
			require: [],
			allowWebsite: false,
		});
		cleanups.push(fixture.cleanup);

		const response = await fixture.app.inject({
			method: "POST",
			url: "/api/comments",
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:anonymous",
				pageTitle: "Anonymous",
				pageUrl: "https://fangyuan.example.com/posts/anonymous/",
				parentCommentId: null,
				author: {},
				content: {
					raw: "anonymous comment",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			comment: {
				status: "pending",
			},
		});

		const [createdComment] = await fixture.app.db
			.select()
			.from(comments)
			.where(eq(comments.contentRaw, "anonymous comment"))
			.limit(1);
		expect(createdComment?.authorName).toBe("");
		expect(createdComment?.authorEmail).toBeNull();
		expect(createdComment?.authorWebsite).toBeNull();
	});
});
