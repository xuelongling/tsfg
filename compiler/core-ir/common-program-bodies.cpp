// SPDX-License-Identifier: MIT
#include "common-program-syntax.h"
#include "llvm/ADT/STLExtras.h"
#include <tuple>
namespace tsfg::commonProgram {
namespace {
Json range(const SourceToken &a,const SourceToken &b){return Object{{"start",int64_t(a.start)},{"end",int64_t(b.end)}};}
std::string origin(llvm::StringRef path,const Json &name){
  return digest(std::string("tsfg.array-facts.binding.v1")+std::string(1,'\0')+canonical(Object{{"sourcePath",path},{"nameRange",name}}));
}
}
bool SourceBodies::inventory(){
  for(const auto &[path,module]:model.modules){
    if(!model.spend()||!model.need(syntax.count(path),"module has no exact source text"))return false;
    auto &scope=visible[path];
    if(!model.spend(model.types.size()+model.functions.size()+model.globals.size()))return false;
    for(const auto &[id,t]:model.types)if(string(field(*t,"sourcePath"))==path&&
      (string(field(*t,"kind"))=="value"||string(field(*t,"kind"))=="reference")){
      if(!model.spend()||!model.need(scope.emplace(string(field(*t,"name")),id).second,"duplicate original nominal symbol"))return false;
    }
    for(const auto &[id,fn]:model.functions)if(string(field(*fn,"sourcePath"))==path&&field(*fn,"ownerType").getAsNull()&&field(*fn,"lexicalParent").getAsNull()){
      if(!model.spend()||!model.need(scope.emplace(string(field(*fn,"name")),id).second,"duplicate original module symbol"))return false;
    }
    for(const auto &[id,g]:model.globals)if(string(field(*g,"sourcePath"))==path){
      if(!model.spend()||!model.need(scope.emplace(string(field(field(*g,"binding"),"name")),id).second,"duplicate original global symbol"))return false;
    }
    for(const auto &edge:items(field(*module,"imports")))for(const auto &alias:items(field(edge,"bindings"))){
      if(!model.spend())return false;
      if(!field(alias,"localBinding").getAsNull()&&!model.need(scope.emplace(string(field(alias,"name")),string(field(alias,"target"))).second,"duplicate original imported symbol"))return false;
    }
    for(const auto &[id,host]:model.hosts){if(!model.spend())return false;scope.try_emplace(string(field(*host,"name")),id);}
  }
  const auto add=[&](const Json &b,const std::string &path,const std::string &owner){
    if(!model.spend()||!model.need(syntax.count(path)&&model.types.count(string(field(b,"declaredType"))),"binding source/type missing"))return false;
    const auto id=string(field(b,"id"));auto &s=syntax.at(path);
    if(!model.need(id==origin(path,field(b,"nameRange"))&&bindings.emplace(id,&b).second&&
      (owner.empty()?bool(field(b,"lexicalOwner").getAsNull()):string(field(b,"lexicalOwner"))==owner),"binding identity, lexical owner or uniqueness differs")||
      !s.name(field(b,"nameRange"),string(field(b,"name"))))return false;
    SourceAnchor declaration,name;if(!s.range(field(b,"declarationRange"),declaration)||!s.range(field(b,"nameRange"),name)||
      !model.need(name.start>=declaration.start&&name.end<=declaration.end,"binding name leaves original declaration"))return false;
    return true;
  };
  for(const auto &[id,fn]:model.functions){const auto path=string(field(*fn,"sourcePath"));
    if(!model.need(syntax.count(path)&&id==digest(std::string("tsfg.array-facts.function.v8")+std::string(1,'\0')+
      canonical(Object{{"sourcePath",path},{"declarationRange",field(*fn,"declarationRange")}})),"original function identity differs"))return false;
    for(const auto &b:items(field(*fn,"parameters")))if(!add(b,path,id))return false;
    for(const auto &b:items(field(*fn,"bindings")))if(!add(b,path,id))return false;
  }
  for(const auto &[id,g]:model.globals)if(!add(field(*g,"binding"),string(field(*g,"sourcePath")),{}))return false;
  return true;
}
std::string SourceBodies::resolve(const Json &r){
  size_t a,b;if(!source->span(r,a,b))return {};
  if(b==a+1){auto it=scope.find(source->tokens[a].text);return it==scope.end()?std::string():it->second;}
  if(b==a+3&&source->tokens[a+1].text=="."){
    auto alias=scope.find(source->tokens[a].text);if(alias==scope.end()||!model.modules.count(alias->second))return {};
    for(const auto &e:items(field(*model.modules.at(alias->second),"exports"))){
      if(!model.spend())return {};if(string(field(e,"name"))==source->tokens[a+2].text)return string(field(e,"target"));
    }
  }
  return {};
}
bool SourceBodies::annotation(const Json &r,const std::string &expected,bool optional){
  size_t a,b;if(!source->span(r,a,b))return false;
  if(!model.spend())return false;
  const AnnotationKey key{source->path,{source->tokens[a].start,source->tokens[b-1].end}};
  auto cached=annotationTypes.find(key);if(cached!=annotationTypes.end())return model.need(cached->second==expected,"original annotation type changed between uses");
  std::vector<std::pair<std::string,std::string>> origins;
  // Optional syntax may contain a real annotation-only union whose effective
  // +undefined type is the sole owned catalogue row. Retain parsed members,
  // never synthesize a catalogue entry or split a claimed type identifier.
  std::map<std::string,std::vector<std::string>> parsedUnions;
  std::function<std::string(unsigned)> unit,unionType;
  unit=[&](unsigned depth)->std::string{
    if(depth>32){reject(model.error,"core-ir-common-budget","type annotation nesting exceeds32");return {};}
    if(!model.spend()||a>=b)return {};std::string result;bool parsedUnion=false;
    if(source->tokens[a].text=="("){
      const auto start=source->tokens[a].start;
      ++a;bool callable=a+1<b&&source->tokens[a+1].text==":";
      if(a<b&&source->tokens[a].text==")"&&a+2<b&&source->tokens[a+1].text=="="&&source->tokens[a+2].text==">")callable=true;
      if(callable){
        Array parameters;std::set<std::string> names;
        while(a<b&&source->tokens[a].text!=")"){
          if(!model.spend()||a+1>=b)return {};const auto &name=source->tokens[a];
          const Json nr=range(name,name);if(!source->name(nr,name.text)||!names.insert(name.text).second||source->tokens[++a].text!=":")return {};
          ++a;auto parameter=unionType(depth+1);if(parameter.empty())return {};parameters.push_back(parameter);
          if(a<b&&source->tokens[a].text==","){++a;continue;}break;
        }
        if(a+2>=b||source->tokens[a].text!=")"||source->tokens[a+1].text!="="||source->tokens[a+2].text!=">"||source->tokens[a+1].end!=source->tokens[a+2].start)return {};
        a+=3;const auto returned=unionType(depth+1);if(returned.empty())return {};
        result=digest(std::string("tsfg.program.function-type.v2")+std::string(1,'\0')+canonical(Object{{"parameters",std::move(parameters)},{"returnType",returned}}));
        if(!model.spend(2))return {};
        const auto signature=digest(std::string("tsfg.array-facts.signature.v8")+std::string(1,'\0')+canonical(Object{{"sourcePath",source->path},{"declarationRange",Object{{"start",int64_t(start)},{"end",int64_t(source->tokens[a-1].end)}}}}));
        origins.emplace_back(signature,result);
      }else{result=unionType(depth+1);if(a>=b||source->tokens[a++].text!=")")return {};
        if(optional){size_t comparisons=1;for(size_t n=parsedUnions.size();n;n>>=1)comparisons+=2;
          if(!model.spend(comparisons*(result.size()/8+1)))return {};parsedUnion=parsedUnions.count(result);}}
    }else{
      const auto name=source->tokens[a++].text;
      if(name=="Array"||name=="ReadSpan"){
        if(a>=b||source->tokens[a++].text!="<")return {};const auto element=unionType(depth+1);
        if(a>=b||source->tokens[a++].text!=">")return {};result=(name=="Array"?"array<":"readSpan<")+element+">";
      }else if(model.types.count(name))result=name;
      else if([&](){for(const auto &[id,alias]:model.aliases){if(!model.spend())return false;
        if(string(field(*alias,"sourcePath"))==source->path&&string(field(*alias,"name"))==name){result=string(field(*alias,"type"));return true;}}return false;}()){}

      else {
        auto alias=scope.find(name);if(alias!=scope.end()&&model.types.count(alias->second))result=alias->second;
        else for(const auto &[id,t]:model.types){if(!model.spend())return {};
          if(!string(field(*t,"name")).empty()&&string(field(*t,"name"))==name){if(!result.empty()&&result!=id)return {};result=id;}}
      }
    }
    while(a+1<b&&source->tokens[a].text=="["&&source->tokens[a+1].text=="]"){a+=2;result="array<"+result+">";parsedUnion=false;}
    if(parsedUnion)return result;
    return model.types.count(result)?result:std::string();
  };
  unionType=[&](unsigned depth)->std::string{
    auto first=unit(depth);if(first.empty())return {};
    if(optional){
      std::set<std::string> members;
      const auto insert=[&](llvm::StringRef text){size_t comparisons=2;for(size_t n=members.size();n;n>>=1)comparisons+=2;
        if(!model.spend(comparisons*(text.size()/8+1)+1))return false;members.insert(text.str());return true;};
      const auto add=[&](const std::string &id){
        size_t comparisons=1;for(size_t n=parsedUnions.size();n;n>>=1)comparisons+=2;
        if(!model.spend(comparisons*(id.size()/8+1)))return false;const auto parsed=parsedUnions.find(id);
        if(parsed!=parsedUnions.end()){for(const auto &member:parsed->second)if(!insert(member))return false;return true;}
        comparisons=1;for(size_t n=model.types.size();n;n>>=1)comparisons+=2;
        if(!model.spend(comparisons*(id.size()/8+1)))return false;const auto found=model.types.find(id);
        if(found!=model.types.end()&&string(field(*found->second,"kind"))=="union"){
          for(const auto &member:items(field(*found->second,"members")))if(!insert(member.getAsString().value()))return false;return true;
        }return insert(id);
      };
      if(!add(first))return {};
      while(a<b&&source->tokens[a].text=="|"){++a;auto next=unit(depth);if(next.empty()||!add(next))return {};}
      if(members.size()==1){if(!model.spend(members.begin()->size()/8+1))return {};return *members.begin();}
      size_t bytes=8;for(const auto &member:members){if(!model.spend())return {};bytes+=member.size()+1;}
      if(!model.spend(bytes/8+members.size()+1))return {};std::string id="union<";
      for(const auto &member:members){if(id.size()>6)id+=",";id+=member;}id+=">";
      size_t comparisons=1;for(size_t n=parsedUnions.size();n;n>>=1)comparisons+=2;
      if(!model.spend(comparisons*(id.size()/8+1)+members.size()+1))return {};std::vector<std::string> saved;saved.reserve(members.size());
      for(const auto &member:members){if(!model.spend(member.size()/8+2))return {};saved.push_back(member);}
      parsedUnions.emplace(id,std::move(saved));return id;
    }
    std::set<std::string> members{first};
    while(a<b&&source->tokens[a].text=="|"){++a;auto next=unit(depth);if(next.empty())return {};members.insert(next);}
    if(members.size()==1)return first;std::string id="union<";for(const auto &m:members){if(id.size()>6)id+=",";id+=m;}return id+">";
  };
  auto actual=unionType(0);
  if(optional&&!actual.empty()){
    size_t comparisons=1;for(size_t n=parsedUnions.size();n;n>>=1)comparisons+=2;
    if(!model.spend(comparisons*(actual.size()/8+1)+2))return false;const auto parsed=parsedUnions.find(actual);
    std::set<std::string> members{"undefined"};
    if(parsed!=parsedUnions.end())for(const auto &member:parsed->second){size_t comparisons=2;for(size_t n=members.size();n;n>>=1)comparisons+=2;
      if(!model.spend(comparisons*(member.size()/8+1)+1))return false;members.insert(member);}
    else{if(!model.spend(actual.size()/8+2))return false;members.insert(actual);}
    if(members.size()>1){size_t bytes=8;for(const auto &member:members){if(!model.spend())return false;bytes+=member.size()+1;}
      if(!model.spend(bytes/8+members.size()+1))return false;actual="union<";for(const auto &member:members){if(actual.size()>6)actual+=",";actual+=member;}actual+=">";}
    else actual="undefined";
  }
  if(!model.need(actual==expected&&a==b,"original annotation does not name declared semantic type")||!model.spend(origins.size()+1))return false;
  // Publish only complete, independently parsed annotations. ParenthesizedType
  // wrappers do not acquire the inner FunctionTypeNode's declaration identity.
  for(const auto &[signature,type]:origins){auto inserted=callableOrigins.emplace(signature,type);
    if(!model.need(inserted.second||inserted.first->second==type,"original callable annotation has inconsistent types"))return false;}
  annotationTypes.emplace(key,expected);return true;
}
bool SourceBodies::annotations(){
  std::map<std::string,std::vector<std::tuple<Json,std::string,bool>>> grouped;
  const auto add=[&](const std::string &path,const Json &range,const std::string &type,bool optional=false){
    if(range.getAsNull())return true;if(!model.spend(2+(path.size()+type.size())/64))return false;
    grouped[path].emplace_back(range,type,optional);return true;
  };
  for(const auto &[id,alias]:model.aliases)if(!add(string(field(*alias,"sourcePath")),field(*alias,"annotationRange"),string(field(*alias,"type"))))return false;
  for(const auto &[id,fn]:model.functions){
    if(!model.spend())return false;const auto path=string(field(*fn,"sourcePath"));Array parameters;
    const auto &initialization=field(*fn,"parameterInitialization");const bool ordinaryFDI=field(*fn,"ownerType").getAsNull()&&field(*fn,"lexicalParent").getAsNull()&&!initialization.getAsNull();
    SourceSyntax *parameterSource=nullptr;if(ordinaryFDI){size_t comparisons=1;for(size_t n=syntax.size();n;n>>=1)comparisons+=2;
      if(!model.spend(comparisons*(path.size()/8+1)))return false;parameterSource=&syntax.at(path);}
    for(const auto &p:items(field(*fn,"parameters"))){
      bool optional=false;if(ordinaryFDI){size_t first,last,rounds=1;for(size_t n=parameterSource->tokens.size();n;n>>=1)++rounds;
        if(!model.spend(2*rounds+4)||!parameterSource->span(field(p,"nameRange"),first,last))return false;
        optional=last<parameterSource->tokens.size()&&parameterSource->tokens[last].text=="?";}
      if(!model.spend()||!add(path,field(p,"annotationRange"),string(field(p,"declaredType")),optional))return false;
      parameters.push_back(field(p,"declaredType"));
    }
    for(const auto &b:items(field(*fn,"bindings")))if(!model.spend()||!add(path,field(b,"annotationRange"),string(field(b,"declaredType"))))return false;
    if(!add(path,field(*fn,"returnAnnotationRange"),string(field(*fn,"returnType"))))return false;
    if(field(*fn,"ownerType").getAsNull()){
      const auto signature=digest(std::string("tsfg.array-facts.signature.v8")+std::string(1,'\0')+canonical(Object{{"sourcePath",path},{"declarationRange",field(*fn,"declarationRange")}}));
      const auto type=digest(std::string("tsfg.program.function-type.v2")+std::string(1,'\0')+canonical(Object{{"parameters",std::move(parameters)},{"returnType",field(*fn,"returnType")}}));
      if(!model.spend())return false;callableOrigins.emplace(signature,type);
    }
  }
  for(const auto &[id,g]:model.globals)if(!model.spend()||!add(string(field(*g,"sourcePath")),field(field(*g,"binding"),"annotationRange"),string(field(field(*g,"binding"),"declaredType"))))return false;
  // Fields have no annotationRange in this DTO. Recover only their existing
  // grammar boundary; full field/declaration provenance is checked separately.
  for(const auto &[id,t]:model.types){if(!model.spend())return false;for(const auto &f:items(field(*t,"fields"))){
    if(!model.spend())return false;if(!field(f,"parameterBinding").getAsNull())continue;
    const auto path=string(field(field(f,"origin"),"source"));if(!model.need(syntax.count(path),"field annotation source missing"))return false;
    auto &s=syntax.at(path);size_t a,b;const auto &o=field(f,"origin");if(!s.span(Object{{"start",field(o,"start")},{"end",field(o,"end")}},a,b))return false;
    while(a<b&&llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"public","private","protected","readonly","declare"},s.tokens[a].text)){if(!model.spend())return false;++a;}
    if(!model.need(a+2<b&&s.tokens[a].text==string(field(f,"name"))&&s.tokens[a+1].text==":","field annotation prefix differs"))return false;a+=2;
    if(s.tokens[b-1].text==";")--b;
    if(!field(f,"initializer").getAsNull()){
      size_t ia,ib;if(!s.span(field(field(f,"initializer"),"range"),ia,ib)||!model.need(ia>a&&s.tokens[ia-1].text=="=","field annotation initializer boundary differs"))return false;b=ia-1;
    }
    if(!model.need(a<b,"field annotation missing")||!add(path,range(s.tokens[a],s.tokens[b-1]),string(field(f,"type"))))return false;
  }}
  for(const auto &[path,rows]:grouped){
    if(!model.spend()||!model.need(syntax.count(path)&&visible.count(path),"annotation source scope missing"))return false;source=&syntax.at(path);if(!setScope(visible.at(path)))return false;
    for(const auto &[range,type,optional]:rows)if(!model.spend()||!annotation(range,type,optional))return false;
  }return true;
}
bool SourceBodies::function(const Json &fn){
  current=&fn;const auto path=string(field(fn,"sourcePath"));source=&syntax.at(path);if(!setScope(visible.at(path)))return false;declared.clear();initialized.clear();
  if(!lexicalScope(fn))return false;
  const auto id=string(field(fn,"id"));
  for(const auto &b:items(field(fn,"parameters"))){
    if(!model.spend()||!model.need(string(field(b,"kind"))=="parameter","original parameter kind differs"))return false;
    scope[string(field(b,"name"))]=string(field(b,"id"));declared.insert(string(field(b,"id")));
  }
  size_t a,b;if(!source->span(field(fn,"declarationRange"),a,b))return false;
  std::vector<Json> header;size_t cursor=a;bool overrideToken=false;
  while(cursor<b&&(source->tokens[cursor].text=="export"||source->tokens[cursor].text=="default"||
    source->tokens[cursor].text=="public"||source->tokens[cursor].text=="private"||source->tokens[cursor].text=="protected"||source->tokens[cursor].text=="override")){
    if(source->tokens[cursor].text=="override"){
      if(!model.need(!overrideToken&&!string(field(fn,"overrideTarget")).empty(),"original override modifier lacks inherited member"))return false;overrideToken=true;
    }header.push_back(source->tokens[cursor++].text);
  }
  Json actualName=field(fn,"nameRange");const auto owner=string(field(fn,"ownerType"));
  const bool constructor=model.types.count(owner)&&string(field(field(*model.types.at(owner),"constructor"),"id"))==id;
  const bool parameterInitialization=!field(fn,"parameterInitialization").getAsNull();
  const bool ordinaryFDI=parameterInitialization&&field(model.facts,"version").getAsInteger()==3&&owner.empty()&&field(fn,"lexicalParent").getAsNull();
  const auto &initialization=field(fn,"parameterInitialization");const auto &steps=items(field(initialization,"steps"));
  if(!parameterInitialization)for(const auto &p:items(field(fn,"parameters"))){if(!model.spend())return false;initialized.insert(string(field(p,"id")));}
  if(constructor){
    // The official constructor DTO anchors nameRange to its entire original
    // declaration. Recover only the keyword token for grammar checking; retain
    // that original DTO span in all protocol/owned provenance.
    if(!model.need(same(field(fn,"nameRange"),field(fn,"declarationRange"))&&cursor<b&&source->tokens[cursor].text=="constructor","original constructor keyword/span differs"))return false;
    actualName=range(source->tokens[cursor],source->tokens[cursor]);
  }
  if(!source->name(actualName,string(field(fn,"name"))))return false;
  if(field(fn,"ownerType").getAsNull())header.push_back("function");
  header.push_back(std::move(actualName));header.push_back("(");size_t index=0,minimum=0;bool hasOrdinaryFDI=false;
  for(const auto &p:items(field(fn,"parameters"))){
    if(!model.spend())return false;if(index++)header.push_back(",");
    const Json *step=parameterInitialization?&steps[index-1]:nullptr;
    size_t pa,pb,na,nb;if(!source->span(field(p,"declarationRange"),pa,pb)||!source->span(field(p,"nameRange"),na,nb))return false;
    std::vector<Json> pieces;bool readonly=false;std::string access;
    for(auto token=pa;token<na;++token){
      if(!model.spend())return false;const auto &word=source->tokens[token].text;
      if(word=="readonly"){if(!model.need(!readonly,"duplicate parameter property readonly modifier"))return false;readonly=true;}
      else if(!model.need(access.empty()&&(word=="public"||word=="private"||word=="protected"),"original parameter property modifier differs"))return false;
      else access=word;pieces.push_back(word);
    }
    const bool property=readonly||!access.empty();const Json *propertyField=nullptr;
    if(constructor)for(const auto &f:items(field(*model.types.at(owner),"fields"))){
      if(!model.spend())return false;if(same(field(f,"parameterBinding"),field(p,"id"))){
        if(!model.need(!propertyField,"duplicate constructor parameter property"))return false;propertyField=&f;
      }
    }
    if(!model.need(property==bool(propertyField)&&(!property||constructor),"parameter property does not join original constructor field"))return false;
    if(propertyField&&!model.need(string(field(*propertyField,"name"))==string(field(p,"name"))&&
      same(field(*propertyField,"type"),field(p,"declaredType"))&&field(*propertyField,"readonly").getAsBoolean()==readonly&&
      string(field(*propertyField,"access"))==(access.empty()?"public":access)&&
      string(field(*propertyField,"id"))==digest(std::string("tsfg.array-facts.field.v8")+std::string(1,'\0')+
        canonical(Object{{"sourcePath",path},{"nameRange",field(p,"nameRange")}}))&&
      same(field(*propertyField,"origin"),Object{{"source",path},{"start",field(field(p,"declarationRange"),"start")},{"end",field(field(p,"declarationRange"),"end")}}),
      "constructor parameter property source, type or modifiers differ"))return false;
    pieces.push_back(field(p,"nameRange"));
    const bool optional=nb<pb&&source->tokens[nb].text=="?",defaulted=step&&!field(*step,"initializer").getAsNull();
    if(!model.need(!optional||ordinaryFDI&&!defaulted,"optional parameter requires its original ordinary Source3 FDI stage"))return false;
    if(ordinaryFDI){
      if(!model.need(!field(p,"annotationRange").getAsNull(),"ordinary FDI parameter requires its original annotation"))return false;
      if(optional){
        const auto &type=*model.types.at(string(field(p,"declaredType")));bool undefined=string(field(type,"kind"))=="undefined";
        for(const auto &member:items(field(type,"members"))){if(!model.spend())return false;undefined|=string(member)=="undefined";}
        if(!model.need(undefined,"ordinary optional declaration lacks effective undefined"))return false;
      }
    }
    if(optional){pieces.push_back("?");hasOrdinaryFDI=true;}
    if(defaulted)hasOrdinaryFDI=true;if(!optional&&!defaulted)minimum=index;
    if(!field(p,"annotationRange").getAsNull()){
      if(!annotation(field(p,"annotationRange"),string(field(p,"declaredType")),optional))return false;
      pieces.push_back(":");pieces.push_back(field(p,"annotationRange"));
    }
    if(step&&!field(*step,"initializer").getAsNull()){
      parameterInitializer=true;const bool valid=expression(field(*step,"initializer"),false,string(field(p,"declaredType")));parameterInitializer=false;
      if(!valid)return false;
      pieces.push_back("=");pieces.push_back(field(field(*step,"initializer"),"range"));
    }
    if(!source->sequence(field(p,"declarationRange"),pieces))return false;header.push_back(field(p,"declarationRange"));
    initialized.insert(string(field(p,"id")));
  }
  if(ordinaryFDI&&!model.need(hasOrdinaryFDI&&field(initialization,"minimumArgumentCount").getAsInteger()==int64_t(minimum),
    "ordinary FDI minimum or original optional/default declaration differs"))return false;
  header.push_back(")");
  if(!field(fn,"returnAnnotationRange").getAsNull()){
    if(!annotation(field(fn,"returnAnnotationRange"),string(field(fn,"returnType"))))return false;
    header.push_back(":");header.push_back(field(fn,"returnAnnotationRange"));
  }
  size_t body=b;for(size_t n=a;n<b;++n)if(source->tokens[n].text=="{"){body=n;break;}
  if(!model.need(body<b&&source->tokens[b-1].text=="}","original function body missing"))return false;
  const auto originalBody=range(source->tokens[body],source->tokens[b-1]);
  if(field(fn,"lexicalParent").getAsNull()){
    const Json expectedScope=owner.empty()?Json(Object{{"start",0},{"end",int64_t(source->content.size())}}):field(*model.types.at(owner),"declarationRange");
    if(!model.need(same(field(fn,"declarationScope"),expectedScope),"top-level function/class declaration scope differs"))return false;
  }else{
    const auto *parent=model.functions.at(string(field(fn,"lexicalParent")));size_t pa,pb;
    if(!source->span(field(*parent,"declarationRange"),pa,pb))return false;
    while(pa<pb&&source->tokens[pa].text!="{")++pa;
    const auto &declarations=model.scopeDeclarations.at(string(field(*parent,"id")));const auto id=string(field(fn,"id"));
    size_t sa,sb;if(!source->span(field(fn,"declarationScope"),sa,sb))return false;
    if(!model.need(pa<pb&&declarations.count(id)&&declarations.at(id).eligible&&!declarations.at(id).repeated&&
      pa<=sa&&sb<=pb&&source->tokens[sa].text=="{"&&source->tokens[sb-1].text=="}","nested function declaration requires its original single-entry block scope"))return false;
  }
  header.push_back(originalBody);
  if(!source->sequence(field(fn,"declarationRange"),header))return false;
  for(const auto &binding:model.functionVars.at(id)){
    if(!model.spend()||!model.need(bindings.count(binding),"function-scoped var inventory missing"))return false;
    scope[string(field(*bindings.at(binding),"name"))]=binding;initialized.insert(binding);declared.insert(binding);
  }
  if(!statements(field(fn,"body"),body+1,b-1))return false;
  for(const auto &binding:items(field(fn,"bindings")))if(!model.need(declared.count(string(field(binding,"id"))),"omitted original binding declaration"))return false;
  return captures();
}
bool SourceBodies::module(const Json &m){
  const auto path=string(field(m,"sourcePath"));source=&syntax.at(path);if(!setScope(visible.at(path)))return false;initialized.clear();declared.clear();
  const Json fake=Object{{"sourcePath",path},{"returnType","void"},{"parameters",Array{}},{"bindings",Array{}}};current=&fake;
  for(const auto &r:items(field(m,"initialization"))){
    size_t a,b;if(!source->span(field(r,"range"),a,b))return false;
    if(string(field(r,"kind"))=="initialize"){
      if(!model.need(a>0&&(source->tokens[a-1].text=="let"||source->tokens[a-1].text=="const"),"original global declaration prefix differs"))return false;--a;
    }
    if(b<source->tokens.size()&&source->tokens[b].text==";")++b;
    if(!statements(Array{r},a,b))return false;
  }
  return true;
}
bool SourceBodies::setScope(const std::map<std::string,std::string> &from){
  if(!model.spend(from.size()))return false;
  for(const auto &[name,id]:from)if(!model.spend((name.size()+id.size())/8+1))return false;
  scope=from;return true;
}
} // namespace tsfg::commonProgram
