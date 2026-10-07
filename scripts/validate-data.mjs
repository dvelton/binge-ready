import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(ROOT, "site", "data", "finales.json");
const data = JSON.parse(await fs.readFile(file, "utf8"));
const errors = [];

if (data.schemaVersion !== 2) {
  errors.push("schemaVersion must be 2");
}
if (!Array.isArray(data.finales)) {
  errors.push("finales must be an array");
}
if (!Array.isArray(data.upcoming)) {
  errors.push("upcoming must be an array");
}
if (data.count !== data.finales?.length) {
  errors.push("count must match finales.length");
}
if (data.upcomingCount !== data.upcoming?.length) {
  errors.push("upcomingCount must match upcoming.length");
}
if (data.majorCount !== data.finales?.filter((item) => item.major).length) {
  errors.push("majorCount must match major ready finales");
}
if (
  data.upcomingMajorCount !== data.upcoming?.filter((item) => item.major).length
) {
  errors.push("upcomingMajorCount must match major upcoming finales");
}

const ids = new Set();
let previousDate = "9999-12-31";

for (const [index, item] of (data.finales ?? []).entries()) {
  if (!item.id || !item.showName || !item.finaleDate || !item.readyAt || !item.sourceUrl) {
    errors.push(`finales[${index}] is missing a required field`);
  }
  if (typeof item.major !== "boolean") {
    errors.push(`finales[${index}] is missing major classification`);
  }
  if (ids.has(item.id)) {
    errors.push(`duplicate finale id: ${item.id}`);
  }
  ids.add(item.id);
  if (Date.parse(item.readyAt) > Date.parse(data.generatedAt)) {
    errors.push(`unaired finale included as ready: ${item.id}`);
  }
  if (item.finaleDate > previousDate) {
    errors.push(`finales are not in reverse chronological order at ${item.id}`);
  }
  previousDate = item.finaleDate;
}

previousDate = "0000-01-01";

for (const [index, item] of (data.upcoming ?? []).entries()) {
  if (!item.id || !item.showName || !item.finaleDate || !item.readyAt || !item.sourceUrl) {
    errors.push(`upcoming[${index}] is missing a required field`);
  }
  if (typeof item.major !== "boolean") {
    errors.push(`upcoming[${index}] is missing major classification`);
  }
  if (ids.has(item.id)) {
    errors.push(`duplicate upcoming finale id: ${item.id}`);
  }
  ids.add(item.id);
  if (Date.parse(item.readyAt) <= Date.parse(data.generatedAt)) {
    errors.push(`aired finale included as upcoming: ${item.id}`);
  }
  if (item.finaleDate < previousDate) {
    errors.push(`upcoming finales are not chronological at ${item.id}`);
  }
  previousDate = item.finaleDate;
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${data.count} ready and ${data.upcomingCount} upcoming finale records.`
  );
}
