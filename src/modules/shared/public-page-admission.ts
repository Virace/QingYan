import { AppError } from "./errors";
import type { PageRegistrySettings } from "./page-registry-settings";

export type PublicRegistryPage = {
	status: string;
};

export type PublicPageAdmission =
	| {
			kind: "registered";
			pageInteractive: true;
			allowDiscoveryWrites: false;
	  }
	| {
			kind: "protected";
			pageInteractive: false;
			allowDiscoveryWrites: false;
			status: string;
	  }
	| {
			kind: "unknown";
			pageInteractive: boolean;
			allowDiscoveryWrites: boolean;
			response: PageRegistrySettings["unknownPageResponse"];
	  };

export function resolvePublicPageAdmission(input: {
	registryPage?: PublicRegistryPage | null;
	settings: PageRegistrySettings;
}): PublicPageAdmission {
	if (input.registryPage) {
		if (input.registryPage.status === "active") {
			return {
				kind: "registered",
				pageInteractive: true,
				allowDiscoveryWrites: false,
			};
		}

		return {
			kind: "protected",
			pageInteractive: false,
			allowDiscoveryWrites: false,
			status: input.registryPage.status,
		};
	}

	if (
		input.settings.mode === "authoritative" ||
		input.settings.emergencyLockdown
	) {
		return {
			kind: "unknown",
			pageInteractive: false,
			allowDiscoveryWrites: false,
			response: input.settings.emergencyLockdown
				? "forbidden"
				: input.settings.unknownPageResponse,
		};
	}

	return {
		kind: "unknown",
		pageInteractive: true,
		allowDiscoveryWrites: true,
		response: input.settings.unknownPageResponse,
	};
}

export function assertPublicPageAdmission(
	admission: PublicPageAdmission,
): void {
	if (admission.kind === "registered") {
		return;
	}
	if (admission.kind === "protected") {
		throw new AppError(403, "PAGE_NOT_INTERACTIVE", "页面当前不可交互。");
	}
	throw new AppError(403, "PAGE_NOT_REGISTERED", "页面尚未登记。");
}
