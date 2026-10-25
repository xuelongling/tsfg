// SPDX-License-Identifier: MIT
// Token guards consume the complete owned syntax, without a second checker or
// name resolver. Unrepresented source tokens cannot disappear from a program.
import {identifierName} from './module-facts.mjs';
import {sourceRange} from './typed-array-schema.mjs';
import {commonCheck as check,commonSame as same} from './common-program-common.mjs';

export function commonSourceGrammar(source,spend) {
  const text=source.content,tokens=[];
  // Type-context closing angles are individual tokens (ReadSpan<i32>=...);
  // sequence() joins operator punctuation only where an owned operator says so.
  const pattern=/\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*|\s+|"(?:\\[^\r\n\u2028\u2029]|[^"\\\r\n\u2028\u2029])*"|'(?:\\[^\r\n\u2028\u2029]|[^'\\\r\n\u2028\u2029])*'|(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[$_\p{ID_Start}])(?:\\u(?:\{[0-9a-fA-F]{1,6}\}|[0-9a-fA-F]{4})|[$\u200c\u200d\p{ID_Continue}])*|(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9_]+)?)|===|!==|&&=|\|\|=|\?\?=|=>|&&|\|\||\?\?|\+\+|--|[+*\/%&|^\-]=|[^\s]/guy;
  let position=0;
  while(position<text.length) {
    spend();pattern.lastIndex=position;const match=pattern.exec(text);check(match&&match.index===position,'source');
    position=pattern.lastIndex;if(/^\s|^\/\*|^\/\//u.test(match[0]))continue;
    check(tokens.length<50000,'limit');tokens.push({text:match[0],start:match.index,end:position});
  }
  function lower(position) {let left=0,right=tokens.length;while(left<right){spend();const middle=(left+right)>>>1;
    if(tokens[middle].start<position)left=middle+1;else right=middle;}return left;}
  function indices(range) {
    sourceRange(range,text);const first=lower(range.start),end=lower(range.end);
    check(first<end&&tokens[first].start===range.start&&tokens[end-1].end===range.end,'source');return {first,end};
  }
  function sequence(range,pieces,semicolon=false) {
    const bounds=indices(range);let cursor=bounds.first;
    for(const piece of pieces) {
      spend();if(typeof piece==='string'){let actual='';do{spend();actual+=tokens[cursor++]?.text??'';check(piece.startsWith(actual),'source');}while(actual!==piece);continue;}
      const selected=indices(piece);check(selected.first===cursor,'source');cursor=selected.end;
    }
    if(semicolon&&tokens[cursor]?.text===';')cursor++;
    check(cursor===bounds.end,'source');
  }
  const spelling=range=>{const {first,end}=indices(range);spend(end-first);return tokens.slice(first,end).map(t=>t.text);};
  const name=(range,expected)=>{indices(range);check(identifierName(text.slice(range.start,range.end))===expected,'source');};
  function body(range,rows) {
    const pieces=['{',...rows.map(row=>row.range),'}'];sequence(range,pieces);
  }
  function complete(segments) {
    let cursor=0;
    for(const segment of [...segments].sort((a,b)=>a.start-b.start)) {
      spend();const selected=indices(segment);check(selected.first===cursor,'source','unrepresented or overlapping top-level declaration');cursor=selected.end;
      while(tokens[cursor]?.text===';')cursor++;
    }
    check(cursor===tokens.length,'source','complete source declaration coverage differs');
  }
  return {source,text,tokens,indices,sequence,spelling,name,body,complete,
    slice:range=>text.slice(range.start,range.end)};
}

export function commonTypeSyntax(grammar,range,typeId,types,spend) {
  const tokens=grammar.spelling(range);let cursor=0;
  const take=text=>check(tokens[cursor++]===text,'source','concrete type annotation differs');
  function parse(depth=0) {
    spend();check(depth<=32,'limit');let result;
    if(tokens[cursor]==='('){cursor++;result=union(depth+1);take(')');}
    else {
      const name=tokens[cursor++];check(typeof name==='string','source');
      if(['Array','ReadSpan'].includes(name)&&tokens[cursor]==='<') {
        cursor++;const element=union(depth+1);take('>');result={kind:name==='Array'?'array':'readSpan',element};
      }else result={name:identifierName(name)};
    }
    while(tokens[cursor]==='['){cursor++;take(']');result={kind:'array',element:result};}return result;
  }
  function union(depth) {const members=[parse(depth)];while(tokens[cursor]==='|'){cursor++;members.push(parse(depth));}
    return members.length===1?members[0]:{kind:'union',members};}
  function matches(node,id) {
    spend();const type=types.get(id);check(type,'type');
    if(type.kind==='union')return node.kind==='union'&&node.members.length===type.members.length
      &&type.members.every(member=>node.members.some(child=>matches(child,member)));
    if(['array','readSpan'].includes(type.kind))return node.kind===type.kind&&matches(node.element,type.elementType);
    const name=type.name??(['reference','value'].includes(type.kind)?type.nominalKey.declarationPath.at(-1):type.kind);
    return node.name===name;
  }
  check(matches(union(0),typeId)&&cursor===tokens.length,'source','annotation does not name its concrete type');
}

export function commonSourceAccess(grammar,range,nameRange,access) {
  const prefix=grammar.tokens.slice(grammar.indices(range).first,grammar.indices(nameRange).first).map(t=>t.text);
  const modifiers=prefix.filter(token=>['public','private','protected'].includes(token));
  check(modifiers.length<=1&&(modifiers[0]??'public')===access,'permission');
}
