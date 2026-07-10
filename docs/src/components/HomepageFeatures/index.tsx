import Heading from "@theme/Heading";
import clsx from "clsx";
import type { ReactNode } from "react";
import styles from "./styles.module.css";

type FeatureItem = {
  title: string;
  Svg?: React.ComponentType<React.ComponentProps<"svg">>;
  img?: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: "GPU-Accelerated Raster Rendering",
    img: require("@site/static/img/hero-page-nyc-sentinel.jpg").default,
    description: (
      <>
        Render large raster datasets at interactive framerates using WebGL2 via{" "}
        <a target="_blank" rel="noopener noreferrer" href="https://deck.gl">
          deck.gl
        </a>{" "}
        and{" "}
        <a target="_blank" rel="noopener noreferrer" href="https://luma.gl">
          luma.gl
        </a>
        . Color mapping, compositing, and reprojection happen entirely on the
        GPU.
      </>
    ),
  },
  {
    title: "Cloud-Optimized Formats",
    img: require("@site/static/img/cog-white-background.png").default,
    description: (
      <>
        Stream{" "}
        <a target="_blank" rel="noopener noreferrer" href="https://cogeo.org">
          Cloud-Optimized GeoTIFFs
        </a>{" "}
        and{" "}
        <a target="_blank" rel="noopener noreferrer" href="https://zarr.dev">
          Zarr arrays
        </a>{" "}
        directly from object storage — no tiling server required.
      </>
    ),
  },
  {
    title: "Flexible Visualization Pipeline",
    img: require("@site/static/img/naip-mosaic-examples-card.jpg").default,
    description: (
      <>
        Compose raster modules for band math, nodata masking, and color mapping.
        Use provided modules for common scientific visualization patterns or
        write your own custom shader code for maximum flexibility.
      </>
    ),
  },
];

function Feature({ title, Svg, img, description }: FeatureItem) {
  return (
    <div className={clsx("col col--4")}>
      <div className="text--center">
        {img ? (
          <img src={img} className={styles.featureImg} alt={title} />
        ) : (
          Svg && <Svg className={styles.featureSvg} role="img" />
        )}
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props) => (
            <Feature key={props.title} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
