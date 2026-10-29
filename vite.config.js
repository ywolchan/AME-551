import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
	base: process.env.GITHUB_PAGES === "true" ? "/AME-551/" : "/",
	plugins: [basicSsl()],
	server: {
		host: "0.0.0.0",
	}
});
