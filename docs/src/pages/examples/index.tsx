import Link from "@docusaurus/Link";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";
import type { ReactNode } from "react";
import { FaGithub } from "react-icons/fa";

import styles from "./styles.module.css";

type Example = {
  title: string;
  description: ReactNode;
  href: string;
  image: string;
  source: string;
};

const cogExamples: Example[] = [
  {
    title: "RGB GeoTIFF",
    description: (
      <>
        Load and display RGB Cloud-Optimized GeoTIFF imagery with the{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/COGLayer/">
          COGLayer
        </Link>{" "}
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
    image: "/deck.gl-raster/img/land-cover-examples-card.jpg",
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
    image: "/deck.gl-raster/img/sentinel-2-examples-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/sentinel-2",
  },
  {
    title: "Before/After Comparison",
    description: <>Use a slider to compare Vermont state imagery over time.</>,
    href: "https://developmentseed.org/deck.gl-raster/examples/vermont-cog-comparison/",
    image: "/deck.gl-raster/img/vermont-opendata-example-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/vermont-cog-comparison",
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
];

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
        <img src={image} alt={title} className={styles.cardImage} />
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
        </div>
      </main>
    </Layout>
  );
}
