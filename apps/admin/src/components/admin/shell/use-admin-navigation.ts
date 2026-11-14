import { useCallback, useEffect, useRef, useState } from "react";

import { useAdminNavigationGuard } from "../shared/admin-navigation-guard";

function changesPage(from: URL, to: URL) {
	return (
		(from.searchParams.get("view") ?? "overview") !==
			(to.searchParams.get("view") ?? "overview") ||
		from.searchParams.get("siteKey") !== to.searchParams.get("siteKey")
	);
}

export function useAdminNavigation() {
	const { confirmNavigation } = useAdminNavigationGuard();
	const [url, setUrl] = useState(() => new URL(window.location.href));
	const index = useRef<number>(window.history.state?.adminNavigationIndex ?? 0);
	const restoring = useRef(false);
	const navigating = useRef(false);
	const currentUrl = useRef(window.location.href);
	const publish = useCallback(() => {
		currentUrl.current = window.location.href;
		setUrl(new URL(window.location.href));
		window.dispatchEvent(new Event("admin:navigation"));
	}, []);
	const navigate = useCallback(
		async (url: URL, replace = false) => {
			if (url.href === window.location.href || navigating.current) return false;
			navigating.current = true;
			try {
				if (
					changesPage(new URL(window.location.href), url) &&
					!(await confirmNavigation())
				)
					return false;
				if (!replace) index.current += 1;
				window.history[replace ? "replaceState" : "pushState"](
					{ ...window.history.state, adminNavigationIndex: index.current },
					"",
					url,
				);
				publish();
				return true;
			} finally {
				navigating.current = false;
			}
		},
		[confirmNavigation, publish],
	);

	useEffect(() => {
		window.history.replaceState(
			{ ...window.history.state, adminNavigationIndex: index.current },
			"",
		);
		const popState = async (event: PopStateEvent) => {
			if (restoring.current) {
				restoring.current = false;
				return;
			}
			const targetIndex: number | undefined = event.state?.adminNavigationIndex;
			if (
				!changesPage(
					new URL(currentUrl.current),
					new URL(window.location.href),
				) ||
				(await confirmNavigation())
			) {
				index.current = targetIndex ?? index.current;
				publish();
			} else if (targetIndex !== undefined && targetIndex !== index.current) {
				restoring.current = true;
				window.history.go(index.current - targetIndex);
			} else {
				window.history.replaceState(
					{ ...window.history.state, adminNavigationIndex: index.current },
					"",
					currentUrl.current,
				);
			}
		};
		window.addEventListener("popstate", popState);
		return () => window.removeEventListener("popstate", popState);
	}, [confirmNavigation, publish]);

	useEffect(() => {
		if (!url.hash) return;
		const anchorId = url.hash.slice(1);
		const scrollToAnchor = () => {
			const anchor = document.getElementById(anchorId);
			if (!anchor) return false;
			anchor.scrollIntoView({ block: "start", behavior: "instant" });
			return true;
		};
		if (scrollToAnchor()) return;
		const observer = new MutationObserver(() => {
			if (scrollToAnchor()) observer.disconnect();
		});
		observer.observe(document.body, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [url]);

	const replaceUrl = useCallback((url: URL) => {
		window.history.replaceState(
			{ ...window.history.state, adminNavigationIndex: index.current },
			"",
			url,
		);
		currentUrl.current = url.href;
		setUrl(url);
	}, []);

	return { url, navigate, replaceUrl };
}
