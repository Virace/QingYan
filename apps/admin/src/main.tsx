import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";

import App from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
	throw new Error("Admin root element is missing.");
}

createRoot(root).render(
	<StrictMode>
		<Theme accentColor="gray" grayColor="gray" radius="medium">
			<App />
		</Theme>
	</StrictMode>,
);
