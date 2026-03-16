import Link from "@docusaurus/Link";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";
import type { ReactNode } from "react";

import styles from "./styles.module.css";

type Example = {
  title: string;
  description: string;
  href: string;
  image: string;
};

const examples: Example[] = [
  {
    title: "COG Basic",
    description:
      "Load and display RGB imagery from a Cloud-Optimized GeoTIFF with automatic reprojection from a non-Web Mercator CRS.",
    href: "https://developmentseed.org/deck.gl-raster/examples/cog-basic/",
    image: "/deck.gl-raster/img/cog-basic-examples-card.png",
  },
  {
    title: "Land Cover",
    description:
      "Visualize a 1.3 GB USGS annual land cover dataset using COGLayer with a categorical colormap.",
    href: "https://developmentseed.org/deck.gl-raster/examples/land-cover/",
    image: "/deck.gl-raster/img/land-cover-examples-card.png",
  },
  {
    title: "NAIP Mosaic",
    description:
      "Stream a client-side mosaic of NAIP aerial imagery COGs using MosaicLayer, sourced from Microsoft Planetary Computer.",
    href: "https://developmentseed.org/deck.gl-raster/examples/naip-mosaic/",
    image: "/deck.gl-raster/img/naip-mosaic-examples-card.png",
  },
];

function ExampleCard({ title, description, href, image }: Example): ReactNode {
  return (
    <div className={styles.card}>
      <img src={image} alt={title} className={styles.cardImage} />
      <div className={styles.cardBody}>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
      <div className={styles.cardFooter}>
        <Link
          className="button button--primary"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open example ↗
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
          <div className={styles.grid}>
            {examples.map((ex) => (
              <ExampleCard key={ex.title} {...ex} />
            ))}
          </div>
        </div>
      </main>
    </Layout>
  );
}
