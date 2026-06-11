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
            { label: "Quickstart", slug: "flo/quickstart" },
            { label: "Skills", slug: "flo/skills" },
            { label: "Stacked branches", slug: "flo/stacking" },
            { label: "Commands", slug: "flo/commands" },
            { label: "Configuration", slug: "flo/configuration" },
            { label: "Recipes", slug: "flo/recipes" },
            { label: "Contributing", slug: "flo/contributing" },
          ],
        },
      ],
      customCss: ["./src/styles/landing.css"],
      plugins: [lucode({ footerText: "" })],
    }),
  ],
});
