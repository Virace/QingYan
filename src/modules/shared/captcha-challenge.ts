import { randomInt, randomUUID } from "node:crypto";

const TEST_CAPTCHA_ENV = "QINGYAN_TEST_CAPTCHA_ANSWER";

type SegmentName = "top" | "upperLeft" | "upperRight" | "middle" | "lowerLeft" | "lowerRight" | "bottom";

const DIGIT_SEGMENTS: Record<string, SegmentName[]> = {
	"0": ["top", "upperLeft", "upperRight", "lowerLeft", "lowerRight", "bottom"],
	"1": ["upperRight", "lowerRight"],
	"2": ["top", "upperRight", "middle", "lowerLeft", "bottom"],
	"3": ["top", "upperRight", "middle", "lowerRight", "bottom"],
	"4": ["upperLeft", "upperRight", "middle", "lowerRight"],
	"5": ["top", "upperLeft", "middle", "lowerRight", "bottom"],
	"6": ["top", "upperLeft", "middle", "lowerLeft", "lowerRight", "bottom"],
	"7": ["top", "upperRight", "lowerRight"],
	"8": [
		"top",
		"upperLeft",
		"upperRight",
		"middle",
		"lowerLeft",
		"lowerRight",
		"bottom",
	],
	"9": ["top", "upperLeft", "upperRight", "middle", "lowerRight", "bottom"],
};

const SEGMENT_LAYOUT: Record<
	SegmentName,
	{ x: number; y: number; width: number; height: number }
> = {
	top: { x: 4, y: 0, width: 16, height: 5 },
	upperLeft: { x: 0, y: 4, width: 5, height: 14 },
	upperRight: { x: 19, y: 4, width: 5, height: 14 },
	middle: { x: 4, y: 17, width: 16, height: 5 },
	lowerLeft: { x: 0, y: 21, width: 5, height: 14 },
	lowerRight: { x: 19, y: 21, width: 5, height: 14 },
	bottom: { x: 4, y: 34, width: 16, height: 5 },
};

function resolveCaptchaAnswer(): string {
	const forcedAnswer = process.env[TEST_CAPTCHA_ENV]?.trim();
	if (forcedAnswer && /^\d{4}$/.test(forcedAnswer)) {
		return forcedAnswer;
	}

	return `${randomInt(1000, 9999)}`;
}

function renderDigit(digit: string, index: number): string {
	const segments = DIGIT_SEGMENTS[digit] ?? [];
	const offsetX = 18 + index * 30;

	return `<g transform="translate(${offsetX} 10)">${segments
		.map((segment) => {
			const layout = SEGMENT_LAYOUT[segment];
			return `<rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="2" fill="#1f2937"/>`;
		})
		.join("")}</g>`;
}

function renderNoise(seed: string): string {
	const values = [...seed.replaceAll("-", "").slice(0, 16)].map((char) =>
		Number.parseInt(char, 16),
	);
	const topPath = values
		.slice(0, 8)
		.map((value, index) => `${index === 0 ? "M" : "L"} ${10 + index * 20} ${8 + value}`)
		.join(" ");
	const bottomPath = values
		.slice(8, 16)
		.map((value, index) => `${index === 0 ? "M" : "L"} ${10 + index * 20} ${40 + value}`)
		.join(" ");

	return [
		`<path d="${topPath}" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>`,
		`<path d="${bottomPath}" fill="none" stroke="#d4d4d8" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>`,
	].join("");
}

function buildSvgDataUrl(answer: string, seed: string): string {
	const digits = answer
		.split("")
		.map((digit, index) => renderDigit(digit, index))
		.join("");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60" viewBox="0 0 160 60"><rect width="160" height="60" rx="8" fill="#f6f1e7"/>${renderNoise(seed)}${digits}</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

export function createCaptchaChallenge() {
	const answer = resolveCaptchaAnswer();
	const seed = randomUUID();

	return {
		answer,
		imageData: buildSvgDataUrl(answer, seed),
	};
}
