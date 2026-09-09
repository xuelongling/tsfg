// SPDX-License-Identifier: MIT

/**
 * Validate Conformance Corpus records. Source text is opaque data, never executed.
 * This development boundary currently reports no real language execution.
 */
export function validateCorpus(corpus) {
  const error = validateRecords(corpus) ?? validateIdentities(corpus) ?? validateRevisions(corpus)
    ?? validateLifecycle(corpus) ?? validateReferences(corpus) ?? validateDiagnostics(corpus) ?? validateCoverage(corpus);
  if (error) return {
    schemaVersion: "5", recordValidation: "invalid", errors: [error],
    languageValidation: "not-executed", realProductPasses: 0,
  };
  return {
    schemaVersion: "5",
    recordValidation: "valid",
    languageValidation: "not-executed",
    realProductPasses: 0,
    coverage: coverageReport(corpus),
    rules: structuredClone(corpus.rules.rules),
    capabilities: corpus.support.capabilities.map((capability) => ({ ...structuredClone(capability),
      recordValidation: "valid", languageValidation: "not-executed", currentSupport: "not-verified" })),
    identity: {
      languageBaseline: corpus.rules.languageBaseline, frontendIntake: "not-connected",
      specId: corpus.rules.specId, corpusId: corpus.catalog.corpusId,
    },
    catalog: structuredClone(corpus.catalog),
    cases: corpus.cases.map(({ specId, corpusId, caseId, sourceId, ruleIds, capabilities, target, mode, invocation, oracle, dataLayout }) => ({
      specId, corpusId, caseId, sourceId, ruleIds: [...ruleIds], capabilities: [...capabilities],
      target, mode, languageValidation: "not-executed",
      invocation: structuredClone(invocation), oracle: normalizedOracle(oracle),
      ...(dataLayout === undefined ? {} : { dataLayout: structuredClone(dataLayout) }),
    })),
  };
}

function coverageReport(corpus) {
  const gaps = [];
  const notApplicable = [];
  const obligations = [];
  const unassessedRuleIds = corpus.rules.rules.filter((rule) => !rule.coverage).map((rule) => rule.ruleId);
  const pending = corpus.rules.rules.filter((rule) => rule.pending).map((rule) => ({
    ruleId: rule.ruleId, ...structuredClone(rule.pending), specification: "incomplete", languageValidation: "not-executed",
  }));
  for (const rule of corpus.rules.rules) {
    if (!rule.coverage) continue;
    for (const obligation of rule.coverage.obligations) {
      const oracleKind = obligation.oracleKind ?? (obligation.kind === "negative" ? "diagnostics" : "return");
      const row = { ruleId: rule.ruleId, obligationId: obligation.id, stage: rule.coverage.stage,
        kind: obligation.kind, requirement: obligation.requirement, target: rule.target, mode: rule.mode,
        ...(obligation.applicability === "required" ? { oracleKind } : {}),
        ...(obligation.budgets ? { budgets: structuredClone(obligation.budgets) } : {}) };
      if (obligation.applicability === "not-applicable") {
        notApplicable.push({ ...row, reason: obligation.reason });
        continue;
      }
      const caseIds = corpus.cases.filter((record) => record.ruleIds.includes(rule.ruleId)
        && rule.caseIds.includes(record.caseId) && record.capabilities.includes(rule.capability)
        && corpus.support.capabilities.some((capability) => capability.capability === rule.capability
          && capability.target === record.target && capability.mode === record.mode)
        && record.target === rule.target && record.mode === rule.mode
        && record.applicability === obligation.kind
        && Object.entries(obligation.budgets ?? {}).every(([key, value]) => record.budgets[key] === value)
        && record.oracle.kind === oracleKind
        && (obligation.kind !== "negative" || oracleKind !== "diagnostics"
          || record.oracle.diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.ruleIds.includes(rule.ruleId)))
        && record.coverage?.includes(obligation.id)).map((record) => record.caseId);
      obligations.push({ ...row, caseIds, status: caseIds.length ? "covered" : "missing" });
      if (!caseIds.length) gaps.push({ ...row, category: "corpus-coverage-missing" });
    }
  }
  return { initial: unassessedRuleIds.length || !obligations.some((row) => row.stage === "W1") ? "not-assessed"
    : gaps.some((gap) => gap.stage === "W1") || corpus.rules.rules.some((rule) => rule.coverage.stage === "W1" && rule.pending)
      ? "incomplete" : "complete",
    milestone: "incomplete",
    stages: ["W1", "W3", "W4", "W5", "W6"].map((stage) => ({ stage,
      ruleIds: corpus.rules.rules.filter((rule) => rule.coverage?.stage === stage).map((rule) => rule.ruleId),
      coverage: gaps.some((gap) => gap.stage === stage) ? "incomplete"
        : obligations.some((row) => row.stage === stage) ? "complete" : "not-assessed",
      languageValidation: "not-executed",
    })),
    gaps, notApplicable, obligations, pending, unassessedRuleIds };
}

function validateCoverage(corpus) {
  const semanticSource = (value) => ["inherited-baseline", "necessary-difference", "pending-special-mapping"].includes(value);
  const duplicateCapability = unique(corpus.support.capabilities, "capability");
  if (duplicateCapability) return duplicateCapability;
  for (const capability of corpus.support.capabilities) {
    const error = fields(capability, capability.capability, {
      semanticSource, productBoundary: (value) => ["allowed", "prohibited"].includes(value),
      implementation: (value) => ["not-connected", "not-implemented", "implemented"].includes(value),
      evidence: (value) => capability.implementation !== "implemented" || text(value),
    });
    if (error) return error;
  }
  for (const rule of corpus.rules.rules) {
    const sourceError = fields(rule, rule.ruleId, { semanticSource });
    if (sourceError) return sourceError;
    if (rule.semanticSource === "pending-special-mapping" || rule.pending !== undefined) {
      const error = fields(rule.pending, rule.ruleId, { consumers: nonemptyTextArray, missing: nonemptyTextArray,
        affectedCapabilities: nonemptyTextArray, consumptionStage: text, closure: text });
      if (error) return error;
      const reference = references(rule.pending.affectedCapabilities,
        new Set(corpus.support.capabilities.map((entry) => entry.capability)), rule.ruleId, "pending.affectedCapabilities");
      if (reference) return reference;
    }
    if (rule.coverage === undefined) continue;
    const error = fields(rule.coverage, rule.ruleId, {
      stage: (value) => ["W1", "W3", "W4", "W5", "W6"].includes(value), obligations: records,
    });
    if (error) return error;
    for (const obligation of rule.coverage.obligations) {
      const error = fields(obligation, rule.ruleId, {
        id: logicalId, kind: (value) => ["positive", "negative", "boundary"].includes(value), requirement: text,
        applicability: (value) => ["required", "not-applicable"].includes(value),
        oracleKind: (value) => value === undefined || ["return", "diagnostics", "trap", "execution-abort"].includes(value),
        reason: (value) => obligation.applicability === "not-applicable"
          ? obligation.kind === "negative" && text(value) : value === undefined,
        budgets: (value) => value === undefined || (object(value) && Object.keys(value).length > 0
          && Object.entries(value).every(([key, limit]) => Object.hasOwn(budgetPredicates, key) && budgetPredicates[key](limit))),
      });
      if (error) return error;
    }
    const duplicate = unique(rule.coverage.obligations, "id");
    if (duplicate) return { ...duplicate, object: rule.ruleId, field: "coverage.obligations.id" };
    if (!["positive", "negative"].every((kind) => rule.coverage.obligations.some((entry) => entry.kind === kind))) {
      return { category: "corpus-record-invalid", object: rule.ruleId, field: "coverage.obligations" };
    }
  }
  for (const record of corpus.cases) {
    if (record.coverage !== undefined && !textArray(record.coverage)) {
      return { category: "corpus-record-invalid", object: record.caseId, field: "coverage" };
    }
    if (record.coverage?.some((id) => !corpus.rules.rules.some((rule) => record.ruleIds.includes(rule.ruleId)
      && rule.coverage?.obligations.some((entry) => entry.id === id && entry.applicability === "required")))) {
      return { category: "corpus-reference-missing", object: record.caseId, field: "coverage" };
    }
  }
}

function normalizedOracle(oracle) {
  const result = structuredClone(oracle);
  if (result.kind === "diagnostics") {
    result.diagnostics = result.diagnostics.map(({ message, ...diagnostic }) => ({
      ...diagnostic, ruleIds: [...new Set(diagnostic.ruleIds)].sort(compare),
    })).sort((left, right) => {
      const key = (diagnostic) => [diagnostic.primary.sourceId, diagnostic.primary.start, diagnostic.code,
        diagnostic.primary.end, diagnostic.phase, diagnostic.severity, ...diagnostic.ruleIds];
      const a = key(left);
      const b = key(right);
      for (let index = 0; index < Math.min(a.length, b.length); index++) {
        const order = compare(a[index], b[index]);
        if (order) return order;
      }
      return a.length - b.length;
    });
  }
  return result;
}

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function validateDiagnostics(corpus) {
  const sources = new Map(corpus.sources.map((source) => [source.sourceId, source.content]));
  const rules = new Map(corpus.rules.rules.map((rule) => [rule.ruleId, rule]));
  const codes = new Map(corpus.catalog.identities.filter((entry) => entry.kind === "diagnostic").map((entry) => [entry.id, entry]));
  for (const record of corpus.cases) {
    if (record.oracle.kind !== "diagnostics") continue;
    for (const [index, diagnostic] of record.oracle.diagnostics.entries()) {
      const code = codes.get(diagnostic.code);
      if (!code || code.status === "retired") return {
        category: code ? "corpus-identity-retired" : "corpus-reference-missing", object: record.caseId,
        field: `oracle.diagnostics[${index}].code`,
      };
      if (diagnostic.ruleIds.some((id) => !record.ruleIds.includes(id) || !rules.get(id)?.diagnosticCodes.includes(diagnostic.code))) {
        return { category: "corpus-reference-missing", object: record.caseId, field: `oracle.diagnostics[${index}].ruleIds` };
      }
      const field = `oracle.diagnostics[${index}].primary`;
      const source = sources.get(diagnostic.primary.sourceId);
      if (source === undefined) return { category: "corpus-reference-missing", object: record.caseId, field: `${field}.sourceId` };
      const span = diagnostic.primary;
      if (![span.start, span.end, span.startLine, span.startColumn, span.endLine, span.endColumn]
        .every((value) => Number.isSafeInteger(value) && value >= 0)
        || span.start > span.end || span.end > source.length
        || !matchesPosition(source, span.start, span.startLine, span.startColumn)
        || !matchesPosition(source, span.end, span.endLine, span.endColumn)) {
        return { category: "corpus-source-range-invalid", object: record.caseId, field };
      }
    }
  }
}

function matchesPosition(source, offset, line, column) {
  let currentLine = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    if (source[index] === "\n" || (source[index] === "\r" && source[index + 1] !== "\n")
      || source[index] === "\u2028" || source[index] === "\u2029") {
      currentLine++;
      lineStart = index + 1;
    }
  }
  return line === currentLine && column === offset - lineStart;
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
const version = (value) => value === "5";
const natural = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const positive = (value) => natural(value) && value !== "0";
const budgetPredicates = { semanticFuel: natural, activeDepth: positive, physicalInstructions: positive,
  memoryBytes: positive, hostTimeMs: positive };
const integerWidths = new Map([["i8", 8], ["u8", 8], ["i16", 16], ["u16", 16], ["i32", 32], ["u32", 32], ["i64", 64], ["u64", 64]]);
const floatDigits = new Map([["f16", 4], ["f32", 8], ["f64", 16]]);
const canonicalType = (value) => value === "boolean" ? "bool" : value === "number" ? "f64" : value;
const targetInteger = (value) => value === "isize" || value === "usize";
const scalarType = (value) => integerWidths.has(value) || targetInteger(value) || floatDigits.has(canonicalType(value)) || canonicalType(value) === "bool";

function scalar(value, dataLayout) {
  if (!object(value)) return false;
  const type = canonicalType(value.type);
  const representation = floatDigits.has(type) ? "bits" : "value";
  if (Object.keys(value).some((key) => key !== "type" && key !== representation)) return false;
  if (type === "bool") return typeof value.value === "boolean";
  if (floatDigits.has(type)) return typeof value.bits === "string"
    && value.bits.length === floatDigits.get(type) && /^[0-9a-fA-F]+$/.test(value.bits);
  const width = targetInteger(type) ? Number(dataLayout.pointerSizeBits) : integerWidths.get(type);
  if (!width || typeof value.value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value.value)) return false;
  const integer = BigInt(value.value);
  const signed = value.type.startsWith("i");
  const limit = 1n << BigInt(width - (signed ? 1 : 0));
  return integer >= (signed ? -limit : 0n) && integer < limit;
}

function layoutForCase(record) {
  const needed = targetInteger(record.invocation?.returnType) || targetInteger(record.oracle?.value?.type)
    || (Array.isArray(record.invocation?.arguments) && record.invocation.arguments.some((value) => targetInteger(value?.type)));
  if (!needed && record.dataLayout === undefined) return true;
  return object(record.dataLayout) && record.dataLayout.target === record.target
    && ["8", "16", "32", "64"].includes(record.dataLayout.pointerSizeBits);
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
      dataLayout: () => layoutForCase(record),
      ...Object.fromEntries(Object.entries(budgetPredicates).map(([key, predicate]) => [`budgets.${key}`, predicate])),
      "invocation.entry": text, "invocation.arguments": (value) => Array.isArray(value) && value.every((item) => scalar(item, record.dataLayout)),
      "invocation.returnType": scalarType, "oracle.kind": (value) => value === "return" || value === "diagnostics",
      "oracle.value": (value) => record.oracle.kind === "diagnostics" ? value === undefined : (scalar(value, record.dataLayout) && canonicalType(value.type) === canonicalType(record.invocation.returnType)),
      "oracle.diagnostics": (value) => record.oracle.kind === "diagnostics" ? records(value) : value === undefined,
      "oracle.basis.kind": (value) => value === "mathematical-derivation" || value === "manual-derivation",
      "oracle.basis.reference": text, "oracle.basis.derivation": text,
    });
    if (error) return error;
    if (record.oracle.kind === "diagnostics") {
      for (const [index, diagnostic] of record.oracle.diagnostics.entries()) {
        error = fields(diagnostic, `${record.caseId}.oracle.diagnostics[${index}]`, {
          phase: text, severity: (value) => ["error", "warning", "info", "hint"].includes(value),
          code: text, ruleIds: nonemptyTextArray, primary: object,
          message: (value) => value === undefined || typeof value === "string",
          fields: () => Object.keys(diagnostic).every((key) => ["phase", "severity", "code", "ruleIds", "primary", "message"].includes(key)),
          "primary.fields": () => Object.keys(diagnostic.primary).every((key) => ["sourceId", "start", "end", "startLine", "startColumn", "endLine", "endColumn"].includes(key)),
        });
        if (error) return error;
      }
    }
  }
}
