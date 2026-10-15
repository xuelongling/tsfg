// SPDX-License-Identifier: MIT
import { canonical, sha256, own } from "./identity.mjs";

export const rootKinds = Object.freeze(["application", "module-initialization", "host-export", "host-callback", "hot-function", "kernel"]);
export const moduleIdentity = sourcePath => sha256(`tsfg.module\0${sourcePath}`);
export const globalIdentity = (sourcePath, name, type) => sha256(`tsfg.global\0${sourcePath}\0${name}\0${type}`);
export const defaultBindingIdentity = (sourcePath, sourceHash, type, range) => sha256(
  `tsfg.default-export-binding.v1\0${sourcePath}\0${sourceHash}\0${moduleIdentity(sourcePath)}\0${type}\0${range.start}\0${range.end}`);
const keys = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...names].sort().join(",");
const order = (a, b) => Buffer.from(a).compare(Buffer.from(b));
const rootKey = root => `${root.kind}\0${root.sourcePath}\0${root.name}`;
const validPath = value => typeof value === "string" && value.startsWith("/") && value.endsWith(".ts")
  && !value.endsWith(".d.ts") && !/[\\:\0]/.test(value)
  && value.slice(1).split("/").every(part => part && part !== "." && part !== "..");

function failure(code, root, definition) {
  const error = new TypeError(`${code}: compilation closure root or dependency differs`);
  Object.assign(error, { code, ruleId: "r01-compilation-closure", phase: "hir",
    primary: { sourceId: root?.sourcePath ?? definition?.sourcePath ?? "",
      start: definition?.range?.start ?? 0, end: definition?.range?.end ?? 0 } });
  throw error;
}

/** Normalize explicit embedding roots; requiredRoots is the embedding contract's subset. */
export function normalizeClosure(value) {
  if (!keys(value, ["roots", "requiredRoots"]) || !Array.isArray(value.roots) || !Array.isArray(value.requiredRoots)
      || value.roots.length < 1 || value.roots.length > 128 || value.requiredRoots.length > 128)
    failure("r03-d-closure-root");
  const normalize = roots => {
    const seen = new Set();
    return roots.map(root => {
      if (!keys(root, ["kind", "sourcePath", "name"]) || !rootKinds.includes(root.kind)
          || !validPath(root.sourcePath) || typeof root.name !== "string" || !root.name || root.name.includes("\0")
          || (root.kind === "module-initialization" && root.name !== "$moduleInit") || seen.has(rootKey(root)))
        failure("r03-d-closure-root", root);
      seen.add(rootKey(root));
      return { ...root };
    }).sort((a, b) => order(rootKey(a), rootKey(b)));
  };
  return own({ roots: normalize(value.roots), requiredRoots: normalize(value.requiredRoots) });
}

/**
 * Analyze only owned, already verified facts. Official checking and complete HIR
 * verification must finish before this function can prune any declaration.
 */
export function compilationClosure({ modules, functions, globals = [], configuration }) {
  const config = normalizeClosure(configuration);
  if (!Array.isArray(modules) || !Array.isArray(functions) || !Array.isArray(globals)) failure("r03-d-closure-dependency");
  const byPath = new Map(), byFunction = new Map(), byName = new Map(), byGlobal = new Map();
  for (const module of modules) {
    if (!validPath(module?.sourcePath) || module.id !== moduleIdentity(module.sourcePath)
        || byPath.has(module.sourcePath) || !Array.isArray(module.dependencies)
        || new Set(module.dependencies).size !== module.dependencies.length)
      failure("r03-d-closure-dependency", null, module);
    byPath.set(module.sourcePath, module);
  }
  for (const fn of functions) {
    const name = `${fn.sourcePath}\0${fn.name}`;
    if (!byPath.has(fn.sourcePath) || byFunction.has(fn.id) || fn.kind !== 'module-initialization' && byName.has(name) || !Array.isArray(fn.body))
      failure("r03-d-closure-dependency", null, fn);
    byFunction.set(fn.id, fn); if(fn.kind !== 'module-initialization') byName.set(name, fn);
  }
  for (const global of globals) {
    if (!byPath.has(global.sourcePath) || byGlobal.has(global.id)) failure("r03-d-closure-dependency", null, global);
    byGlobal.set(global.id, global);
  }
  for (const module of modules) {
    const initializer = byFunction.get(module.initializer);
    if (!initializer || initializer.kind !== "module-initialization" || initializer.sourcePath !== module.sourcePath
        || initializer.name !== "$moduleInit" || module.dependencies.some(path => !byPath.has(path)))
      failure("r03-d-closure-dependency", null, module);
    if (module.exports !== undefined && (!Array.isArray(module.exports)
        || new Set(module.exports.map(binding=>binding.name)).size !== module.exports.length
        || module.exports.some(binding=>!keys(binding,["name","target"])
          || typeof binding.name!=="string" || !binding.name || !byFunction.has(binding.target) && !byGlobal.has(binding.target))))
      failure("r03-d-closure-dependency", null, module);
  }
  const rootDefinition = root => {
    const module=byPath.get(root.sourcePath);
    if (root.kind==="module-initialization") return byFunction.get(module?.initializer);
    const exported=module?.exports?.find(binding=>binding.name===root.name);
    return exported ? byFunction.get(exported.target) : byName.get(`${root.sourcePath}\0${root.name}`);
  };
  const resolved = config.roots.map(root => {
    const definition = rootDefinition(root);
    if (!definition || (root.kind !== "module-initialization" && definition.kind === "module-initialization"))
      failure("r03-d-closure-root", root, definition);
    return { ...root, target: definition.id };
  });
  const rootSet = new Set(config.roots.map(rootKey));
  for (const required of config.requiredRoots) if (!rootSet.has(rootKey(required)))
    failure("r03-d-closure-root", required, rootDefinition(required));

  const retainedFunctions = new Set(), retainedModules = new Set();
  const pending = [];
  const retainModule = sourcePath => {
    if (retainedModules.has(sourcePath)) return;
    const module = byPath.get(sourcePath);
    if (!module) failure("r03-d-closure-dependency", { sourcePath });
    retainedModules.add(sourcePath);
    pending.push(module.initializer);
    for (const dependency of module.dependencies) retainModule(dependency);
  };
  const visit = (value, current) => {
    if (!value || typeof value !== "object") return;
    if (value.kind === "call") {
      if (!byFunction.has(value.target)) failure("r03-d-closure-dependency", null, current);
      pending.push(value.target);
    }
    if (value.kind === "global" || value.kind === "initialize") {
      const global = byGlobal.get(value.global);
      if (!global) failure("r03-d-closure-dependency", null, current);
      retainModule(global.sourcePath);
    }
    for (const nested of Object.values(value)) if (nested && typeof nested === "object") {
      if (Array.isArray(nested)) nested.forEach(item => visit(item, current));
      else visit(nested, current);
    }
  };
  for (const root of resolved) { pending.push(root.target); retainModule(root.sourcePath); }
  while (pending.length) {
    const id = pending.pop();
    if (retainedFunctions.has(id)) continue;
    const fn = byFunction.get(id);
    if (!fn) failure("r03-d-closure-dependency");
    retainedFunctions.add(id); retainModule(fn.sourcePath); visit(fn.body, fn);
  }
  const initialization = [], state = new Map();
  const initialize = path => {
    if (state.has(path)) return; // active static import cycles are legal; TDZ is dynamic.
    state.set(path, "visiting");
    const module = byPath.get(path);
    for (const dependency of module.dependencies) initialize(dependency);
    initialization.push(module.initializer); state.set(path, "visited");
  };
  for (const root of resolved) initialize(root.sourcePath);
  // A call/global edge can add an owner not present in import metadata, for
  // script-global bindings. It still receives initialization before invocation.
  for (const path of [...retainedModules].sort(order)) initialize(path);
  return own({ roots: resolved, requiredRoots: config.requiredRoots,
    modules: [...retainedModules].sort(order).map(path => byPath.get(path).id),
    functions: [...retainedFunctions].sort(order), initialization });
}

export const printClosure = closure => `${canonical(closure)}\n`;
