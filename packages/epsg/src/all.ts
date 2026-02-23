const SEP = "|";

export type EPSGEntry = {
  code: number;
  wkt: string;
};

export default async function loadEPSG(): Promise<EPSGEntry[]> {
  const url = new URL("./epsg.csv.gz", import.meta.url);
  const response = await fetch(url);
  const bytes = await response.arrayBuffer();
  return parseCsv(bytes);
}

function parseCsv(bytes: ArrayBuffer): EPSGEntry[] {
  const decoder = new TextDecoder("utf-8");
  const text = decoder.decode(bytes);
  const lines = text.split("\n");
  const data = lines.map((line) => {
    const [code, wkt] = line.split(SEP);
    return { code: Number.parseInt(code, 10), wkt };
  });
  return data;
}
