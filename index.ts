import { readdir, stat } from "fs/promises";
import { join, extname } from "path";
import { Pool } from "pg";

type Image = {
  filename: string;
  parameters: string;
};

async function extractParametersFromPNG(filePath: string) {
  try {
    const fileBuffer = await Bun.file(filePath).arrayBuffer();
    const buffer = Buffer.from(fileBuffer);

    let offset = 8;
    const length = buffer.length;

    while (offset < length) {
      const chunkLength = buffer.readUInt32BE(offset);
      const chunkType = buffer.toString("ascii", offset + 4, offset + 8);

      if (chunkType === "tEXt") {
        const textData = buffer
          .slice(offset + 8, offset + 8 + chunkLength)
          .toString("utf-8");

        let sanitizedText = textData.replace(/\0/g, " ");

        if (sanitizedText.startsWith("parameters")) {
          sanitizedText = sanitizedText.replace("parameters ", "");
          return sanitizedText;
        }
      }

      offset += chunkLength + 12;
    }
    console.log("No parameters found in the PNG.", filePath);
    return null;
  } catch (err) {
    console.error("Error:", err);
    return null;
  }
}

async function processDirectory(directoryPath: string) {
  const images: Image[] = [];
  try {
    const files = await readdir(directoryPath);

    for (const file of files) {
      const filePath = join(directoryPath, file);
      const fileStat = await stat(filePath);

      if (fileStat.isDirectory()) {
        const subImages = await processDirectory(filePath);
        images.push(...subImages);
      } else if (extname(filePath).toLowerCase() === ".png") {
        const parameters = await extractParametersFromPNG(filePath);
        if (parameters) {
          images.push({ filename: file, parameters });
        }
      }
    }
    console.log("Images with parameters:", images.length);
    return images;
  } catch (err) {
    console.error("Error reading directory:", directoryPath, err);
    return [];
  }
}

async function addImagesToDatabase(images: Image[]) {
  const pool = new Pool({
    connectionString: Bun.env.CONNECTION_STRING,
  });

  const valuePlaceholders = images
    .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
    .join(",");

  const values = images.reduce((prev, curr) => {
    prev.push(curr.filename, curr.parameters);
    return prev;
  }, [] as string[]);

  const query = `
      INSERT INTO images.files (filename, parameters)
      VALUES ${valuePlaceholders}
      ON CONFLICT (filename) DO NOTHING;
    `;
  const client = await pool.connect();

  await client.query(query, values);

  client.release();
}

async function main() {
  let start = performance.now();
  const images = await processDirectory("images");
  let end = performance.now();
  console.log("Time taken:", end - start, "ms");

  start = performance.now();
  await addImagesToDatabase(images);
  end = performance.now();

  console.log("Time taken to insert:", end - start, "ms");
}

main();