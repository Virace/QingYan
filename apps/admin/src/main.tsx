import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";

import App from "./App";
import { AdminThemeProvider } from "./theme/admin-theme";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
	throw new Error("Admin root element is missing.");
}

createRoot(root).render(
	<StrictMode>
		<AdminThemeProvider>
			<App />
		</AdminThemeProvider>
	</StrictMode>,
);
