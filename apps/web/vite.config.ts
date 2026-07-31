import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import mdx from "fumadocs-mdx/vite"

const config = defineConfig({
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
  ],
})

export default config
