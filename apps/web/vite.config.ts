import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import mdx from "fumadocs-mdx/vite"

const standaloneOrigin = "http://localhost:3200"

const config = defineConfig(({ command }) => {
  if (command === "serve") {
    process.env.RHYTHM_API_URL ??= standaloneOrigin
  }
  const apiOrigin = process.env.RHYTHM_API_URL ?? standaloneOrigin

  return {
    resolve: { tsconfigPaths: true },
    optimizeDeps: {
      exclude: [
        "fumadocs-core",
        "fumadocs-mdx",
        "fumadocs-openapi",
        "fumadocs-ui",
      ],
    },
    ssr: {
      noExternal: [
        "fumadocs-core",
        "fumadocs-mdx",
        "fumadocs-openapi",
        "fumadocs-ui",
      ],
    },
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        "/api/v1": {
          target: apiOrigin,
          changeOrigin: true,
          timeout: 125_000,
          proxyTimeout: 125_000,
        },
        "/hooks/v1": {
          target: apiOrigin,
          changeOrigin: true,
        },
      },
    },
    plugins: [
      mdx(),
      devtools(),
      tailwindcss(),
      // Start always registers the route code splitter; tsr.config.json
      // enables autoCodeSplitting for the generator/config merge path.
      tanstackStart({
        router: {
          codeSplittingOptions: {
            defaultBehavior: [
              ["loader"],
              ["component"],
              ["pendingComponent"],
              ["errorComponent"],
              ["notFoundComponent"],
            ],
          },
        },
      }),
      viteReact(),
      {
        name: "rhythm-dev-banner",
        configureServer(server) {
          server.httpServer?.once("listening", () => {
            console.log(
              `Rhythm UI HMR http://localhost:3000  (API ${apiOrigin})`
            )
          })
        },
      },
    ],
  }
})

export default config
