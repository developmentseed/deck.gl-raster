import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

/**
 * Each package that gets TypeDoc API generation + an independent versioned
 * docs instance. API markdown is pre-generated into docs/api/<id>/ by running:
 *   pnpm docs:generate-api
 * This output is committed so that `plugin-content-docs` can find it at startup.
 */
const packages = [
  { id: "affine", label: "affine", entry: "../packages/affine/src/index.ts" },
  {
    id: "deck-gl-geotiff",
    label: "deck.gl-geotiff",
    entry: "../packages/deck.gl-geotiff/src/index.ts",
  },
  {
    id: "deck-gl-raster",
    label: "deck.gl-raster",
    entry: "../packages/deck.gl-raster/src/index.ts",
  },
  {
    id: "deck-gl-zarr",
    label: "deck.gl-zarr",
    entry: "../packages/deck.gl-zarr/src/index.ts",
  },
  { id: "epsg", label: "epsg", entry: "../packages/epsg/src/all.ts" },
  {
    id: "geotiff",
    label: "geotiff",
    entry: "../packages/geotiff/src/index.ts",
  },
  {
    id: "morecantile",
    label: "morecantile",
    entry: "../packages/morecantile/src/index.ts",
  },
  {
    id: "raster-reproject",
    label: "raster-reproject",
    entry: "../packages/raster-reproject/src/index.ts",
  },
];

// One docusaurus-plugin-typedoc per package.
// These generate markdown into docs/api/<id>/ when `generate-typedoc` is run.
const typedocPlugins = packages.map((pkg) => [
  "docusaurus-plugin-typedoc",
  {
    id: `typedoc-${pkg.id}`,
    entryPoints: [pkg.entry],
    tsconfig: "../tsconfig.json",
    out: `api/${pkg.id}`,
    excludePrivate: true,
    excludeInternal: true,
    readme: "none",
  },
]);

// One plugin-content-docs per package for independent versioning.
// Requires the API markdown to exist (run `pnpm docs:generate-api` first).
const contentDocsPlugins = packages.map((pkg) => [
  "@docusaurus/plugin-content-docs",
  {
    id: pkg.id,
    path: `api/${pkg.id}`,
    routeBasePath: `api/${pkg.id}`,
    sidebarPath: `./api/${pkg.id}/typedoc-sidebar.cjs`,
    editUrl:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/",
  },
]);

const config: Config = {
  title: "deck.gl-raster",
  tagline: "Raster visualization layers for deck.gl",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  url: "https://developmentseed.github.io",
  baseUrl: "/deck.gl-raster/",

  organizationName: "developmentseed",
  projectName: "deck.gl-raster",

  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  plugins: [...typedocPlugins, ...contentDocsPlugins],

  presets: [
    [
      "classic",
      {
        docs: {
          // Narrative docs: guides, getting started, etc.
          path: "docs/guides",
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
          editUrl:
            "https://github.com/developmentseed/deck.gl-raster/tree/main/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "deck.gl-raster",
      logo: {
        alt: "deck.gl-raster logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "guidesSidebar",
          position: "left",
          label: "Docs",
        },
        {
          type: "dropdown",
          label: "API",
          position: "left",
          items: packages.map((pkg) => ({
            label: pkg.label,
            to: `api/${pkg.id}`,
          })),
        },
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
          items: [{ label: "Getting Started", to: "/docs/intro" }],
        },
        {
          title: "API Reference",
          items: packages.map((pkg) => ({
            label: pkg.label,
            to: `api/${pkg.id}`,
          })),
        },
        {
          title: "More",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/developmentseed/deck.gl-raster",
            },
            {
              label: "npm",
              href: "https://www.npmjs.com/search?q=%40developmentseed",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Development Seed. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["typescript", "bash"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
