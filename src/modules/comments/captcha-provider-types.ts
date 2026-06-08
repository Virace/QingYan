import type { SystemSettings } from "../system-settings/definitions";

export type CaptchaHostMode = "inline_value" | "iframe_widget";

export type PublicCaptchaProviderKind = SystemSettings["captcha"]["provider"];

export interface InlineValueCaptchaChallenge {
	challengeId: string;
	mode: "inline_value";
	imageData: string;
}

export interface IframeWidgetCaptchaChallenge {
	challengeId: string;
	mode: "iframe_widget";
	iframeSrc: string;
	width: number;
	height: number;
}

export type PublicCaptchaChallenge =
	| InlineValueCaptchaChallenge
	| IframeWidgetCaptchaChallenge;

export interface InlineCaptchaSessionPayload {
	answer: string;
	publicChallenge: InlineValueCaptchaChallenge;
}

export interface IframeCaptchaSessionPayload {
	publicChallenge: IframeWidgetCaptchaChallenge;
}

export type CaptchaSessionPayload =
	| InlineCaptchaSessionPayload
	| IframeCaptchaSessionPayload;

export function resolveCaptchaHostMode(
	provider: PublicCaptchaProviderKind,
): CaptchaHostMode {
	return provider === "image" ? "inline_value" : "iframe_widget";
}

export function isInlineCaptchaSessionPayload(
	payload: CaptchaSessionPayload,
): payload is InlineCaptchaSessionPayload {
	return payload.publicChallenge.mode === "inline_value";
}
