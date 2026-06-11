import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import lucode from "lucode-starlight";

export default defineConfig({
  site: "https://brunokiafuka.github.io",
  base: "/toolkit",
  integrations: [
    starlight({
      title: "🧰 toolkit",
      description:
        "A toolkit of local dev tools to help you work productively.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/brunokiafuka/toolkit",
        },
      ],
      sidebar: [
        {
          label: "flo",
          items: [
            { label: "What's flo?", slug: "flo" },
            { label: "Quickstart", slug: "get-started/quickstart" },
            { label: "Skills", slug: "get-started/skill" },
            { label: "Stacked branches", slug: "guides/stacking" },
            { label: "Commands", slug: "reference/commands" },
            { label: "Configuration", slug: "reference/configuration" },
            { label: "Recipes", slug: "reference/recipes" },
            { label: "Contributing", slug: "contributing/guide" },
          ],
        },
      ],
      customCss: ["./src/styles/landing.css"],
      plugins: [lucode({ footerText: "" })],
    }),
  ],
});
