const SEP = "|";

export type EPSGEntry = {
  code: number;
  wkt: string;
};

export default async function loadEPSG(): Promise<EPSGEntry[]> {
  const url = new URL("./epsg.csv.gz", import.meta.url);
  const response = await fetch(url);
  const decompressed = response.body!.pipeThrough(
    new DecompressionStream("gzip"),
  );
  const text = await new Response(decompressed).text();
  return parseCsv(text);
}

function parseCsv(text: string): EPSGEntry[] {
  const lines = text.split("\n");
  const data = lines
    .filter((line) => line.length > 0)
    .map((line) => {
      const sep = line.indexOf(SEP);
      return {
        code: Number.parseInt(line.slice(0, sep), 10),
        wkt: line.slice(sep + 1),
      };
    });
  return data;
}
