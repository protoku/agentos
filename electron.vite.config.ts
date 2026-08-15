import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
	main: {},
	renderer: {
		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src/renderer/src", import.meta.url)),
			},
		},
		plugins: [react(), tailwindcss()],
	},
});
