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
  {
    id: "affine",
    label: "affine",
    entry: "../packages/affine/src/index.ts",
    readme: "../packages/affine/README.md",
  },
  {
    id: "deck-gl-geotiff",
    label: "deck.gl-geotiff",
    entry: "../packages/deck.gl-geotiff/src/index.ts",
    readme: "../packages/deck.gl-geotiff/README.md",
  },
  {
    id: "deck-gl-raster",
    label: "deck.gl-raster",
    entry: "../packages/deck.gl-raster/src/index.ts",
    readme: "../packages/deck.gl-raster/README.md",
  },
  {
    id: "deck-gl-zarr",
    label: "deck.gl-zarr",
    entry: "../packages/deck.gl-zarr/src/index.ts",
    readme: "../packages/deck.gl-zarr/README.md",
  },
  {
    id: "epsg",
    label: "epsg",
    entry: "../packages/epsg/src/all.ts",
    readme: "../packages/epsg/README.md",
  },
  {
    id: "geotiff",
    label: "geotiff",
    entry: "../packages/geotiff/src/index.ts",
    readme: "../packages/geotiff/README.md",
  },
  {
    id: "morecantile",
    label: "morecantile",
    entry: "../packages/morecantile/src/index.ts",
    readme: "../packages/morecantile/README.md",
  },
  {
    id: "raster-reproject",
    label: "raster-reproject",
    entry: "../packages/raster-reproject/src/index.ts",
    readme: "../packages/raster-reproject/README.md",
  },
];

const BASE = "/deck.gl-raster";
const BASE_AFFINE = `${BASE}/api/affine`;
const BASE_GEOTIFF = `${BASE}/api/geotiff`;
const BASE_MORECANTILE = `${BASE}/api/morecantile`;
const BASE_RASTER_REPROJECT = `${BASE}/api/raster-reproject`;
const BASE_DECK_GL_RASTER = `${BASE}/api/deck-gl-raster`;

/**
 * Cross-package symbol link mappings for TypeDoc's externalSymbolLinkMappings.
 * Keys are npm package names; values map symbol names to their doc URLs.
 * The "*" wildcard is a fallback for any symbol not explicitly listed.
 */
const crossPackageLinks: Record<string, Record<string, string>> = {
  "@developmentseed/affine": {
    Affine: `${BASE_AFFINE}/type-aliases/Affine/`,
    "*": `${BASE_AFFINE}/`,
  },
  "@developmentseed/geotiff": {
    GeoTIFF: `${BASE_GEOTIFF}/classes/GeoTIFF/`,
    Overview: `${BASE_GEOTIFF}/classes/Overview/`,
    DecoderPool: `${BASE_GEOTIFF}/classes/DecoderPool/`,
    RasterArray: `${BASE_GEOTIFF}/type-aliases/RasterArray/`,
    RasterTypedArray: `${BASE_GEOTIFF}/type-aliases/RasterTypedArray/`,
    Tile: `${BASE_GEOTIFF}/type-aliases/Tile/`,
    Decoder: `${BASE_GEOTIFF}/type-aliases/Decoder/`,
    DecoderMetadata: `${BASE_GEOTIFF}/type-aliases/DecoderMetadata/`,
    DecoderPoolOptions: `${BASE_GEOTIFF}/type-aliases/DecoderPoolOptions/`,
    ProjJson: `${BASE_GEOTIFF}/type-aliases/ProjJson/`,
    parseColormap: `${BASE_GEOTIFF}/functions/parseColormap/`,
    "*": `${BASE_GEOTIFF}/`,
  },
  "@developmentseed/morecantile": {
    TileMatrixSet: `${BASE_MORECANTILE}/interfaces/TileMatrixSet/`,
    TileMatrix: `${BASE_MORECANTILE}/interfaces/TileMatrix/`,
    BoundingBox: `${BASE_MORECANTILE}/interfaces/BoundingBox/`,
    CRS: `${BASE_MORECANTILE}/type-aliases/CRS/`,
    "*": `${BASE_MORECANTILE}/`,
  },
  "@developmentseed/raster-reproject": {
    RasterReprojector: `${BASE_RASTER_REPROJECT}/classes/RasterReprojector/`,
    ReprojectionFns: `${BASE_RASTER_REPROJECT}/interfaces/ReprojectionFns/`,
    "*": `${BASE_RASTER_REPROJECT}/`,
  },
  "@developmentseed/deck.gl-raster": {
    "*": `${BASE_DECK_GL_RASTER}/`,
  },
};

// One docusaurus-plugin-typedoc per package.
// These generate markdown into docs/api/<id>/ when `generate-typedoc` is run.
const typedocPlugins = packages.map((pkg) => [
  "docusaurus-plugin-typedoc",
  {
    id: `typedoc-${pkg.id}`,
    entryPoints: [pkg.entry],
    tsconfig: "../tsconfig.json",
    out: `api/${pkg.id}`,
    docsPath: `api/${pkg.id}`,
    excludePrivate: true,
    excludeInternal: true,
    readme: pkg.readme,
    mergeReadme: true,
    plugin: ["typedoc-plugin-mdn-links"],
    externalSymbolLinkMappings: crossPackageLinks,
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
    sidebarPath: `./api-sidebars/${pkg.id}.cjs`,
    editUrl: "https://github.com/developmentseed/deck.gl-raster/tree/main/",
  },
]);

const config: Config = {
  title: "deck.gl-raster",
  tagline:
    "Client-side, GPU-accelerated Cloud-Optimized GeoTIFF (and soon Zarr) visualization in deck.gl",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  url: "https://developmentseed.github.io",
  baseUrl: "/deck.gl-raster/",

  organizationName: "developmentseed",
  projectName: "deck.gl-raster",

  trailingSlash: true,
  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

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
          path: "guides",
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
          editUrl:
            "https://github.com/developmentseed/deck.gl-raster/tree/main/docs/",
        },
        blog: {
          showReadingTime: true,
          feedOptions: { type: ["rss", "atom"] },
        },
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
        { to: "/blog", label: "Blog", position: "left" },
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
              label: "LinkedIn",
              href: "https://www.linkedin.com/company/development-seed",
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
