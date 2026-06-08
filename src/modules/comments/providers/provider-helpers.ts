import { AppError } from "../../shared/errors";

export function createIframeCaptchaChallenge<
	const ProviderKind extends string,
>(input: {
	providerKind: ProviderKind;
	challengeId: string;
	widgetPath: string;
	siteKey: string;
	pageKey: string;
	width: number;
	height: number;
}) {
	const search = new URLSearchParams({
		siteKey: input.siteKey,
		pageKey: input.pageKey,
		challengeId: input.challengeId,
	});
	const publicChallenge = {
		challengeId: input.challengeId,
		mode: "iframe_widget" as const,
		iframeSrc: `${input.widgetPath}?${search.toString()}`,
		width: input.width,
		height: input.height,
	};
	return {
		mode: "iframe_widget" as const,
		providerKind: input.providerKind,
		challengePayloadJson: JSON.stringify({
			publicChallenge,
		}),
		publicChallenge,
		expiresAt: "",
	};
}

export async function fetchCaptchaProviderJson(input: {
	url: string;
	init: RequestInit;
}) {
	let response: Response;
	try {
		response = await fetch(input.url, input.init);
	} catch {
		throw new AppError(
			502,
			"CAPTCHA_PROVIDER_UNAVAILABLE",
			"验证码服务暂时不可用。",
		);
	}

	if (!response.ok) {
		throw new AppError(
			502,
			"CAPTCHA_PROVIDER_UNAVAILABLE",
			"验证码服务暂时不可用。",
		);
	}

	return response.json() as Promise<unknown>;
}
