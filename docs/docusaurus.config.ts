import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

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
    id: "deck-gl-raster-gpu-modules",
    label: "deck.gl-raster/gpu-modules",
    entry: "../packages/deck.gl-raster/src/gpu-modules/index.ts",
    readme: "../packages/deck.gl-raster/GPU_MODULES.md",
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
    id: "geozarr",
    label: "geozarr",
    entry: "../packages/geozarr/src/index.ts",
    readme: "../packages/geozarr/README.md",
  },
  {
    id: "morecantile",
    label: "morecantile",
    entry: "../packages/morecantile/src/index.ts",
    readme: "../packages/morecantile/README.md",
  },
  {
    id: "proj",
    label: "proj",
    entry: "../packages/proj/src/index.ts",
    readme: "../packages/proj/README.md",
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
const BASE_DECK_GL = "https://deck.gl/docs/api-reference";
const BASE_DECK_GL_GEOTIFF = `${BASE}/api/deck-gl-geotiff`;
const BASE_DECK_GL_RASTER = `${BASE}/api/deck-gl-raster`;
const BASE_DECK_GL_RASTER_GPU_MODULES = `${BASE}/api/deck-gl-raster-gpu-modules`;
const BASE_DECK_GL_ZARR = `${BASE}/api/deck-gl-zarr`;
const BASE_GEOTIFF = `${BASE}/api/geotiff`;
const BASE_GEOZARR = `${BASE}/api/geozarr`;
const BASE_MORECANTILE = `${BASE}/api/morecantile`;
const BASE_RASTER_REPROJECT = `${BASE}/api/raster-reproject`;
const BASE_LUMA_GL = "https://luma.gl/docs/api-reference";

/**
 * Cross-package symbol link mappings for TypeDoc's externalSymbolLinkMappings.
 * Keys are npm package names; values map symbol names to their doc URLs.
 * The "*" wildcard is a fallback for any symbol not explicitly listed.
 */
const crossPackageLinks: Record<string, Record<string, string>> = {
  "@developmentseed/affine": {
    Affine: `${BASE_AFFINE}/type-aliases/Affine/`,
  },
  "@developmentseed/deck.gl-geotiff": {
    COGLayer: `${BASE_DECK_GL_GEOTIFF}/classes/COGLayer/`,
    MosaicLayer: `${BASE_DECK_GL_GEOTIFF}/classes/MosaicLayer/`,
    MosaicTileset2D: `${BASE_DECK_GL_GEOTIFF}/classes/MosaicTileset2D/`,
    MultiCOGLayer: `${BASE_DECK_GL_GEOTIFF}/classes/MultiCOGLayer/`,
  },
  "@developmentseed/deck.gl-raster": {
    RasterLayer: `${BASE_DECK_GL_RASTER}/classes/RasterLayer/`,
    RasterTileLayer: `${BASE_DECK_GL_RASTER}/classes/RasterTileLayer/`,
    RasterTileLayerProps: `${BASE_DECK_GL_RASTER}/type-aliases/RasterTileLayerProps/`,
    RenderTileResult: `${BASE_DECK_GL_RASTER}/type-aliases/RenderTileResult/`,
    TilesetDescriptor: `${BASE_DECK_GL_RASTER}/interfaces/TilesetDescriptor/`,
  },
  "@developmentseed/deck.gl-raster/gpu-modules": {
    BlackIsZero: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/BlackIsZero/`,
    CMYKToRGB: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/CMYKToRGB/`,
    cieLabToRGB: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/cieLabToRGB/`,
    WhiteIsZero: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/WhiteIsZero/`,
    YCbCrToRGB: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/YCbCrToRGB/`,
    Colormap: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/Colormap/`,
    ColormapProps: `${BASE_DECK_GL_RASTER_GPU_MODULES}/type-aliases/ColormapProps/`,
    COLORMAP_INDEX: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/COLORMAP_INDEX/`,
    ColormapName: `${BASE_DECK_GL_RASTER_GPU_MODULES}/type-aliases/ColormapName/`,
    CompositeBands: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/CompositeBands/`,
    CompositeBandsProps: `${BASE_DECK_GL_RASTER_GPU_MODULES}/type-aliases/CompositeBandsProps/`,
    buildCompositeBandsProps: `${BASE_DECK_GL_RASTER_GPU_MODULES}/functions/buildCompositeBandsProps/`,
    createColormapTexture: `${BASE_DECK_GL_RASTER_GPU_MODULES}/functions/createColormapTexture/`,
    CreateTexture: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/CreateTexture/`,
    CutlineBbox: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/CutlineBbox/`,
    CutlineBboxProps: `${BASE_DECK_GL_RASTER_GPU_MODULES}/type-aliases/CutlineBboxProps/`,
    lngLatToMercator: `${BASE_DECK_GL_RASTER_GPU_MODULES}/functions/lngLatToMercator/`,
    ColormapSpriteSource: `${BASE_DECK_GL_RASTER_GPU_MODULES}/type-aliases/ColormapSpriteSource/`,
    decodeColormapSprite: `${BASE_DECK_GL_RASTER_GPU_MODULES}/functions/decodeColormapSprite/`,
    FilterNoDataVal: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/FilterNoDataVal/`,
    LinearRescale: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/LinearRescale/`,
    LinearRescaleProps: `${BASE_DECK_GL_RASTER_GPU_MODULES}/type-aliases/LinearRescaleProps/`,
    MaskTexture: `${BASE_DECK_GL_RASTER_GPU_MODULES}/variables/MaskTexture/`,
    RasterModule: `${BASE_DECK_GL_RASTER_GPU_MODULES}/type-aliases/RasterModule/`,
  },
  "@developmentseed/deck.gl-zarr": {
    ZarrLayer: `${BASE_DECK_GL_ZARR}/classes/ZarrLayer/`,
    ZarrLayerProps: `${BASE_DECK_GL_ZARR}/type-aliases/ZarrLayerProps/`,
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
    parseColormap: `${BASE_GEOTIFF}/functions/parseColormap/`,
  },
  "@developmentseed/geozarr": {
    parseGeoZarrMetadata: `${BASE_GEOZARR}/functions/parseGeoZarrMetadata/`,
    GeoZarrMetadata: `${BASE_GEOZARR}/interfaces/GeoZarrMetadata/`,
    MultiscaleLevel: `${BASE_GEOZARR}/interfaces/MultiscaleLevel/`,
    CRSInfo: `${BASE_GEOZARR}/interfaces/CRSInfo/`,
  },
  "@developmentseed/morecantile": {
    TileMatrixSet: `${BASE_MORECANTILE}/interfaces/TileMatrixSet/`,
    TileMatrix: `${BASE_MORECANTILE}/interfaces/TileMatrix/`,
    BoundingBox: `${BASE_MORECANTILE}/interfaces/BoundingBox/`,
    CRS: `${BASE_MORECANTILE}/type-aliases/CRS/`,
  },
  "@developmentseed/raster-reproject": {
    RasterReprojector: `${BASE_RASTER_REPROJECT}/classes/RasterReprojector/`,
    ReprojectionFns: `${BASE_RASTER_REPROJECT}/interfaces/ReprojectionFns/`,
  },
  "deck.gl": {
    Layer: `${BASE_DECK_GL}/core/layer/`,
    SimpleMeshLayer: `${BASE_DECK_GL}/mesh-layers/simple-mesh-layer/`,
    TileLayer: `${BASE_DECK_GL}/geo-layers/tile-layer/`,
  },
  "@deck.gl/core": {
    Layer: `${BASE_DECK_GL}/core/layer/`,
  },
  "@deck.gl/mesh-layers": {
    SimpleMeshLayer: `${BASE_DECK_GL}/mesh-layers/simple-mesh-layer/`,
  },
  "@deck.gl/geo-layers": {
    TileLayer: `${BASE_DECK_GL}/geo-layers/tile-layer/`,
  },
  "@luma.gl/core": {
    Device: `${BASE_LUMA_GL}/core/device/`,
    RenderPipeline: `${BASE_LUMA_GL}/core/resources/render-pipeline/`,
    Texture: `${BASE_LUMA_GL}/core/resources/texture/`,
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
    excludeProtected: true,
    excludeInternal: true,
    readme: pkg.readme,
    mergeReadme: true,
    plugin: ["typedoc-plugin-mdn-links", "typedoc-plugin-no-inherit"],
    inheritNone: true,
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
    "Client-side Cloud-Optimized GeoTIFF and Zarr visualization in deck.gl.",
  favicon: "img/ds_favicon.png",

  future: {
    v4: true,
  },

  url: "https://developmentseed.github.io",
  baseUrl: "/deck.gl-raster/",

  organizationName: "developmentseed",
  projectName: "deck.gl-raster",

  trailingSlash: true,

  stylesheets: [
    {
      href: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css",
      type: "text/css",
      crossorigin: "anonymous",
    },
  ],

  headTags: [
    {
      tagName: "script",
      attributes: {
        async: "true",
        src: "https://plausible.io/js/pa-GXbpwCRHPm1QSDOLNB_on.js",
      },
    },
    {
      tagName: "script",
      attributes: {},
      innerHTML: `window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`,
    },
  ],
  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  plugins: [
    ...typedocPlugins,
    ...contentDocsPlugins,
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        indexBlog: true,
        docsRouteBasePath: ["docs", "api"],
      },
    ],
    "./plugins/changelog.js",
  ],

  clientModules: ["./src/clientModules/searchHotkey.ts"],

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
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        blog: {
          showReadingTime: true,
          feedOptions: { type: ["rss", "atom"] },
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
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
        src: "img/ds-logo-symbol--pos-neg.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "guidesSidebar",
          position: "left",
          label: "Docs",
        },
        { to: "/examples", label: "Examples", position: "left" },
        { to: "/blog", label: "Blog", position: "left" },
        {
          type: "dropdown",
          label: "API Reference",
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
          items: [
            { label: "Getting Started", to: "/docs/intro" },
            { label: "Examples", to: "/examples" },
          ],
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
