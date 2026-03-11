import Heading from "@theme/Heading";
import clsx from "clsx";
import type { ReactNode } from "react";
import styles from "./styles.module.css";

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<"svg">>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: "GPU-Accelerated Raster Rendering",
    Svg: require("@site/static/img/undraw_docusaurus_mountain.svg").default,
    description: (
      <>
        Render large raster datasets at interactive framerates using WebGL2 via
        deck.gl and luma.gl. Shader-based color mapping, compositing, and
        reprojection happen entirely on the GPU.
      </>
    ),
  },
  {
    title: "Cloud-Optimized Formats",
    Svg: require("@site/static/img/undraw_docusaurus_tree.svg").default,
    description: (
      <>
        Stream Cloud-Optimized GeoTIFFs (COG) and Zarr arrays directly from
        object storage with range requests — no tiling server required. Works
        with any HTTP-accessible data source.
      </>
    ),
  },
  {
    title: "Flexible Visualization Pipeline",
    Svg: require("@site/static/img/undraw_docusaurus_react.svg").default,
    description: (
      <>
        Compose raster modules for band math, colormapping, and multi-source
        mosaicking. Bring your own GLSL or use the built-in modules for common
        scientific visualization patterns.
      </>
    ),
  },
];

function Feature({ title, Svg, description }: FeatureItem) {
  return (
    <div className={clsx("col col--4")}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
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
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
