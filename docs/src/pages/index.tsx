import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";
import clsx from "clsx";

import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/intro">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

function Feature({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={clsx("col col--4")}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title}`}
      description="GPU-accelerated COG and Zarr visualization in deck.gl"
    >
      <HomepageHeader />
      <main>
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              <Feature
                title="Cloud-Optimized GeoTIFF"
                description="Efficiently stream and render Cloud-Optimized GeoTIFFs directly from cloud storage with GPU-accelerated rendering."
              />
              <Feature
                title="Zarr Support"
                description="Visualize multi-dimensional Zarr arrays with support for chunked, compressed data formats."
              />
              <Feature
                title="Client-Side Reprojection"
                description="Reproject raster data on-the-fly using GPU shaders for seamless integration with any map projection."
              />
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
