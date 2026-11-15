import { type SetStateAction, useEffect, useState } from "react";

import { isSameSettingsPayload } from "./settings-shared";

export function useSettingsDraft<T, Section extends string>(
	identity: string,
	settings: T | undefined,
	sections: readonly Section[],
	payload: (section: Section, settings: T) => unknown,
	replace: (draft: T, settings: T, section: Section) => T,
) {
	const [state, setState] = useState<{
		identity: string;
		draft: T;
		saved: T;
	} | null>(null);

	useEffect(() => {
		if (!settings) return;
		setState((current) => {
			if (!current || current.identity !== identity) {
				return { identity, draft: structuredClone(settings), saved: settings };
			}
			let draft = current.draft;
			for (const section of sections) {
				if (
					isSameSettingsPayload(
						payload(section, draft),
						payload(section, current.saved),
					)
				) {
					draft = replace(draft, settings, section);
				}
			}
			return { identity, draft, saved: settings };
		});
	}, [identity, settings, sections, payload, replace]);

	const current = state?.identity === identity ? state : null;
	const dirtySections = current
		? sections.filter(
				(section) =>
					!isSameSettingsPayload(
						payload(section, current.draft),
						payload(section, current.saved),
					),
			)
		: [];
	const setDraft = (next: SetStateAction<T | null>) => {
		setState((previous) => {
			if (!previous || previous.identity !== identity) return previous;
			const draft =
				typeof next === "function"
					? (next as (value: T | null) => T | null)(previous.draft)
					: next;
			return draft ? { ...previous, draft } : previous;
		});
	};
	const acceptSavedSection = (
		settings: T,
		section: Section,
		submittedPayload?: unknown,
	) => {
		setState((previous) => {
			if (!previous || previous.identity !== identity) return previous;
			let draft =
				submittedPayload === undefined ||
				isSameSettingsPayload(
					payload(section, previous.draft),
					submittedPayload,
				)
					? replace(previous.draft, settings, section)
					: previous.draft;
			for (const other of sections) {
				if (
					other !== section &&
					isSameSettingsPayload(
						payload(other, previous.draft),
						payload(other, previous.saved),
					)
				) {
					draft = replace(draft, settings, other);
				}
			}
			return { identity, draft, saved: settings };
		});
	};
	const discardSection = (section: Section) => {
		setState((previous) =>
			previous?.identity === identity
				? {
						...previous,
						draft: replace(previous.draft, previous.saved, section),
					}
				: previous,
		);
	};
	return {
		draft: current?.draft ?? null,
		saved: current?.saved ?? null,
		setDraft,
		dirtySections,
		acceptSavedSection,
		discardSection,
	};
}
