// SPDX-License-Identifier: MIT

/**
 * Validate Conformance Corpus records. Source text is opaque data, never executed.
 * This development boundary currently reports no real language execution.
 */
export function validateCorpus(corpus) {
  const error = validateRecords(corpus) ?? validateIdentities(corpus) ?? validateRevisions(corpus)
    ?? validateLifecycle(corpus) ?? validateReferences(corpus);
  if (error) return {
    schemaVersion: "2", recordValidation: "invalid", errors: [error],
    languageValidation: "not-executed", realProductPasses: 0,
  };
  return {
    schemaVersion: "2",
    recordValidation: "valid",
    languageValidation: "not-executed",
    realProductPasses: 0,
    identity: {
      languageBaseline: corpus.rules.languageBaseline, frontendIntake: "not-connected",
      specId: corpus.rules.specId, corpusId: corpus.catalog.corpusId,
    },
    catalog: structuredClone(corpus.catalog),
    cases: corpus.cases.map(({ specId, corpusId, caseId, sourceId, ruleIds, capabilities, target, mode }) => ({
      specId, corpusId, caseId, sourceId, ruleIds: [...ruleIds], capabilities: [...capabilities],
      target, mode, languageValidation: "not-executed",
    })),
  };
}

function unique(records, field) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record[field])) return { category: "corpus-identity-duplicate", object: record[field], field };
    seen.add(record[field]);
  }
}

function validateIdentities(corpus) {
  return unique(corpus.rules.rules, "ruleId") ?? unique(corpus.cases, "caseId") ?? unique(corpus.sources, "sourceId")
    ?? unique(corpus.catalog.identities.map((entry) => ({ id: `${entry.kind}:${entry.id}` })), "id")
    ?? unique(corpus.catalog.specRevisions, "id") ?? unique(corpus.catalog.corpusRevisions, "id");
}

function validateRevisions(corpus) {
  const mismatch = (identity, field) => ({ category: "corpus-revision-mismatch", object: identity, field });
  const spec = new Set(corpus.catalog.specRevisions.map((revision) => revision.id));
  const revisions = new Set(corpus.catalog.corpusRevisions.map((revision) => revision.id));
  if (corpus.rules.languageBaseline !== "TypeScript 7.0.2") return mismatch("rules", "languageBaseline");
  if (!spec.has(corpus.rules.specId)) return mismatch("rules", "specId");
  if (!revisions.has(corpus.catalog.corpusId)) return mismatch("catalog", "corpusId");
  if (corpus.support.specId !== corpus.rules.specId) return mismatch("support", "specId");
  for (const record of corpus.cases) {
    if (record.specId !== corpus.rules.specId) return mismatch(record.caseId, "specId");
    if (record.corpusId !== corpus.catalog.corpusId) return mismatch(record.caseId, "corpusId");
  }
  for (const entry of corpus.catalog.identities) {
    const history = (entry.kind === "case" ? corpus.catalog.corpusRevisions : corpus.catalog.specRevisions).map((revision) => revision.id);
    const current = history.indexOf(entry.kind === "case" ? corpus.catalog.corpusId : corpus.rules.specId);
    const introduced = history.indexOf(entry.introducedIn);
    const retired = history.indexOf(entry.retiredIn);
    if (introduced < 0 || introduced > current) return mismatch(`${entry.kind}:${entry.id}`, "introducedIn");
    if (entry.status === "retired" && (retired < introduced || retired > current)) return mismatch(`${entry.kind}:${entry.id}`, "retiredIn");
  }
}

function references(values, targets, identity, field) {
  if (values.some((id) => !targets.has(id))) return { category: "corpus-reference-missing", object: identity, field };
}

function validateLifecycle(corpus) {
  const entries = new Map(corpus.catalog.identities.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  for (const entry of corpus.catalog.identities) {
    if (entry.status !== "active") continue;
    const collection = entry.kind === "rule" ? corpus.rules.rules : entry.kind === "case" ? corpus.cases : null;
    if (collection && !collection.some((record) => record[`${entry.kind}Id`] === entry.id)) {
      return { category: "corpus-reference-missing", object: `${entry.kind}:${entry.id}`, field: "id" };
    }
  }
  const active = (kind, ids, identity, field) => {
    for (const id of ids) {
      const entry = entries.get(`${kind}:${id}`);
      if (!entry) return { category: "corpus-reference-missing", object: identity, field };
      if (entry.status === "retired") return { category: "corpus-identity-retired", object: identity, field };
    }
  };
  for (const record of corpus.cases) {
    const error = active("case", [record.caseId], record.caseId, "caseId")
      ?? active("rule", record.ruleIds, record.caseId, "ruleIds");
    if (error) return error;
  }
  for (const rule of corpus.rules.rules) {
    const error = active("rule", [rule.ruleId], rule.ruleId, "ruleId")
      ?? active("case", rule.caseIds, rule.ruleId, "caseIds")
      ?? active("diagnostic", rule.diagnosticCodes, rule.ruleId, "diagnosticCodes")
      ?? active("trap", rule.trapCodes, rule.ruleId, "trapCodes");
    if (error) return error;
  }
}

function validateReferences(corpus) {
  const rules = new Set(corpus.rules.rules.map((rule) => rule.ruleId));
  const cases = new Set(corpus.cases.map((record) => record.caseId));
  const sources = new Set(corpus.sources.map((source) => source.sourceId));
  const capabilities = new Set(corpus.support.capabilities.map((record) => record.capability));
  for (const record of corpus.cases) {
    const error = references(record.ruleIds, rules, record.caseId, "ruleIds")
      ?? references([record.sourceId], sources, record.caseId, "sourceId")
      ?? references(record.capabilities, capabilities, record.caseId, "capabilities");
    if (error) return error;
  }
  for (const rule of corpus.rules.rules) {
    const error = references(rule.caseIds, cases, rule.ruleId, "caseIds")
      ?? references([rule.capability], capabilities, rule.ruleId, "capability");
    if (error) return error;
  }
}

const text = (value) => typeof value === "string" && value.trim().length > 0;
const logicalId = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(value);
const logicalSource = (value) => typeof value === "string" && value.split("/").every(logicalId);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const records = (value) => Array.isArray(value) && value.length > 0;
const nonemptyTextArray = (value) => records(value) && value.every(text);
const textArray = (value) => Array.isArray(value) && value.every(text);
const version = (value) => value === "2";
const natural = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const positive = (value) => natural(value) && value !== "0";
const scalarType = (value) => value === "i32" || value === "bool";

/** @typedef {{type: "i32", value: string} | {type: "bool", value: boolean}} Scalar */
function scalar(value) {
  if (!object(value)) return false;
  if (value.type === "bool") return typeof value.value === "boolean";
  if (value.type !== "i32" || typeof value.value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value.value)) return false;
  const integer = BigInt(value.value);
  return integer >= -2147483648n && integer <= 2147483647n;
}

function fields(record, identity, requirements) {
  for (const [field, accepts] of Object.entries(requirements)) {
    const value = field.split(".").reduce((parent, key) => parent?.[key], record);
    if (!accepts(value)) return {
      category: field === "schemaVersion" && value !== undefined ? "corpus-version-unsupported" : "corpus-record-invalid",
      object: identity, field,
    };
  }
}

function validateRecords(corpus) {
  let error = fields(corpus, "corpus", { rules: object, support: object, cases: records, sources: records, catalog: object });
  if (error) return error;
  error = fields(corpus.rules, "rules", { schemaVersion: version, specId: text, languageBaseline: text, rules: records })
    ?? fields(corpus.support, "support", { schemaVersion: version, specId: text, capabilities: records })
    ?? fields(corpus.catalog, "catalog", {
      schemaVersion: version, corpusId: text, specRevisions: records, corpusRevisions: records, identities: records,
    });
  if (error) return error;
  for (const section of ["specRevisions", "corpusRevisions"]) {
    for (const [index, revision] of corpus.catalog[section].entries()) {
      error = fields(revision, `catalog.${section}[${index}]`, { id: text, change: text });
      if (error) return error;
    }
  }
  for (const [index, entry] of corpus.catalog.identities.entries()) {
    error = fields(entry, `catalog.identities[${index}]`, {
      kind: (value) => ["rule", "case", "diagnostic", "trap"].includes(value), id: text, meaning: text,
      status: (value) => value === "active" || value === "retired", introducedIn: text,
    });
    if (error) return error;
    if (entry.status === "retired") {
      error = fields(entry, `${entry.kind}:${entry.id}`, { retiredIn: text, reason: text });
      if (error) return error;
    } else if (entry.retiredIn !== undefined || entry.reason !== undefined) {
      return { category: "corpus-record-invalid", object: `${entry.kind}:${entry.id}`, field: entry.retiredIn !== undefined ? "retiredIn" : "reason" };
    }
  }
  for (const [index, rule] of corpus.rules.rules.entries()) {
    error = fields(rule, rule?.ruleId || `rules[${index}]`, {
      ruleId: text, caseIds: textArray, requirement: text, semanticSource: text, basis: text, rationale: text,
      capability: text, target: text, mode: text, positive: text, negativeNotApplicable: text,
      diagnosticCodes: textArray, trapCodes: textArray,
    });
    if (error) return error;
  }
  for (const [index, capability] of corpus.support.capabilities.entries()) {
    error = fields(capability, capability?.capability || `support[${index}]`, {
      capability: text, semanticSource: text, productBoundary: text, implementation: text, target: text, mode: text,
    });
    if (error) return error;
  }
  for (const [index, source] of corpus.sources.entries()) {
    error = fields(source, source?.sourceId || `sources[${index}]`, { sourceId: logicalSource, content: (value) => typeof value === "string" });
    if (error) return error;
  }
  for (const [index, record] of corpus.cases.entries()) {
    error = fields(record, record?.caseId || `cases[${index}]`, {
      schemaVersion: version, specId: text, corpusId: text, caseId: logicalId, sourceId: logicalSource,
      ruleIds: nonemptyTextArray, capabilities: nonemptyTextArray, target: text, mode: text, applicability: text,
      budgets: object, invocation: object, oracle: object, "oracle.basis": object,
      "budgets.semanticFuel": natural, "budgets.activeDepth": positive,
      "budgets.physicalInstructions": positive, "budgets.memoryBytes": positive, "budgets.hostTimeMs": positive,
      "invocation.entry": text, "invocation.arguments": (value) => Array.isArray(value) && value.every(scalar),
      "invocation.returnType": scalarType, "oracle.kind": (value) => value === "return",
      "oracle.value": (value) => scalar(value) && value.type === record.invocation.returnType,
      "oracle.basis.kind": (value) => value === "mathematical-derivation" || value === "manual-derivation",
      "oracle.basis.reference": text, "oracle.basis.derivation": text,
    });
    if (error) return error;
  }
}
