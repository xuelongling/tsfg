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
  return !!declaration && new Set(scope.files.map(file=>file.path)).size===scope.files.length && declaration.path === `${scope.sourceRoot}/${entries.file}` && sha256(declaration.content)===entries.sha256
    && exclusiveConversionScope(scope,declaration.path);
}

const conversionNames = new Set([
  ...entries.entries.map(entry=>entry.name),
  ...Object.keys(entries.brands).flatMap(name=>[name,`__tsfg_${name}`]), 'f64',
]);

// This is a bounded declaration-name guard, not a TypeScript type checker.
// Cold consumers must not trust rehashed origins when another declaration
// augments the admitted global symbols. References and member/module names
// remain legal. Comments, quoted text and escaped identifiers are lexical data.
function declarationTokens(source) {
  const tokens = [],references=[],types=[];
  for (let index=0;index<source.length;) {
    if (/\s/u.test(source[index])) {index++;continue;}
    if (source.startsWith('//',index)) {
      const start=index;index+=2;while(index<source.length&&!/[\r\n\u2028\u2029]/u.test(source[index]))index++;
      if(tokens.length===0){const reference=source.slice(start,index).match(/^\/\/\/\s*<reference\s+[^>]*\b(path|types)\s*=\s*(['"])(.*?)\2[^>]*\/?\s*>/);if(reference)(reference[1]==='path'?references:types).push(reference[3]);}
      continue;
    }
    if (source.startsWith('/*',index)) {const end=source.indexOf('*/',index+2);if(end<0)return undefined;index=end+2;continue;}
    if ('\"\'`'.includes(source[index])) {
      const quote=source[index++],start=index;let closed=false;
      while(index<source.length){const character=source[index++];if(character==='\\'){index++;continue;}if(character===quote){closed=true;break;}}
      if(!closed)return undefined;
      const text=source.slice(start,index-1).replace(/\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([^\r\n]))/g,(_,point,unit,byte,character)=>point||unit||byte?String.fromCodePoint(Number.parseInt(point??unit??byte,16)):character);
      tokens.push({kind:'text',value:text});continue;
    }
    const identifier=source.slice(index).match(/^(?:[$_\p{ID_Start}]|\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4}))(?:[$\u200c\u200d\p{ID_Continue}]|\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4}))*/u)?.[0];
    if(identifier){tokens.push({kind:'name',value:identifier.replace(/\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g,(_,point,unit)=>String.fromCodePoint(Number.parseInt(point??unit,16)))});index+=identifier.length;}
    else tokens.push({kind:'punctuation',value:source[index++]});
  }
  return {tokens,references,types};
}

function exclusiveConversionScope(scope,officialPath) {
  const files=new Map(scope.files.map(file=>[file.path,file])),loaded=new Set(),pending=[scope.rootFile,...scope.declarations.paths];
  while(pending.length){
    const name=pending.pop();if(loaded.has(name))continue;loaded.add(name);
    const lexical=declarationTokens(files.get(name)?.content??'');if(!lexical)return false;
    if(name!==scope.rootFile&&name!==officialPath&&!exclusiveConversionDeclarations(lexical.tokens))return false;
    for(const reference of lexical.references){const target=path.posix.resolve(path.posix.dirname(name),reference);if(files.has(target))pending.push(target);}
    for(const type of lexical.types){
      const packageName=type.startsWith('@')?type.slice(1).replace('/','__'):type;
      for(let directory=path.posix.dirname(name);;directory=path.posix.dirname(directory)){
        const base=path.posix.join(directory,'node_modules/@types',packageName),target=[base+'.d.ts',base+'/index.d.ts'].find(candidate=>files.has(candidate));
        if(target){pending.push(target);break;}if(directory==='/')break;
      }
    }
    for(let index=0;index<lexical.tokens.length;index++){
      const token=lexical.tokens[index],next=lexical.tokens[index+1];let specifier;
      if(token.kind==='name'&&token.value==='from'&&next?.kind==='text')specifier=next.value;
      if(token.kind==='name'&&token.value==='import'){
        if(next?.kind==='text')specifier=next.value;
        else if(next?.value==='('&&lexical.tokens[index+2]?.kind==='text')specifier=lexical.tokens[index+2].value;
      }
      if(token.kind==='name'&&token.value==='require'&&next?.value==='('&&lexical.tokens[index+2]?.kind==='text')specifier=lexical.tokens[index+2].value;
      if(specifier===undefined)continue;
      const relative=specifier.startsWith('.')||specifier.startsWith('/');
      for(let directory=path.posix.dirname(name);;directory=path.posix.dirname(directory)){
        const packageName=specifier.startsWith('@')?specifier.slice(1).replace('/','__'):specifier;
        const bases=relative?[path.posix.resolve(directory,specifier)]:[path.posix.join(directory,'node_modules',specifier),path.posix.join(directory,'node_modules/@types',packageName)];
        const target=bases.flatMap(base=>[base,base.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/,'')+'.d.ts',base+'/index.d.ts']).find(candidate=>files.has(candidate));
        if(target){pending.push(target);break;}if(relative||directory==='/')break;
      }
    }
  }
  return true;
}

function exclusiveConversionDeclarations(tokens) {
  let depth=0,external=false;
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index];
    if(depth===0&&token.kind==='name'&&(token.value==='export'||token.value==='import'&&tokens[index+1]?.value!=='('))external=true;
    if(token.value==='{')depth++;if(token.value==='}')depth--;
  }
  const scopes=[!external],declarationKinds=new Set(['function','class','interface','type','enum','namespace','module']);
  const bindingCollision = start => {
    const token=tokens[start];
    if(token?.kind==='name')return {end:start+1,collision:conversionNames.has(token.value)};
    if(!['{','['].includes(token?.value))return {end:start+1,collision:false};
    const object=token.value==='{',close=object?'}':']';let cursor=start+1;
    while(cursor<tokens.length&&tokens[cursor].value!==close){
      if([',','.'].includes(tokens[cursor].value)){cursor++;continue;}
      if(object&&tokens[cursor+1]?.value===':')cursor+=2;
      const binding=bindingCollision(cursor);if(binding.collision)return binding;cursor=binding.end;
      // Defaults do not introduce bindings. Skip their expression through the
      // next pattern separator, retaining balanced nested punctuation.
      if(tokens[cursor]?.value==='='){
        let nesting=0;cursor++;
        while(cursor<tokens.length){const value=tokens[cursor].value;
          if(nesting===0&&(value===','||value===close))break;
          if(['(','[','{'].includes(value))nesting++;
          if([')',']','}'].includes(value))nesting--;cursor++;
        }
      }
    }
    return {end:cursor+1,collision:false};
  };
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index],next=tokens[index+1];
    if(token.value==='{'){scopes.push(tokens[index-1]?.value==='global'&&!declarationKinds.has(tokens[index-2]?.value));continue;}
    if(token.value==='}'){if(scopes.length===1)return false;scopes.pop();continue;}
    if(token.value==='export'&&next?.value==='as'&&tokens[index+2]?.value==='namespace'&&conversionNames.has(tokens[index+3]?.value))return false;
    if(!scopes.at(-1)||token.kind!=='name')continue;
    if(declarationKinds.has(token.value)&&next?.kind==='name'&&conversionNames.has(next.value))return false;
    if(['const','let','var'].includes(token.value)){
      // A declaration list may have commas inside types. Only commas at the
      // list's own nesting level introduce another global binding.
      let nesting=0,binding=true;
      for(let cursor=index+1;cursor<tokens.length;cursor++){
        const item=tokens[cursor];
        if(nesting===0&&(item.value===';'||item.value==='}'))break;
        if(binding){if(bindingCollision(cursor).collision)return false;binding=false;}
        if(['(','[','{','<'].includes(item.value))nesting++;
        if([')',']','}','>'].includes(item.value)&&nesting>0)nesting--;
        if(nesting===0&&item.value===',')binding=true;
      }
    }
  }
  return scopes.length===1;
}
