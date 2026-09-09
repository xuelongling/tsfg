// SPDX-License-Identifier: MIT

/**
 * Validate Conformance Corpus records. Source text is opaque data, never executed.
 * This development boundary currently reports no real language execution.
 */
export function validateCorpus(corpus) {
  const error = validateRecords(corpus);
  if (error) return { schemaVersion: "1", recordValidation: "invalid", errors: [error] };
  return {
    schemaVersion: "1",
    recordValidation: "valid",
    languageValidation: "not-executed",
    realProductPasses: 0,
    cases: corpus.cases.map(({ specId, corpusId, caseId, sourceId, ruleIds, capabilities, target, mode }) => ({
      specId, corpusId, caseId, sourceId, ruleIds: [...ruleIds], capabilities: [...capabilities],
      target, mode, languageValidation: "not-executed",
    })),
  };
}

const text = (value) => typeof value === "string" && value.trim().length > 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const records = (value) => Array.isArray(value) && value.length > 0;
const texts = (value) => records(value) && value.every(text);
const strings = (value) => Array.isArray(value) && value.every(text);
const version = (value) => value === "1";
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
    if (!accepts(value)) return { category: "corpus-record-invalid", object: identity, field };
  }
}

function validateRecords(corpus) {
  let error = fields(corpus, "corpus", { rules: object, support: object, cases: records, sources: records });
  if (error) return error;
  error = fields(corpus.rules, "rules", { schemaVersion: version, specId: text, languageBaseline: text, rules: records })
    ?? fields(corpus.support, "support", { schemaVersion: version, specId: text, capabilities: records });
  if (error) return error;
  for (const [index, rule] of corpus.rules.rules.entries()) {
    error = fields(rule, rule?.ruleId || `rules[${index}]`, {
      ruleId: text, requirement: text, semanticSource: text, basis: text, rationale: text,
      capability: text, target: text, mode: text, positive: text, negativeNotApplicable: text,
      diagnosticCodes: strings, trapCodes: strings,
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
    error = fields(source, source?.sourceId || `sources[${index}]`, { sourceId: text, content: (value) => typeof value === "string" });
    if (error) return error;
  }
  for (const [index, record] of corpus.cases.entries()) {
    error = fields(record, record?.caseId || `cases[${index}]`, {
      schemaVersion: version, specId: text, corpusId: text, caseId: text, sourceId: text,
      ruleIds: texts, capabilities: texts, target: text, mode: text, applicability: text,
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
