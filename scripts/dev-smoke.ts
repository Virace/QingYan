import { eq } from "drizzle-orm";

import {
	captchaSessions,
	comments,
	sitePageRegistry,
	siteSettings,
	sites,
} from "../src/db/schema";
import { deriveCanonicalPageKeyFromPathname } from "../src/modules/shared/canonical-page-key";
import { loginAsAdmin, withAdminWriteAuth } from "../tests/support/admin-login";
import { createTestApp } from "../tests/support/test-fixtures";

function assertResponseStatus(
	label: string,
	response: { statusCode: number; body: string },
	expectedStatus: number,
): void {
	if (response.statusCode !== expectedStatus) {
		throw new Error(
			`${label} returned ${response.statusCode}: ${response.body}`,
		);
	}
}

async function main() {
	const fixture = await createTestApp();
	const { app } = fixture;
	const pageKey = "post:smoke";
	const pageUrl = `http://localhost:4321/${pageKey}`;
	const publicRequestHeaders = {
		referer: pageUrl,
		"user-agent": "qingyan-system-smoke",
	};
	await app.ready();

	try {
		await app.db.update(siteSettings).set({
			captchaMode: "always",
		});
		const [site] = await app.db
			.select()
			.from(sites)
			.where(eq(sites.siteKey, "fangyuan"));
		if (!site) {
			throw new Error("Smoke test site was not created");
		}
		const canonicalPageKey = deriveCanonicalPageKeyFromPathname(pageKey);
		await app.db.insert(sitePageRegistry).values({
			siteId: site.id,
			pageKey: canonicalPageKey,
			pageUrl,
			status: "active",
		});

		const captchaState = await app.inject({
			method: "GET",
			url: `/qingyan/api/comments/captcha/state?siteKey=fangyuan&pageKey=${encodeURIComponent(pageKey)}`,
			headers: publicRequestHeaders,
		});
		assertResponseStatus("Captcha state", captchaState, 200);
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
		const captchaVerification = await app.inject({
			method: "POST",
			url: "/qingyan/api/comments/captcha/verify",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: publicRequestHeaders,
			payload: {
				siteKey: "fangyuan",
				pageKey,
				challengeId,
				mode: "inline_value",
				value: captchaPayload.answer,
			},
		});
		assertResponseStatus("Captcha verification", captchaVerification, 200);

		const createComment = await app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: publicRequestHeaders,
			payload: {
				siteKey: "fangyuan",
				pageKey,
				pageTitle: "Smoke",
				pageUrl,
				parentCommentId: null,
				author: {
					name: "Smoke Tester",
					email: "smoke@example.test",
				},
				content: {
					raw: "hello smoke",
				},
				options: {
					notifyOnReply: false,
				},
			},
		});
		assertResponseStatus("Comment creation", createComment, 200);
		const commentId = createComment.json().comment.id as string;

		const { adminCookie, csrfToken } = await loginAsAdmin(app);
		const approveComment = await app.inject({
			method: "PATCH",
			url: `/qingyan/api/admin/comments/${commentId}`,
			...withAdminWriteAuth({ adminCookie, csrfToken }),
			payload: {
				status: "approved",
			},
		});
		assertResponseStatus("Comment approval", approveComment, 200);

		const bootstrap = await app.inject({
			method: "GET",
			url: `/qingyan/api/comments/bootstrap?siteKey=fangyuan&pageKey=${encodeURIComponent(pageKey)}&pageTitle=Smoke&pageUrl=${encodeURIComponent(pageUrl)}&sortBy=newest&limit=20&offset=0`,
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: publicRequestHeaders,
		});
		assertResponseStatus("Comments bootstrap", bootstrap, 200);
		const thread = await app.inject({
			method: "GET",
			url: `/qingyan/api/comments/thread?siteKey=fangyuan&pageKey=${encodeURIComponent(pageKey)}&sortBy=newest&limit=20&offset=0`,
			cookies: {
				qingyan_visitor: visitorCookie?.value ?? "",
			},
			headers: publicRequestHeaders,
		});
		assertResponseStatus("Comments thread", thread, 200);
		const [storedComment] = await app.db
			.select()
			.from(comments)
			.where(eq(comments.id, commentId));
		const bootstrapBody = bootstrap.json() as {
			data?: { comments?: { items?: unknown[] } };
		};
		const threadBody = thread.json() as { items?: unknown[] };
		const bootstrapCount = bootstrapBody.data?.comments?.items?.length ?? 0;
		const threadCount = threadBody.items?.length ?? 0;
		if (
			storedComment?.status !== "approved" ||
			bootstrapCount !== 1 ||
			threadCount !== 1
		) {
			throw new Error(
				`Smoke state mismatch: status=${storedComment?.status ?? "missing"}, bootstrap=${bootstrapCount}, thread=${threadCount}`,
			);
		}

		console.log(
			JSON.stringify(
				{
					commentId,
					storedStatus: storedComment.status,
					bootstrapCount,
					threadCount,
				},
				null,
				2,
			),
		);
	} finally {
		await fixture.cleanup();
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
