// SPDX-License-Identifier: MIT
import path from "node:path";
import {canonical,sha256} from "./identity.mjs";
import entries from "../contracts/conversion-entries.json" with { type: "json" };
import bytecodeSchema from "../contracts/bytecode.schema.json" with { type: "json" };

export const conversionDeclaration = entries;
export const conversionEntries = new Map(entries.entries.map(entry => [entry.id, entry]));
export function verifyConversionOrigin(origin, inputIdentity) {
  if (!origin || Object.keys(origin).sort().join(",") !== "brandRefs,declarationPath,declarationRange,declarationSha256,entryId,inputIdentity,version"
      || !/^sha256:[0-9a-f]{64}$/.test(origin.inputIdentity) || origin.inputIdentity !== inputIdentity) return false;
  const entry = conversionEntries.get(origin.entryId);
  const expectedBrands=entry ? [["source",entry.from],["target",entry.to]].filter(([,nominal])=>nominal!=="f64").map(([role,nominal])=>({role,nominal,range:entries.brands[nominal]})) : null;
  return !!entry && canonical(origin.brandRefs) === canonical(expectedBrands) && origin.version === entries.version && origin.declarationSha256 === entries.sha256
    && Object.keys(origin.declarationRange ?? {}).sort().join(",") === "end,start"
    && origin.declarationRange.start === entry.start && origin.declarationRange.end === entry.end
    && typeof origin.declarationPath === "string"
    && origin.declarationPath.startsWith("/") && path.posix.normalize(origin.declarationPath) === origin.declarationPath
    && path.posix.basename(origin.declarationPath) === entries.file;
}
export function conversionCallSpelling(source, range, operandRange, entry) {
  const trivia = text => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, comment => " ".repeat(comment.length)).trim();
  const prefix = trivia(source.slice(range.start, operandRange.start));
  const decoded = prefix.replace(/\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g,
    (_, point, unit) => String.fromCodePoint(Number.parseInt(point ?? unit, 16)));
  return decoded.endsWith("(") && decoded.slice(0, -1).trim() === entry.name
    && /^,?\s*\)$/.test(trivia(source.slice(operandRange.end, range.end)));
}

export function completeFunctionSource(source, functions, decodeName) {
  if (typeof source !== 'string' || !Array.isArray(functions) || functions.length < 1) return false;
  const trivia = text => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*/g, token => ' '.repeat(token.length));
  let end = 0;
  for (const fn of functions) {
    const range = fn?.range;
    if (!Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end)
        || range.start < end || range.end <= range.start || range.end > source.length
        || trivia(source.slice(end, range.start)).trim() !== '') return false;
    const text = trivia(source.slice(range.start, range.end));
    const header = text.match(/^\s*(?:export\s+)?function\s+([^()]+)\(/);
    try { if (!header || decodeName(header[1]) !== fn.name) return false; } catch { return false; }
    // Comments and braced Unicode identifier escapes must not be braces in
    // the body. Replacement retains UTF16 offsets; no token or AST rewrite.
    const braces = text.replace(/\\u\{[0-9a-fA-F]{1,6}\}/g, token => ' '.repeat(token.length));
    let depth = 0, opened = false, closed = -1;
    for (let index = 0; index < braces.length; index++) {
      if (braces[index] === '{') { depth++; opened = true; }
      if (braces[index] === '}') { if (!opened || --depth < 0) return false; if (depth === 0) { closed = index; break; } }
    }
    if (!opened || depth !== 0 || closed !== text.length - 1) return false;
    end = range.end;
  }
  return trivia(source.slice(end)).trim() === '';
}

const declarationFiles = {
  "minimal-bool-v1": "minimal-bool-v1.d.ts", "minimal-scalars-v2": "minimal-scalars-v2.d.ts",
  "minimal-integers-v3": "minimal-integers-v3.d.ts", "minimal-floats-v4": "minimal-floats-v4.d.ts",
  "minimal-conversions-v5": entries.file,
};
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === keys;
const logicalPath = value => typeof value === "string" && value.isWellFormed() && value.startsWith("/")
  && !/[\\:\0]/.test(value) && path.posix.normalize(value) === value
  && value.slice(1).split("/").every(part => part && part !== "." && part !== "..");

// Validate the owned normalized profile independently of the caller's digest.
// An identity binds facts to a scope; it does not authenticate a checker run.
export function admittedInputScope(scope, inputIdentity) {
  try {
    const version = scope?.declarations?.version, numeric = ["minimal-integers-v3", "minimal-floats-v4", entries.version].includes(version);
    if (!declarationFiles[version] || !exactKeys(scope, numeric ? "config,declarations,files,rootFile,sourceRoot,target" : "config,declarations,files,rootFile,sourceRoot")
        || !exactKeys(scope.config, "allowJs,noEmit,strict") || scope.config.allowJs !== false || scope.config.noEmit !== true || scope.config.strict !== true
        || !exactKeys(scope.declarations, "paths,version") || !logicalPath(scope.sourceRoot) || !logicalPath(scope.rootFile)
        || !scope.rootFile.endsWith(".ts") || scope.rootFile.endsWith(".d.ts")
        || (numeric && canonical(scope.target) !== canonical({ ...bytecodeSchema.target, pointerBits: "64" }))
        || !Array.isArray(scope.files) || scope.files.length === 0 || !Array.isArray(scope.declarations.paths) || scope.declarations.paths.length === 0
        || scope.declarations.paths[0] !== `${scope.sourceRoot}/${declarationFiles[version]}`
        || new Set(scope.declarations.paths).size !== scope.declarations.paths.length) return false;
    const files = new Map();
    let previous;
    for (const file of scope.files) {
      if (!exactKeys(file, "content,path") || !logicalPath(file.path) || !file.path.startsWith(`${scope.sourceRoot}/`)
          || typeof file.content !== "string" || !file.content.isWellFormed() || file.content.length > 0xffffffff
          || (file.path !== scope.rootFile && !file.path.endsWith(".d.ts")) || files.has(file.path)
          || (previous !== undefined && Buffer.from(previous).compare(Buffer.from(file.path)) >= 0)) return false;
      files.set(file.path, file.content); previous = file.path;
    }
    return files.has(scope.rootFile) && scope.declarations.paths.every(name => typeof name === "string" && name.endsWith(".d.ts") && files.has(name))
      && sha256(canonical(scope)) === inputIdentity;
  } catch { return false; }
}

export function admittedConversionScope(scope, inputIdentity) {
  if (!admittedInputScope(scope, inputIdentity) || scope.declarations.version !== entries.version) return false;
  const declaration=scope.files.find(file=>file.path===scope.declarations.paths[0]);
  return !!declaration && new Set(scope.files.map(file=>file.path)).size===scope.files.length && declaration.path === `${scope.sourceRoot}/${entries.file}` && sha256(declaration.content)===entries.sha256;
}
