import Link from "@docusaurus/Link";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";
import clsx from "clsx";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";

import styles from "./styles.module.css";

type Example = {
  title: string;
  description: ReactNode;
  href: string;
  /** One image, or several screenshots for the card to cycle through. */
  image: string | string[];
  source: string;
};

/** How long a multi-image card shows each screenshot before the next. */
const SLIDESHOW_INTERVAL_MS = 2000;

const cogExamples: Example[] = [
  {
    title: "RGB GeoTIFF",
    description: (
      <>
        Load and display RGB Cloud-Optimized GeoTIFF imagery with the{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/COGLayer/">
          COGLayer
        </Link>
        .
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/cog-basic/",
    image: "/deck.gl-raster/img/hero-page-nyc-sentinel.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/cog-basic",
  },
  {
    title: "Land Cover",
    description: (
      <>
        Visualize a 1.3 GB USGS annual land cover dataset using{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/COGLayer/">
          COGLayer
        </Link>{" "}
        with a categorical colormap.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/land-cover/",
    image: "/deck.gl-raster/img/land-cover-categories-hero.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/land-cover",
  },
  {
    title: "NAIP Mosaic",
    description: (
      <>
        Stream a client-side mosaic of NAIP aerial imagery COGs using{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/MosaicLayer/">
          MosaicLayer
        </Link>
        , sourced from Microsoft Planetary Computer.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/naip-mosaic/",
    image: "/deck.gl-raster/img/naip-mosaic-examples-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/naip-mosaic",
  },
  {
    title: "Globe View",
    description: (
      <>
        Render Cloud-Optimized GeoTIFFs on a 3D globe using{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/COGLayer/">
          COGLayer
        </Link>{" "}
        with MapLibre's globe projection.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/cog-globe/",
    image: "/deck.gl-raster/img/cog-globe.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/cog-globe",
  },
  {
    title: "Sentinel-2 Multi-Band",
    description: (
      <>
        Render split-band, mixed-resolution COGs using{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/MultiCOGLayer/">
          MultiCOGLayer
        </Link>
        . The GPU handles cross-resolution resampling.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/sentinel-2/",
    image: [
      "/deck.gl-raster/img/sentinel-2-examples-card.jpg",
      "/deck.gl-raster/img/sentinel-2-kamchatka.jpg",
      "/deck.gl-raster/img/sentinel-2-mt-etna.jpg",
      "/deck.gl-raster/img/sentinel-2-nile-delta.jpg",
      "/deck.gl-raster/img/sentinel-2-sossusvlei.jpg",
    ],
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/sentinel-2",
  },
  {
    title: "Before/After Comparison",
    description: <>Use a slider to compare Vermont state imagery over time.</>,
    href: "https://developmentseed.org/deck.gl-raster/examples/vermont-cog-comparison/",
    image: "/deck.gl-raster/img/vermont-swipe-example.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/vermont-cog-comparison",
  },
  {
    title: "USGS Historical Topo Maps",
    description: (
      <>
        Render scanned USGS topographic maps, cutting away each sheet's printed
        collar with deck.gl's{" "}
        <Link to="https://deck.gl/docs/api-reference/extensions/clip-extension">
          ClipExtension
        </Link>
        .
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/usgs-topo/",
    image: "/deck.gl-raster/img/usgs-topo-example-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/usgs-topo",
  },
];

const zarrExamples: Example[] = [
  {
    title: "ECMWF Temperature Forecast",
    description: (
      <>
        Use the{" "}
        <Link to="/deck.gl-raster/api/deck-gl-zarr/classes/ZarrLayer/">
          ZarrLayer
        </Link>{" "}
        to animate over 4-dimensional numerical data.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/dynamical-zarr-ecmwf/",
    image: "/deck.gl-raster/img/dynamical-zarr-ecmwf.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/dynamical-zarr-ecmwf",
  },
  {
    title: "AEF Mosaic Embeddings",
    description: (
      <>
        Use the{" "}
        <Link to="/deck.gl-raster/api/deck-gl-zarr/classes/ZarrLayer/">
          ZarrLayer
        </Link>{" "}
        to visualize embeddings data.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/aef-mosaic/",
    image: "/deck.gl-raster/img/aef-mosaic.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/aef-mosaic",
  },
  {
    title: "NLDAS Icechunk",
    description: (
      <>
        Use the{" "}
        <Link to="/deck.gl-raster/api/deck-gl-zarr/classes/ZarrLayer/">
          ZarrLayer
        </Link>{" "}
        to read from an <Link to="https://icechunk.io/">Icechunk</Link>{" "}
        repository.
        <br />
        The store is{" "}
        <Link to="https://icechunk.io/en/stable/guides/virtual/">
          <em>virtualized</em>
        </Link>
        , so tile requests read directly from source NetCDF files.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/nldas-icechunk/",
    image: "/deck.gl-raster/img/nldas-3-icechunk.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/nldas-icechunk",
  },
];

/**
 * Examples published to show what deck.gl-raster makes possible, before their
 * architecture has been reviewed and endorsed.
 *
 * Their sources live under `examples/experimental/`, but their `href` omits
 * that segment — the published URL must not change when an example graduates,
 * so promotion is a pure `git mv`.
 */
const experimentalExamples: Example[] = [
  {
    title: "Preview: Custom Projections",
    description: (
      <>
        Render COGs in polar stereographic, Equal Earth, and other map
        projections. A preview of deck.gl v10's custom projection support.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/custom-projection/",
    image: "/deck.gl-raster/img/custom-projection-antarctica-example-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/experimental/custom-projection",
  },
  {
    title: "GeoArrow Overlay",
    description: (
      <>
        3.4 million GeoArrow points, streamed from Parquet with parquet-wasm,
        over a global imagery COG.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/geoarrow-overlay/",
    image: "/deck.gl-raster/img/geoarrow-overlay-example-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/experimental/geoarrow-overlay",
  },
  {
    title: "Titiler Tiles",
    description: (
      <>
        Render NumPy array tiles from a{" "}
        <Link to="https://developmentseed.org/titiler/">titiler</Link> server
        with{" "}
        <Link to="/deck.gl-raster/api/deck-gl-raster/classes/RasterTileLayer/">
          RasterTileLayer
        </Link>
        .
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/titiler-cog/",
    image: "/deck.gl-raster/img/titiler-cog-example-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/experimental/titiler-cog",
  },
  {
    title: "Rasters over Terrain",
    description: (
      <>
        Drape COGs in their own projections over Web Mercator 3D terrain tiles
        with deck.gl's experimental TerrainExtension.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/cog-terrain/",
    image: "/deck.gl-raster/img/cog-terrain-naip-pikes-peak.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/experimental/cog-terrain",
  },
  {
    title: "Hillshade from PMTiles",
    description: (
      <>
        Shade Mapterhorn's global terrain on the GPU, read from one PMTiles
        archive by{" "}
        <Link to="/deck.gl-raster/api/deck-gl-raster/classes/RasterTileLayer/">
          RasterTileLayer
        </Link>{" "}
        with merged range requests.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/pmtiles-terrain/",
    image: "/deck.gl-raster/img/pmtiles-terrain-example-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/experimental/pmtiles-terrain",
  },
];

/**
 * Animated explanations of how deck.gl-raster works internally. Their code is
 * unreviewed and not meant as a pattern to copy.
 *
 * Their sources live under `examples/explainers/`, but their `href` omits that
 * segment, like the experimental examples.
 */
const explainerExamples: Example[] = [
  {
    title: "Reprojection Explainer",
    description: (
      <>
        A step-by-step animation of how deck.gl-raster reprojects a raster on
        the GPU.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/reprojection-explainer/",
    image: "/deck.gl-raster/img/reprojection-explainer-examples-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/explainers/reprojection-explainer",
  },
  {
    title: "MultiCOGLayer Explainer",
    description: (
      <>
        A step-by-step animation of how MultiCOGLayer draws bands stored at
        different resolutions as one image.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/multi-cog-explainer/",
    image: "/deck.gl-raster/img/multi-cog-explainer-examples-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/explainers/multi-cog-explainer",
  },
  {
    title: "Antimeridian Explainer",
    description: (
      <>
        A step-by-step animation of how deck.gl-raster meshes an image that
        crosses the antimeridian.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/antimeridian-explainer/",
    image: "/deck.gl-raster/img/antimeridian-explainer-examples-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/explainers/antimeridian-explainer",
  },
];

/**
 * Crossfade through several screenshots of one example, holding each for
 * {@link SLIDESHOW_INTERVAL_MS}. Stays on the first when the viewer prefers
 * reduced motion.
 */
function CardSlideshow({
  images,
  title,
}: {
  images: string[];
  title: string;
}): ReactNode {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = setInterval(() => {
      setActive((i) => (i + 1) % images.length);
    }, SLIDESHOW_INTERVAL_MS);
    return () => clearInterval(id);
  }, [images.length]);

  return (
    <div className={styles.cardSlideshow}>
      {images.map((src, i) => (
        <img
          key={src}
          src={src}
          alt={i === 0 ? title : ""}
          className={clsx(
            styles.cardImage,
            i !== active && styles.cardImageHidden,
          )}
        />
      ))}
    </div>
  );
}

function ExampleCard({
  title,
  description,
  href,
  image,
  source,
}: Example): ReactNode {
  return (
    <div className={styles.card}>
      <Link href={href} target="_blank" rel="noopener noreferrer">
        {typeof image === "string" ? (
          <img src={image} alt={title} className={styles.cardImage} />
        ) : (
          <CardSlideshow images={image} title={title} />
        )}
      </Link>
      <div className={styles.cardBody}>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
      <div className={styles.cardFooter}>
        <Link
          className="button button--primary button--sm"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Example ↗
        </Link>
        <Link
          className="button button--secondary button--sm"
          href={source}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35em",
          }}
        >
          Source
          <FaGithub />
        </Link>
      </div>
    </div>
  );
}

export default function Examples(): ReactNode {
  return (
    <Layout
      title="Examples"
      description="Interactive examples for deck.gl-raster"
    >
      <main className={styles.main}>
        <div className="container">
          <Heading as="h1">Examples</Heading>
          <p className={styles.intro}>
            Interactive demos built with deck.gl-raster. Each example opens as a
            standalone application.
          </p>
          <Heading as="h2">COG Examples</Heading>
          <div className={styles.grid}>
            {cogExamples.map((ex) => (
              <ExampleCard key={ex.title} {...ex} />
            ))}
          </div>
          <Heading as="h2">Zarr Examples</Heading>
          <div className={styles.grid}>
            {zarrExamples.map((ex) => (
              <ExampleCard key={ex.title} {...ex} />
            ))}
          </div>
          <Heading as="h2">Experimental Examples</Heading>
          <p className={styles.intro}>
            These demonstrate what deck.gl-raster makes possible, but their
            architecture has not been reviewed and endorsed. Treat them as
            demonstrations rather than patterns to copy.
          </p>
          <div className={styles.grid}>
            {experimentalExamples.map((ex) => (
              <ExampleCard key={ex.title} {...ex} />
            ))}
          </div>
          <Heading as="h2">Explainers</Heading>
          <p className={styles.intro}>
            Animated explanations of how deck.gl-raster works under the hood.
          </p>
          <div className={styles.grid}>
            {explainerExamples.map((ex) => (
              <ExampleCard key={ex.title} {...ex} />
            ))}
          </div>
        </div>
      </main>
    </Layout>
  );
}
