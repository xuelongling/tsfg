// SPDX-License-Identifier: MIT
import path from "node:path";
import {canonical,sha256} from "./identity.mjs";
import entries from "../contracts/conversion-entries.json" with { type: "json" };

export const conversionDeclaration = entries;
export const conversionEntries = new Map(entries.entries.map(entry => [entry.id, entry]));
export function verifyConversionOrigin(origin) {
  if (!origin || Object.keys(origin).sort().join(",") !== "brandRefs,declarationPath,declarationRange,declarationSha256,entryId,version") return false;
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

export function admittedConversionScope(scope, inputIdentity) {
  if (!scope || sha256(canonical(scope)) !== inputIdentity || scope.declarations?.version !== entries.version || !Array.isArray(scope.declarations.paths) || scope.declarations.paths.length !== 1 || !Array.isArray(scope.files)) return false;
  const declaration=scope.files.find(file=>file.path===scope.declarations.paths[0]);
  return !!declaration && new Set(scope.files.map(file=>file.path)).size===scope.files.length && declaration.path === `${scope.sourceRoot}/${entries.file}` && sha256(declaration.content)===entries.sha256;
}
