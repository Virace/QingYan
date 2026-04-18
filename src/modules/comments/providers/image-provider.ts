import { createCaptchaChallenge } from "../../shared/captcha-challenge";
import type {
	InlineCaptchaSessionPayload,
	InlineValueCaptchaChallenge,
} from "../captcha-provider-types";

export function createImageCaptchaChallenge(input: {
	challengeId: string;
	ttlSec: number;
}) {
	const challenge = createCaptchaChallenge();
	const publicChallenge: InlineValueCaptchaChallenge = {
		challengeId: input.challengeId,
		mode: "inline_value",
		imageData: challenge.imageData,
	};
	const payload: InlineCaptchaSessionPayload = {
		answer: challenge.answer,
		publicChallenge,
	};

	return {
		mode: "inline_value" as const,
		providerKind: "image" as const,
		challengePayloadJson: JSON.stringify(payload),
		publicChallenge,
		expiresAt: new Date(Date.now() + input.ttlSec * 1000).toISOString(),
	};
}

export function verifyImageCaptchaValue(
	payload: InlineCaptchaSessionPayload,
	value: string,
) {
	return payload.answer === value.trim();
}
