// SPDX-License-Identifier: MIT
import { readFile } from "node:fs/promises";

// Test input composition only: the sole validation seam remains validateCorpus.
export async function loadFoundation() {
  const read = async (name) => JSON.parse(await readFile(new URL(`./corpus/${name}`, import.meta.url), "utf8"));
  const directory = await read("r01-directory.json");
  const catalog = await read("control/catalog.json");
  const cases = [...await read("i32/cases.json"), ...await read("control/cases.json")];
  // Ticket 07's catalog is the combined snapshot; preserve all source/oracle bytes.
  for (const record of cases) record.corpusId = catalog.corpusId;
  for (const rule of directory.rules) rule.caseIds = cases.filter((record) => record.ruleIds.includes(rule.ruleId)).map((record) => record.caseId);
  return {
    rules: { schemaVersion: directory.schemaVersion, specId: directory.specId, languageBaseline: directory.languageBaseline, rules: directory.rules },
    support: { schemaVersion: directory.schemaVersion, specId: directory.specId, capabilities: directory.capabilities },
    catalog, cases,
    sources: await Promise.all([...new Set(cases.map((record) => record.sourceId))].sort().map(async (sourceId) => ({
      sourceId, content: await readFile(new URL(`./corpus/${sourceId}`, import.meta.url), "utf8"),
    }))),
  };
}
