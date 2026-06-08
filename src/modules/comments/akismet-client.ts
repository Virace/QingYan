export type AkismetVerdict = "ham" | "spam" | "error";

export interface AkismetReviewResult {
	verdict: AkismetVerdict;
	proTip?: "discard";
	debugHelp?: string;
	recheckAfterSec?: number;
	checkedAt: string;
}

export interface AkismetCommentCheckInput {
	apiKey: string;
	blog: string;
	userIp: string;
	userAgent?: string;
	referrer?: string;
	permalink?: string;
	commentType: "comment" | "reply";
	commentAuthor?: string;
	commentAuthorEmail?: string;
	commentAuthorUrl?: string;
	commentContent: string;
	commentDateGmt?: string;
	isTest?: boolean;
}

export interface AkismetClientOptions {
	fetch?: typeof fetch;
	timeoutMs?: number;
	endpoint?: string;
}

function headerValue(response: Response, name: string): string | undefined {
	return response.headers.get(name) ?? undefined;
}

export async function parseAkismetCommentCheckResponse(
	response: Response,
): Promise<AkismetReviewResult> {
	const body = (await response.text()).trim();
	const proTip: "discard" | undefined =
		headerValue(response, "x-akismet-pro-tip") === "discard"
			? "discard"
			: undefined;
	const debugHelp = headerValue(response, "x-akismet-debug-help");
	const recheckAfter = headerValue(response, "x-akismet-recheck-after");
	const recheckAfterSec = recheckAfter
		? Number.parseInt(recheckAfter, 10)
		: NaN;
	const base = {
		proTip,
		debugHelp,
		recheckAfterSec: Number.isFinite(recheckAfterSec)
			? recheckAfterSec
			: undefined,
		checkedAt: new Date().toISOString(),
	};

	if (body === "true") {
		return {
			...base,
			verdict: "spam",
		};
	}

	if (body === "false") {
		return {
			...base,
			verdict: "ham",
		};
	}

	return {
		...base,
		verdict: "error",
	};
}

function appendOptional(
	body: URLSearchParams,
	key: string,
	value?: string | boolean,
) {
	if (value === undefined || value === "") {
		return;
	}
	body.set(key, String(value));
}

export class AkismetClient {
	private readonly fetchImpl: typeof fetch;
	private readonly timeoutMs: number;
	private readonly endpoint: string;

	public constructor(options: AkismetClientOptions = {}) {
		this.fetchImpl = options.fetch ?? fetch;
		this.timeoutMs = options.timeoutMs ?? 3000;
		this.endpoint = options.endpoint ?? "https://rest.akismet.com/1.1";
	}

	public async commentCheck(
		input: AkismetCommentCheckInput,
	): Promise<AkismetReviewResult> {
		const body = new URLSearchParams();
		body.set("api_key", input.apiKey);
		body.set("blog", input.blog);
		body.set("user_ip", input.userIp);
		body.set("comment_type", input.commentType);
		body.set("comment_content", input.commentContent);
		body.set("blog_charset", "UTF-8");
		appendOptional(body, "user_agent", input.userAgent);
		appendOptional(body, "referrer", input.referrer);
		appendOptional(body, "permalink", input.permalink);
		appendOptional(body, "comment_author", input.commentAuthor);
		appendOptional(body, "comment_author_email", input.commentAuthorEmail);
		appendOptional(body, "comment_author_url", input.commentAuthorUrl);
		appendOptional(body, "comment_date_gmt", input.commentDateGmt);
		appendOptional(body, "is_test", input.isTest);

		const response = await this.fetchImpl(`${this.endpoint}/comment-check`, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
			},
			body,
			signal: AbortSignal.timeout(this.timeoutMs),
		});

		return parseAkismetCommentCheckResponse(response);
	}
}
