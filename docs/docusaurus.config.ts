import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "deck.gl-raster",
  tagline: "GPU-accelerated COG and Zarr visualization in deck.gl",
  favicon: "img/favicon.ico",

  url: "https://developmentseed.org",
  baseUrl: "/deck.gl-raster/",

  organizationName: "developmentseed",
  projectName: "deck.gl-raster",

  onBrokenLinks: "throw",

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/",
          editUrl:
            "https://github.com/developmentseed/deck.gl-raster/tree/main/docs/",
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ["rss", "atom"],
            xslt: true,
          },
          editUrl:
            "https://github.com/developmentseed/deck.gl-raster/tree/main/docs/",
          onInlineAuthors: "ignore",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      "docusaurus-plugin-typedoc",
      {
        id: "api-raster-reproject",
        entryPoints: ["../packages/raster-reproject/src/index.ts"],
        tsconfig: "../packages/raster-reproject/tsconfig.json",
        out: "docs/api/raster-reproject",
        sidebar: {
          autoConfiguration: true,
          pretty: true,
        },
      },
    ],
    [
      "docusaurus-plugin-typedoc",
      {
        id: "api-deck-gl-raster",
        entryPoints: ["../packages/deck.gl-raster/src/index.ts"],
        tsconfig: "../packages/deck.gl-raster/tsconfig.json",
        out: "docs/api/deck.gl-raster",
        sidebar: {
          autoConfiguration: true,
          pretty: true,
        },
      },
    ],
    [
      "docusaurus-plugin-typedoc",
      {
        id: "api-deck-gl-geotiff",
        entryPoints: ["../packages/deck.gl-geotiff/src/index.ts"],
        tsconfig: "../packages/deck.gl-geotiff/tsconfig.json",
        out: "docs/api/deck.gl-geotiff",
        sidebar: {
          autoConfiguration: true,
          pretty: true,
        },
      },
    ],
    [
      "docusaurus-plugin-typedoc",
      {
        id: "api-deck-gl-zarr",
        entryPoints: ["../packages/deck.gl-zarr/src/index.ts"],
        tsconfig: "../packages/deck.gl-zarr/tsconfig.json",
        out: "docs/api/deck.gl-zarr",
        sidebar: {
          autoConfiguration: true,
          pretty: true,
        },
      },
    ],
  ],

  themeConfig: {
    image: "img/social-card.jpg",
    navbar: {
      title: "deck.gl-raster",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          type: "dropdown",
          label: "API",
          position: "left",
          items: [
            {
              label: "deck.gl-geotiff",
              to: "/api/deck.gl-geotiff",
            },
            {
              label: "deck.gl-zarr",
              to: "/api/deck.gl-zarr",
            },
            {
              label: "deck.gl-raster",
              to: "/api/deck.gl-raster",
            },
            {
              label: "raster-reproject",
              to: "/api/raster-reproject",
            },
          ],
        },
        { to: "/blog", label: "Blog", position: "left" },
        {
          href: "https://github.com/developmentseed/deck.gl-raster",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Getting Started",
              to: "/intro",
            },
            {
              label: "API Reference",
              to: "/api/deck.gl-raster",
            },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/developmentseed/deck.gl-raster",
            },
            {
              label: "Development Seed",
              href: "https://developmentseed.org",
            },
          ],
        },
        {
          title: "More",
          items: [
            {
              label: "Blog",
              to: "/blog",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Development Seed.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
