import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_APPLICATION_NAME = "InSite Assurance";

export default defineConfig(({ mode }) => {
  // APPLICATION_NAME (white-labelling) has no VITE_ prefix, so it is read here and inlined.
  const env = loadEnv(mode, __dirname, "");
  const applicationName = (env.APPLICATION_NAME || process.env.APPLICATION_NAME || "").trim() || DEFAULT_APPLICATION_NAME;

  return {
    plugins: [
      react(),
      {
        name: "application-name-html",
        transformIndexHtml: (html: string) => html.replace(/%APPLICATION_NAME%/g, applicationName),
      },
    ],
    envPrefix: ["VITE_", "DEMO_"],
    define: {
      "process.env.APPLICATION_NAME": JSON.stringify(applicationName),
    },
    resolve: {
      alias: {
        "@insite/shared": path.resolve(__dirname, "../shared/src/index.ts"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:4000",
          changeOrigin: true,
        },
      },
    },
  };
});
