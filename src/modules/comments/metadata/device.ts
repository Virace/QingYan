import UAParser = require("ua-parser-js");
import { isBot } from "ua-parser-js/bot-detection";

const parseUa = UAParser as unknown as {
	(userAgent: string): UAParser.IResult;
	VERSION: string;
};

export type DeviceBrowser =
	| "chrome"
	| "edge"
	| "firefox"
	| "safari"
	| "opera"
	| "samsung"
	| "wechat"
	| "unknown";
export type DeviceOs =
	| "windows"
	| "macos"
	| "ios"
	| "android"
	| "linux"
	| "unknown";
export type DeviceType = "desktop" | "mobile" | "tablet" | "bot" | "unknown";
export type DeviceIcon =
	| "chrome"
	| "edge"
	| "firefox"
	| "safari"
	| "android"
	| "apple"
	| "windows"
	| "linux"
	| "bot"
	| "unknown";

export interface DeviceSnapshot {
	browser: DeviceBrowser;
	os: DeviceOs;
	type: DeviceType;
	icon: DeviceIcon;
	source: string;
	parserVersion: string;
	error: string | null;
}

function normalizeBrowser(name: string | undefined): DeviceBrowser {
	const browser = name?.toLowerCase() ?? "";
	if (browser.includes("edg")) {
		return "edge";
	}
	if (browser.includes("chrome") || browser.includes("chromium")) {
		return "chrome";
	}
	if (browser.includes("firefox")) {
		return "firefox";
	}
	if (browser.includes("safari")) {
		return "safari";
	}
	if (browser.includes("opera") || browser.includes("opr")) {
		return "opera";
	}
	if (browser.includes("samsung")) {
		return "samsung";
	}
	if (browser.includes("wechat") || browser.includes("micromessenger")) {
		return "wechat";
	}

	return "unknown";
}

function normalizeOs(name: string | undefined): DeviceOs {
	const os = name?.toLowerCase() ?? "";
	if (os.includes("windows")) {
		return "windows";
	}
	if (os.includes("mac")) {
		return "macos";
	}
	if (os.includes("ios")) {
		return "ios";
	}
	if (os.includes("android")) {
		return "android";
	}
	if (os.includes("linux")) {
		return "linux";
	}

	return "unknown";
}

function normalizeType(type: string | undefined, bot: boolean): DeviceType {
	if (bot) {
		return "bot";
	}
	if (type === "mobile" || type === "tablet") {
		return type;
	}
	if (!type) {
		return "desktop";
	}

	return "unknown";
}

function chooseIcon(input: {
	browser: DeviceBrowser;
	os: DeviceOs;
	type: DeviceType;
}): DeviceIcon {
	if (input.type === "bot") {
		return "bot";
	}
	if (
		input.browser === "chrome" ||
		input.browser === "edge" ||
		input.browser === "firefox" ||
		input.browser === "safari"
	) {
		return input.browser;
	}
	if (input.os === "android") {
		return "android";
	}
	if (input.os === "ios" || input.os === "macos") {
		return "apple";
	}
	if (input.os === "windows" || input.os === "linux") {
		return input.os;
	}

	return "unknown";
}

export function parseDeviceSnapshot(userAgent: string): DeviceSnapshot {
	const result = parseUa(userAgent);
	const bot = isBot(userAgent);
	const browser = normalizeBrowser(result.browser.name);
	const os = normalizeOs(result.os.name);
	const type = normalizeType(result.device.type, bot);

	return {
		browser,
		os,
		type,
		icon: chooseIcon({ browser, os, type }),
		source: "ua-parser-js",
		parserVersion: parseUa.VERSION,
		error: null,
	};
}

export function createUnknownDeviceSnapshot(error: string): DeviceSnapshot {
	return {
		browser: "unknown",
		os: "unknown",
		type: "unknown",
		icon: "unknown",
		source: "unavailable",
		parserVersion: "none",
		error,
	};
}
