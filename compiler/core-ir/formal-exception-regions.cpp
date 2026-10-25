// SPDX-License-Identifier: MIT
#include "formal-exception-source.h"
#include <algorithm>
namespace tsfg::formalException {
bool SourceProof::annotation(size_t &at,const Json &raw,llvm::StringRef key){
  const auto name=string(field(raw,key));
  if(name=="function"){
    const auto &signature=field(raw,key=="returnType"?"returnSignature":"signature");
    if(!source->expect(at,"(",p))return false;
    const auto &parameters=items(field(signature,"parameters"));
    for(size_t i=0;i<parameters.size();++i){
      if(i&&!source->expect(at,",",p))return false;
      if(!p.require(at<source->tokens.size(),"callable parameter spelling"))return false;
      const auto &token=source->tokens[at];
      if(!source->name(at,token.text,Object{{"start",int64_t(token.start)},{"end",int64_t(token.end)}},p,true)
        ||!source->expect(at,":",p)||!source->expect(at,string(parameters[i]),p))return false;
    }
    if(!source->expect(at,")",p)||!source->expect(at,"=>",p)||!source->expect(at,string(field(signature,"returnType")),p))return false;
  }else{
    const auto actual=nominalTypes.count(name)?string(field(*p.types.at(nominalTypes.at(name)),"name")):name;
    const auto spelling=source->spelling(at);
    if(!source->expect(at,(name=="bool"&&spelling=="boolean")?"boolean":(name=="f64"&&spelling=="number")?"number":actual,p))return false;
  }
  const auto &presence=field(raw,key=="returnType"?"returnPresence":"presence");
  bool undefined=false,null=false;
  while(source->spelling(at)=="|"){
    ++at;if(source->spelling(at)=="undefined"&&!undefined)undefined=true;
    else if(source->spelling(at)=="null"&&!null)null=true;
    else return p.require(false,"Source absence annotation");++at;
  }
  return p.require(undefined==(field(presence,"undefined").getAsBoolean()==true)
    &&null==(field(presence,"null").getAsBoolean()==true),"Source annotation absence differs");
}
bool SourceProof::declaration(const Json &raw,const Json &h,SourceScope &scope){
  const auto id=string(field(raw,"id")),role=string(field(h,"role")),hirId=string(field(h,"id"));
  const auto original=symbols.find(id);std::string typeId;
  if(role=="function"){
    const auto mapped=p.rawFunctions.find(id);
    if(!p.require(mapped!=p.rawFunctions.end(),"declaration references an unknown function symbol"))return false;
    const auto declared=p.functions.find(mapped->second);
    if(!p.require(declared!=p.functions.end(),"declaration references an unknown HIR function"))return false;
    typeId=string(field(*declared->second,"type"));
  }else typeId=type(raw);
  const auto expected=hirIdentity("binding",Object{{"ownerKind",p.functions.count(currentOwner)?"function":"module"},
    {"owner",currentOwner},{"scopePath",Json(Array(scope.path))},{"role",role},{"index",int64_t(scope.ordinals[role]++)}});
  if(!p.require(original!=symbols.end()&&equal(*original->second,raw)&&hirId==expected
    &&string(field(raw,"name"))==string(field(h,"name"))&&typeId==string(field(h,"type"))
    &&equal(field(raw,"range"),field(h,"range"))&&equal(field(raw,"writable"),field(h,"writable"))
    &&equal(field(raw,"presence"),field(h,"presence"))&&p.bindings.size()<4096&&p.bindings.emplace(hirId,&h).second
    &&p.bindingOwner.emplace(hirId,currentOwner).second&&p.rawBindings.emplace(id,hirId).second
    &&claimedSymbols.insert(id).second,"binding ownership, type, permission or deterministic identity"))return false;
  scope.visible[id]=hirId;scope.names[string(field(raw,"name"))]=id;
  if(role=="parameter"||role=="catch")scope.initialized.insert(id);
  return true;
}
bool SourceProof::separator(size_t &at){
  if(source->spelling(at)==";"){++at;return true;}
  if(source->spelling(at)=="}")return true;
  if(!p.require(at&&at<source->tokens.size(),"statement separator"))return false;
  const auto a=source->tokens[at-1].end,b=source->tokens[at].start;
  for(uint32_t i=a;i<b;++i)if(source->content[i]==10||source->content[i]==13||source->content[i]==0x2028||source->content[i]==0x2029)return true;
  return p.require(false,"missing original statement separator");
}
bool SourceProof::region(const Array &raw,const Json &h,SourceScope &scope,size_t &at,bool braces){
  if(!p.step())return false;const auto first=at;const auto parent=scope.scope;
  const auto ownerKind=p.functions.count(currentOwner)?"function":"module";
  const auto id=hirIdentity("scope",Object{{"ownerKind",ownerKind},{"owner",currentOwner},{"path",Json(Array(scope.path))}});
  if(!p.require(string(field(h,"kind"))=="region"&&string(field(h,"role"))==scope.role
    &&string(field(h,"scope"))==id&&equal(field(h,"path"),Json(Array(scope.path)))
    &&(parent.empty()?bool(field(h,"parentScope").getAsNull()):string(field(h,"parentScope"))==parent)
    &&p.regions.emplace(id,&h).second,"region ownership and original path identity"))return false;
  scope.scope=id;scope.ordinals.clear();
  auto declarations=scope.prefix;scope.prefix.clear();
  for(const auto &s:raw){const auto kind=string(field(s,"kind"));
    if(kind=="variable")declarations.emplace_back(&field(s,"symbol"),"local");
    else if(kind=="functionDeclaration")declarations.emplace_back(&field(s,"symbol"),"function");
  }
  const auto &bindings=items(field(h,"bindings"));
  if(!p.require(declarations.size()==bindings.size()&&raw.size()==items(field(h,"body")).size(),"complete region declarations/statements"))return false;
  std::set<std::string> localNames;
  for(size_t i=0;i<bindings.size();++i)if(!p.require(string(field(bindings[i],"role"))==declarations[i].second
    &&localNames.insert(string(field(*declarations[i].first,"name"))).second,"declaration role or duplicate lexical name")
    ||!declaration(*declarations[i].first,bindings[i],scope))return false;
  if(braces&&!source->expect(at,"{",p))return false;
  for(size_t i=0;i<raw.size();++i){
    if(scope.role=="module"&&!moduleDeclarations(at))return false;
    if(!statement(raw[i],items(field(h,"body"))[i],scope,at))return false;
  }
  if(scope.role=="module"&&(!moduleDeclarations(at)||!p.require(at==source->tokens.size(),"omitted module initialization or declaration")))return false;
  if(braces&&!source->expect(at,"}",p))return false;
  if(scope.role!="function"&&scope.role!="module"&&!source->span(field(h,"range"),first,at-1,p))return false;
  return true;
}
bool SourceProof::statement(const Json &raw,const Json &h,SourceScope &scope,size_t &at){
  if(!p.step())return false;const auto kind=string(field(raw,"kind"));const auto first=at;
  if(!p.require(equal(field(raw,"range"),field(h,"range")),"statement original anchor"))return false;
  const auto &parent=field(h,"range");
  auto nested=[&](const Array &body,const Json &node,llvm::StringRef role,size_t position,SourceScope &child){
    child=scope;child.prefix.clear();child.path.push_back(Object{{"statement",int64_t(position)},{"slot",role.str()}});child.role=role.str();
    return region(body,node,child,at);
  };
  const auto *body=p.regions.at(scope.scope)->getAsObject()->getArray("body");size_t position=0;
  for(;position<body->size();++position)if(&(*body)[position]==&h)break;
  if(kind=="throw"||kind=="return"){
    if(!p.require(string(field(h,"kind"))==kind,"abrupt completion kind")||!source->expect(at,kind,p))return false;
    const Json *value=&field(h,"value");if(string(field(*value,"kind"))=="presenceWiden")value=&field(*value,"operand");
    if(!expression(field(raw,"expression"),*value,scope,at)||!separator(at)||!source->span(parent,first,at-1,p))return false;
    scope.normal=false;return true;
  }
  if(kind=="variable"){
    const auto &binding=field(raw,"symbol");const auto keyword=source->spelling(at);
    if(!p.require(string(field(h,"kind"))=="local"&&(keyword=="const"||keyword=="let")
      &&field(binding,"writable").getAsBoolean()==(keyword=="let")&&scope.visible.at(string(field(binding,"id")))==string(field(h,"binding")),"local declaration"))return false;
    ++at;const auto begin=at;if(!source->name(at,string(field(binding,"name")),field(binding,"range"),p))return false;
    if(source->spelling(at)==":"){++at;if(!annotation(at,binding))return false;}
    if(!source->expect(at,"=",p)||!expression(field(raw,"initializer"),field(h,"initializer"),scope,at)
      ||!source->span(parent,begin,at-1,p)||!separator(at))return false;
    scope.initialized.insert(string(field(binding,"id")));return true;
  }
  if(kind=="assignment"){
    if(!p.require(string(field(h,"kind"))=="assign","assignment mapping")
      ||!expression(field(raw,"target"),field(h,"target"),scope,at,true)||!source->expect(at,"=",p)
      ||!expression(field(raw,"value"),field(h,"value"),scope,at)||!separator(at))return false;
    return source->span(parent,first,at-1,p);
  }
  if(kind=="block"){
    if(!p.require(string(field(h,"kind"))=="block","ordinary block mapping"))return false;SourceScope child;
    if(!nested(items(field(raw,"body")),field(h,"region"),"block",position,child))return false;
    scope.narrowed=child.narrowed;scope.written.insert(child.written.begin(),child.written.end());scope.normal&=child.normal;return true;
  }
  if(kind=="functionDeclaration"){
    const auto symbol=string(field(field(raw,"symbol"),"id"));const auto target=p.rawFunctions.find(symbol);
    if(!p.require(string(field(h,"kind"))=="functionDeclaration"&&target!=p.rawFunctions.end()
      &&target->second==string(field(h,"target")),"lexical declaration target"))return false;
    if(!function(*rawFunctions.at(symbol),*p.functions.at(target->second),scope))return false;
    uint32_t a,b;if(!source->range(parent,a,b,p))return false;while(at<source->tokens.size()&&source->tokens[at].end<=b)++at;
    scope.initialized.insert(symbol);return true;
  }
  if(kind=="if"){
    if(!p.require(string(field(h,"kind"))=="if","conditional mapping")||!source->expect(at,"if",p)||!source->expect(at,"(",p)
      ||!expression(field(raw,"condition"),field(h,"condition"),scope,at)||!source->expect(at,")",p))return false;
    SourceScope left=scope,right=scope;const auto &test=field(raw,"condition");
    if(string(field(test,"kind"))=="type-test"){
      const auto id=string(field(field(test,"operand"),"symbol"));
      (string(field(test,"operator"))=="==="?left:right).narrowed.insert(id);
    }
    auto branch=[&](const Array &input,const Json &node,SourceScope &child,llvm::StringRef role){
      if(!p.require(input.size()==1&&string(field(input[0],"kind"))=="block","complete braced branch"))return false;
      auto inherited=child;child.path.push_back(Object{{"statement",int64_t(position)},{"slot",role.str()}});child.role=role.str();child.prefix.clear();
      return region(items(field(input[0],"body")),node,child,at);
    };
    if(!branch(items(field(raw,"thenBody")),field(h,"thenRegion"),left,"then"))return false;
    if(!field(h,"elseRegion").getAsNull()){
      if(!source->expect(at,"else",p)||!branch(items(field(raw,"elseBody")),field(h,"elseRegion"),right,"else"))return false;
    }else if(!p.require(items(field(raw,"elseBody")).empty(),"omitted else body"))return false;
    scope.written.insert(left.written.begin(),left.written.end());scope.written.insert(right.written.begin(),right.written.end());
    std::set<std::string> narrowed;
    if(left.normal&&right.normal)std::set_intersection(left.narrowed.begin(),left.narrowed.end(),right.narrowed.begin(),right.narrowed.end(),std::inserter(narrowed,narrowed.end()));
    else if(left.normal)narrowed=left.narrowed;else if(right.normal)narrowed=right.narrowed;
    scope.narrowed=std::move(narrowed);scope.normal&=left.normal||right.normal;
    return source->span(parent,first,at-1,p,false);
  }
  if(kind=="try"){
    if(!p.require(string(field(h,"kind"))=="try","try mapping")||!source->expect(at,"try",p))return false;
    const auto &fact=field(raw,"exception");SourceScope tried,caught,finalized;
    if(!nested(items(field(field(fact,"tryBlock"),"body")),field(h,"tryRegion"),"try",position,tried))return false;
    caught=scope;caught.normal=false;const auto &catchRaw=field(fact,"catchClause"),&catchHir=field(h,"catchClause");
    if(!catchRaw.getAsNull()){
      if(!p.require(!catchHir.getAsNull(),"omitted handler")||!source->expect(at,"catch",p))return false;
      const auto &binding=field(catchRaw,"binding");caught=scope;caught.prefix.clear();caught.role="catch";
      for(const auto &id:tried.written)caught.narrowed.erase(id);
      if(!binding.getAsNull()){
        if(!p.require(string(field(binding,"type"))=="unknown"&&field(binding,"writable").getAsBoolean()==true,"writable unknown catch declaration")
          ||!source->expect(at,"(",p)||!source->name(at,string(field(binding,"name")),field(binding,"range"),p))return false;
        if(source->spelling(at)==":"){++at;if(!source->expect(at,"unknown",p))return false;}
        if(!source->expect(at,")",p))return false;caught.prefix.emplace_back(&binding,"catch");
      }
      caught.path.push_back(Object{{"statement",int64_t(position)},{"slot","catch"}});
      if(!region(items(field(field(catchRaw,"block"),"body")),field(catchHir,"region"),caught,at))return false;
      if(!p.require(binding.getAsNull()?bool(field(catchHir,"binding").getAsNull())
        :p.rawBindings.at(string(field(binding,"id")))==string(field(catchHir,"binding")),"catch actual binding relation"))return false;
    }else if(!p.require(bool(catchHir.getAsNull()),"invented catch handler"))return false;
    auto written=scope.written;written.insert(tried.written.begin(),tried.written.end());written.insert(caught.written.begin(),caught.written.end());
    const bool normal=tried.normal||caught.normal;const auto &finalRaw=field(fact,"finallyBlock");
    if(!finalRaw.getAsNull()){
      if(!source->expect(at,"finally",p))return false;finalized=scope;
      for(const auto &id:written)finalized.narrowed.erase(id);
      finalized.prefix.clear();finalized.role="finally";finalized.path.push_back(Object{{"statement",int64_t(position)},{"slot","finally"}});
      if(!region(items(field(finalRaw,"body")),field(h,"finallyRegion"),finalized,at))return false;
      written.insert(finalized.written.begin(),finalized.written.end());scope.normal&=normal&&finalized.normal;
    }else{if(!p.require(bool(field(h,"finallyRegion").getAsNull()),"invented finally handler"))return false;scope.normal&=normal;}
    for(const auto &id:written)scope.narrowed.erase(id);scope.written=std::move(written);
    return source->span(parent,first,at-1,p);
  }
  if(kind=="while"){
    if(!p.require(string(field(h,"kind"))=="while","loop mapping")||!source->expect(at,"while",p)||!source->expect(at,"(",p)
      ||!expression(field(raw,"condition"),field(h,"condition"),scope,at)||!source->expect(at,")",p))return false;
    const auto &body=items(field(raw,"body"));
    if(!p.require(body.size()==1&&string(field(body[0],"kind"))=="block","complete owned loop body"))return false;
    SourceScope repeated;
    if(!nested(items(field(body[0],"body")),field(h,"bodyRegion"),"loop",position,repeated))return false;
    for(const auto &id:repeated.written)scope.narrowed.erase(id);
    scope.written.insert(repeated.written.begin(),repeated.written.end());
    if(string(field(field(raw,"condition"),"kind"))=="boolean"&&field(field(raw,"condition"),"boolean").getAsBoolean()==true)scope.normal=false;
    return source->span(parent,first,at-1,p);
  }
  return p.require(false,"unrepresented actual Source statement");
}
bool SourceProof::function(const Json &raw,const Json &h,const SourceScope &outer){
  const auto id=string(field(h,"id")),rawId=string(field(raw,"symbol"));
  if(!p.require(claimedFunctions.insert(id).second&&symbols.count(rawId),"function declaration/body identity"))return false;
  const auto oldOwner=currentOwner,oldSource=currentSource;auto *oldText=source;
  currentOwner=id;currentSource=string(field(h,"sourcePath"));const auto found=sources.find(currentSource);
  if(!p.require(found!=sources.end()&&equal(field(raw,"range"),field(h,"range"))
    &&string(field(raw,"name"))==string(field(h,"name")),"function defining source/range"))return false;source=&found->second;
  Array parameters;for(const auto &a:items(field(raw,"parameters")))parameters.push_back(type(a));
  const auto returned=type(raw,"returnType"),signature=hirIdentity("signature",Object{{"parameters",Json(Array(parameters))},{"returnType",returned}}),
    callable=hirIdentity("type",Object{{"kind","callable"},{"parameters",Json(Array(parameters))},{"returnType",returned}});
  const auto parentRaw=string(field(raw,"lexicalParent"));std::string parent;
  if(!parentRaw.empty()){
    const auto foundParent=p.rawFunctions.find(parentRaw);
    if(!p.require(foundParent!=p.rawFunctions.end(),"unknown lexical parent function"))return false;
    parent=foundParent->second;
  }
  const auto module=string(field(h,"module"));const auto owned=p.modules.find(module);
  if(!p.require(owned!=p.modules.end()&&string(field(*owned->second,"sourcePath"))==currentSource,"function actual module"))return false;
  const auto declaring=parent.empty()?hirIdentity("scope",Object{{"ownerKind","module"},{"owner",module},{"path",Array{}}}):outer.scope;
  const auto expected=hirIdentity("function",Object{{"module",module},{"parent",parent.empty()?Json(nullptr):Json(parent)},
    {"declaringScopePath",parent.empty()?Json(Array{}):Json(Array(outer.path))},{"name",field(raw,"name")},{"signatureHash",signature},{"range",field(raw,"range")}});
  if(!p.require(expected==id&&string(field(h,"signatureHash"))==signature&&string(field(h,"type"))==callable
    &&string(field(h,"declaringScope"))==declaring&&(parent.empty()?bool(field(h,"lexicalParent").getAsNull()):string(field(h,"lexicalParent"))==parent)
    &&p.types.count(callable),"function signature and lexical identity"))return false;usedTypes.insert(callable);
  uint32_t begin,end;if(!source->range(field(raw,"range"),begin,end,p))return false;size_t at=0;
  while(at<source->tokens.size()&&source->tokens[at].end<=begin)++at;const auto first=at;
  if(source->spelling(at)=="export")++at;
  if(!source->expect(at,"function",p)||!source->name(at,string(field(raw,"name")),field(*symbols.at(rawId),"range"),p)
    ||!source->expect(at,"(",p))return false;
  const auto &rawParameters=items(field(raw,"parameters"));
  SourceScope scope=outer;scope.scope.clear();scope.path.clear();scope.role="function";scope.prefix.clear();scope.normal=true;
  for(size_t i=0;i<rawParameters.size();++i){const auto &a=rawParameters[i];if(i&&!source->expect(at,",",p))return false;
    if(!source->name(at,string(field(a,"name")),field(a,"range"),p)||!source->expect(at,":",p)||!annotation(at,a))return false;
    scope.prefix.emplace_back(&a,"parameter");
  }
  if(!source->expect(at,")",p)||!source->expect(at,":",p)||!annotation(at,raw,"returnType")
    ||!p.require(equal(field(h,"range"),field(field(h,"body"),"range")),"root region anchor")
    ||!region(items(field(raw,"body")),field(h,"body"),scope,at)||!source->span(field(raw,"range"),first,at-1,p))return false;
  Array ownParameters;
  for(const auto &parameter:rawParameters){const auto mapped=p.rawBindings.find(string(field(parameter,"id")));
    if(!p.step()||!p.require(mapped!=p.rawBindings.end()&&p.bindingOwner.at(mapped->second)==id
      &&string(field(*p.bindings.at(mapped->second),"role"))=="parameter","own Source parameter binding"))return false;
    ownParameters.push_back(mapped->second);
  }
  if(!p.require(equal(field(h,"parameters"),Json(std::move(ownParameters))),"own ordered Source parameters differ"))return false;
  std::map<std::string,std::pair<bool,bool>> claimed;
  for(const auto &c:items(field(h,"captures")))if(!p.step()||!p.require(claimed.emplace(string(field(c,"binding")),
    std::pair<bool,bool>{field(c,"read").getAsBoolean()==true,field(c,"write").getAsBoolean()==true}).second,"duplicate logical capture binding"))return false;
  if(!p.require(claimed==actualCaptures[id],"captures differ from original actual binding uses"))return false;
  currentOwner=oldOwner;currentSource=oldSource;source=oldText;return true;
}
}
