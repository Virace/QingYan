import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";

import { useAdminConfirmDialog } from "./confirm-dialog";

type NavigationGuard = {
	confirmNavigation: () => Promise<boolean>;
	register: (id: symbol, dirty: boolean) => void;
};

const NavigationGuardContext = createContext<NavigationGuard | null>(null);

export function AdminNavigationGuardProvider({
	children,
}: {
	children: ReactNode;
}) {
	const confirm = useAdminConfirmDialog();
	const changes = useRef(new Set<symbol>());
	const pending = useRef<Promise<boolean> | null>(null);
	const register = useCallback((id: symbol, dirty: boolean) => {
		if (dirty) changes.current.add(id);
		else changes.current.delete(id);
	}, []);
	const confirmNavigation = useCallback(() => {
		if (changes.current.size === 0) return Promise.resolve(true);
		if (pending.current) return pending.current;
		pending.current = confirm({
			title: "放弃未保存的更改？",
			description: "离开后将丢失当前未保存的内容。你可以留下继续编辑。",
			confirmText: "放弃更改并离开",
			cancelText: "继续编辑",
			destructive: true,
		}).finally(() => {
			pending.current = null;
		});
		return pending.current;
	}, [confirm]);

	useEffect(() => {
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (changes.current.size === 0) return;
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, []);

	const value = useMemo(
		() => ({ confirmNavigation, register }),
		[confirmNavigation, register],
	);
	return (
		<NavigationGuardContext.Provider value={value}>
			{children}
		</NavigationGuardContext.Provider>
	);
}

export function useAdminNavigationGuard() {
	const guard = useContext(NavigationGuardContext);
	if (!guard) throw new Error("AdminNavigationGuardProvider is required.");
	return guard;
}

export function useAdminUnsavedChanges(dirty: boolean) {
	const { register } = useAdminNavigationGuard();
	const id = useRef(Symbol());
	useLayoutEffect(() => {
		register(id.current, dirty);
		return () => register(id.current, false);
	}, [dirty, register]);
}
