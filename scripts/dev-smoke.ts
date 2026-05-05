import { eq } from "drizzle-orm";

import { buildApp } from "../src/app";
import { captchaSessions, comments, siteSettings } from "../src/db/schema";
import {
	applyInitialMigration,
	createTestConfig,
} from "../tests/support/test-fixtures";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function main() {
	const directory = mkdtempSync(path.join(tmpdir(), "qingyan-smoke-"));
	const databaseFile = path.join(directory, "qingyan.db");
	applyInitialMigration(databaseFile);

	const app = await buildApp(createTestConfig(databaseFile));
	await app.ready();

	try {
		await app.db.update(siteSettings).set({
			captchaMode: "always",
		});

		const captchaState = await app.inject({
			method: "GET",
			url: "/api/comments/captcha/state?siteKey=fangyuan&pageKey=post:smoke",
		});
		const visitorCookie = captchaState.cookies.find(
			(cookie) => cookie.name === "qingyan_visitor",
		);
		const challengeId = captchaState.json().challenge.challengeId as string;
		const [captchaSession] = await app.db
			.select()
			.from(captchaSessions)
			.where(eq(captchaSessions.id, challengeId));
		if (!captchaSession) {
			throw new Error("Captcha session was not created");
		}

		const captchaPayload = JSON.parse(
			captchaSession.challengePayloadJson ?? "{}",
		) as {
			answer: string;
		};
		await app.inject({
			method: "POST",
			url: "/api/comments/captcha/verify",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:smoke",
				challengeId,
				mode: "inline_value",
				value: captchaPayload.answer,
			},
		});

		const createComment = await app.inject({
			method: "POST",
			url: "/api/comments",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			payload: {
				siteKey: "fangyuan",
				pageKey: "post:smoke",
				pageTitle: "Smoke",
				pageUrl: "https://fangyuan.example.com/posts/smoke/",
				parentCommentId: null,
				author: {
					name: "Smoke Tester",
				},
				content: {
					raw: "hello smoke",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});
		const commentId = createComment.json().comment.id as string;

		const adminLogin = await app.inject({
			method: "POST",
			url: "/api/admin/session/login",
			payload: {
				token: "replace-me",
			},
		});
		const adminCookie = adminLogin.cookies.find(
			(cookie) => cookie.name === "qingyan_admin",
		);
		await app.inject({
			method: "PATCH",
			url: `/api/admin/comments/${commentId}`,
			cookies: {
				qingyan_admin: adminCookie?.value ?? "",
			},
			payload: {
				status: "approved",
			},
		});

		const bootstrap = await app.inject({
			method: "GET",
			url: "/api/comments/bootstrap?siteKey=fangyuan&pageKey=post:smoke&pageTitle=Smoke&pageUrl=https://fangyuan.example.com/posts/smoke/&sortBy=newest&limit=20&offset=0",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
		});
		const thread = await app.inject({
			method: "GET",
			url: "/api/comments/thread?siteKey=fangyuan&pageKey=post:smoke&sortBy=newest&limit=20&offset=0",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
		});
		const [storedComment] = await app.db
			.select()
			.from(comments)
			.where(eq(comments.id, commentId));

		console.log(
			JSON.stringify(
				{
					commentId,
					storedStatus: storedComment?.status,
					bootstrapCount: bootstrap.json().comments.length,
					threadCount: thread.json().comments.length,
				},
				null,
				2,
			),
		);
	} finally {
		await app.close();
		rmSync(directory, { recursive: true, force: true });
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
