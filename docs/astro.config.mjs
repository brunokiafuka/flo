import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import lucode from "lucode-starlight";

export default defineConfig({
  site: "https://brunokiafuka.github.io",
  base: "/flo",
  integrations: [
    starlight({
      title: "🌊 flo",
      description:
        "Your local flow orchestrator — git, PRs, and project recipes in one tool.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/brunokiafuka/flo",
        },
      ],
      sidebar: [
        {
          label: "Get started",
          items: [
            { label: "What's flo?", slug: "" },
            { label: "Quickstart", slug: "get-started/quickstart" },
          ],
        },
        {
          label: "Guides",
          items: [{ label: "Stacked branches", slug: "guides/stacking" }],
        },
        {
          label: "Reference",
          items: [
            { label: "Commands", slug: "reference/commands" },
            { label: "Configuration", slug: "reference/configuration" },
            { label: "Recipes", slug: "reference/recipes" },
          ],
        },
        {
          label: "Contributing",
          items: [{ label: "Guide", slug: "contributing/guide" }],
        },
      ],
      plugins: [lucode()],
    }),
  ],
});
