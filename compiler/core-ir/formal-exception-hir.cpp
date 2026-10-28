// SPDX-License-Identifier: MIT
#include "formal-exception-source.h"
#include "dialect.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::formalException {
std::string SourceProof::type(const Json &raw,llvm::StringRef key){
  if(!p.step()||!p.require(raw.getAsObject(),"typed Source record"))return {};
  const auto name=string(field(raw,key));std::string result;
  const auto &presence=field(raw,key=="returnType"?"returnPresence":raw.getAsObject()->get("presenceFlow")?"presenceFlow":"presence");
  const unsigned mask=(field(presence,"undefined").getAsBoolean()==true?1:0)|(field(presence,"null").getAsBoolean()==true?2:0);
  if(mask){
    const auto base=digest(std::string("tsfg.type\0",10)+"i32");
    if(!p.require(name=="i32"&&p.types.count(base),"nullable base type"))return {};usedTypes.insert(base);
    result=hirIdentity("type",Object{{"kind","nullable"},{"base",base},{"mask",int64_t(mask)}});
  }else if(name=="unknown")result=hirIdentity("type",Object{{"kind","unknown"}});
  else if(name=="function"){
    const auto &signature=field(raw,key=="returnType"?"returnSignature":"signature");Array parameters;
    for(const auto &name:items(field(signature,"parameters")))parameters.push_back(type(Object{{"type",name}}));
    const auto returned=type(Object{{"type",field(signature,"returnType")}});
    result=hirIdentity("type",Object{{"kind","callable"},{"parameters",std::move(parameters)},{"returnType",returned}});
  }else if(nominalTypes.count(name))result=nominalTypes.at(name);
  else result=digest(std::string("tsfg.type\0",10)+name);
  if(!p.require(p.types.count(result),"Source type has no exact owned HIR identity"))return {};
  usedTypes.insert(result);return result;
}
bool SourceProof::types(){
  const auto &table=items(field(p.hir,"types"));
  if(!p.require(!table.empty()&&table.size()<=4096,"complete type table"))return false;
  for(const auto &t:table){const auto id=string(field(t,"id"));
    if(!p.step()||!p.require(t.getAsObject()&&p.types.emplace(id,&t).second,"duplicate type identity"))return false;}
  for(const auto &[id,t]:p.types){
    const auto kind=string(field(*t,"kind"));Object record=*t->getAsObject();record.erase("id");
    if(kind=="scalar"){
      if(!p.require(exception::exact(*t,{"id","kind","name"}),"scalar metadata"))return false;
      const auto name=string(field(*t,"name"));
      if(!p.require(llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"bool","i8","i16","i32","i64","u8","u16","u32","u64","isize","usize","f32","f64"},name)
        &&id==digest(std::string("tsfg.type\0",10)+name),"scalar type identity"))return false;
    }else if(kind=="unknown"){
      if(!p.require(exception::exact(*t,{"id","kind"})&&id==hirIdentity("type",Json(std::move(record))),"unknown type identity"))return false;
    }else if(kind=="nullable"){
      const auto mask=field(*t,"mask").getAsInteger();
      if(!p.require(exception::exact(*t,{"id","kind","base","mask"})&&mask&&*mask>=1&&*mask<=3
        &&string(field(*t,"base"))==digest(std::string("tsfg.type\0",10)+"i32")
        &&id==hirIdentity("type",Json(std::move(record)))&&p.types.count(string(field(*t,"base"))),"nullable identity"))return false;
    }else if(kind=="callable"){
      if(!p.require(exception::exact(*t,{"id","kind","parameters","returnType"})&&field(*t,"parameters").getAsArray()
        &&items(field(*t,"parameters")).size()<=64&&p.types.count(string(field(*t,"returnType")))
        &&id==hirIdentity("type",Json(std::move(record))),"callable signature identity"))return false;
      for(const auto &argument:items(field(*t,"parameters")))if(!p.require(p.types.count(string(argument)),"callable argument type"))return false;
    }else if(kind!="aggregate")return p.require(false,"unrecognized HIR type category");
  }
  const auto &raw=field(facts,"aggregateFacts");std::set<std::string> nominal;
  for(const auto &d:items(field(raw,"declarations"))){
    const auto sourcePath=string(field(field(d,"nominalKey"),"sourcePath"));
    auto source=std::find_if(items(field(p.hir,"sources")).begin(),items(field(p.hir,"sources")).end(),[&](const Json &s){return string(field(s,"path"))==sourcePath;});
    if(!p.require(source!=items(field(p.hir,"sources")).end(),"nominal defining source"))return false;
    const auto category=string(field(d,"category"));
    const auto id=hirIdentity("type",Object{{"kind","aggregate"},{"source",Object{{"path",sourcePath},{"digest",field(*source,"hash")}}},
      {"category",category},{"declarationPath",field(field(d,"nominalKey"),"declarationPath")}});
    auto found=p.types.find(id);
    if(!p.require(found!=p.types.end()&&nominal.insert(id).second&&nominalTypes.emplace(string(field(d,"id")),id).second,"nominal identity"))return false;
    usedTypes.insert(id);const auto &t=*found->second;
    if(!nominalSource(d))return false;
    for(auto key:{"category","name","range","bodyRange","nominalKey","markerOrigin","noInheritance"})
      if(!p.require(equal(field(d,key),field(t,key)),"nominal metadata differs from original declaration"))return false;
    if(!p.require((category=="value"||category=="component")&&field(d,"noInheritance").getAsBoolean()==true
      &&items(field(d,"fields")).size()==items(field(t,"fields")).size(),"nominal category or members"))return false;
    for(size_t i=0;i<items(field(d,"fields")).size();++i){
      const auto &rawField=items(field(d,"fields"))[i],&f=items(field(t,"fields"))[i];const auto fieldId=hirIdentity("field",Object{{"owner",id},{"ordinal",int64_t(i)}});
      if(!p.require(string(field(f,"id"))==fieldId&&string(field(f,"owner"))==id&&field(f,"ordinal").getAsInteger()==int64_t(i)
        &&fields.emplace(string(field(rawField,"id")),fieldId).second&&type(rawField)==string(field(f,"type")),"field identity or type"))return false;
      for(auto key:{"name","readonly","access","optionalSyntax","definiteAssertionSyntax","range"})
        if(!p.require(equal(field(rawField,key),field(f,key)),"field metadata"))return false;
      const auto &initial=field(rawField,"initializer"),&h=field(f,"initializer");
      if(!p.require(string(field(initial,"kind"))=="boolean"&&string(field(h,"kind"))=="boolean"
        &&field(initial,"boolean").getAsBoolean()==field(h,"value").getAsBoolean()&&equal(field(initial,"range"),field(h,"range"))
        &&type(initial)==string(field(h,"type")),"field initializer"))return false;
    }
    const auto &rawCtors=items(field(d,"constructors")),&ctors=items(field(t,"constructors"));
    if(!p.require(rawCtors.size()==1&&ctors.size()==1,"complete constructor table"))return false;
    const auto signature=hirIdentity("signature",Object{{"parameters",Array{}},{"returnType",id}}),
      callable=hirIdentity("type",Object{{"kind","callable"},{"parameters",Array{}},{"returnType",id}}),
      constructor=hirIdentity("constructor",Object{{"owner",id},{"ordinal",0},{"signatureHash",signature}});
    const auto &c=ctors[0],&r=rawCtors[0];
    if(!p.require(string(field(r,"kind"))=="implicitDefault"&&string(field(c,"kind"))=="implicitDefault"
      &&string(field(c,"id"))==constructor&&string(field(c,"owner"))==id&&string(field(c,"type"))==callable
      &&string(field(c,"signatureHash"))==signature&&items(field(c,"parameters")).empty()&&items(field(r,"parameters")).empty()
      &&items(field(c,"body")).empty()&&items(field(r,"body")).empty()&&equal(field(r,"range"),field(c,"range"))
      &&constructors.emplace(string(field(r,"id")),constructor).second&&p.types.count(callable),"implicit constructor identity"))return false;
    usedTypes.insert(callable);
  }
  size_t count=0;for(const auto &[id,t]:p.types)if(string(field(*t,"kind"))=="aggregate")++count;
  return p.require(count==nominal.size(),"extra or omitted nominal type");
}
bool SourceProof::nominalSource(const Json &raw){
  const auto path=string(field(field(raw,"nominalKey"),"sourcePath"));const auto owned=sources.find(path);
  const auto definition=symbols.find(string(field(raw,"symbol")));
  if(!p.require(owned!=sources.end()&&definition!=symbols.end()&&string(field(*definition->second,"kind"))=="class"
    &&string(field(*definition->second,"name"))==string(field(raw,"name")),"nominal actual Source declaration"))return false;
  auto *saved=source;source=&owned->second;uint32_t begin,end;
  if(!source->range(field(raw,"range"),begin,end,p))return false;size_t at=0;
  while(at<source->tokens.size()&&source->tokens[at].end<=begin)++at;const auto first=at;
  if(!source->expect(at,"@",p)||!source->expect(at,string(field(raw,"category"))=="value"?"tsfgValue":"tsfgComponent",p)
    ||!source->span(field(field(raw,"markerOrigin"),"range"),first,at-1,p,false)
    ||!source->expect(at,"class",p)||!source->name(at,string(field(raw,"name")),field(*definition->second,"range"),p))return false;
  const auto body=at;if(!source->expect(at,"{",p))return false;
  for(const auto &f:items(field(raw,"fields"))){
    if(!p.step())return false;const auto first=at;const auto symbol=symbols.find(string(field(f,"symbol")));
    if(!p.require(symbol!=symbols.end()&&string(field(*symbol->second,"kind"))=="field"
      &&string(field(*symbol->second,"name"))==string(field(f,"name"))&&type(*symbol->second)==type(f)
      &&field(*symbol->second,"writable").getAsBoolean()==(field(f,"readonly").getAsBoolean()==false),"actual field symbol/type/permission"))return false;
    std::string access="public";if(source->spelling(at)=="public"||source->spelling(at)=="private"||source->spelling(at)=="protected")access=source->spelling(at++).str();
    const bool readonly=source->spelling(at)=="readonly";if(readonly)++at;
    if(!p.require(string(field(f,"access"))==access&&field(f,"readonly").getAsBoolean()==readonly
      &&field(f,"optionalSyntax").getAsBoolean()==false&&field(f,"definiteAssertionSyntax").getAsBoolean()==false,"Source field modifiers")
      ||!source->name(at,string(field(f,"name")),field(*symbol->second,"range"),p)
      ||!source->expect(at,":",p)||!annotation(at,f)||!source->expect(at,"=",p))return false;
    const auto &initial=field(f,"initializer");const auto literal=at;
    if(!p.require(string(field(initial,"kind"))=="boolean"&&field(initial,"boolean").getAsBoolean().has_value(),"actual field initializer")
      ||!source->expect(at,field(initial,"boolean").getAsBoolean()==true?"true":"false",p)
      ||!source->span(field(initial,"range"),literal,literal,p)||!separator(at)
      ||!source->span(field(f,"range"),first,at-1,p,false))return false;
  }
  if(!source->expect(at,"}",p)||!source->span(field(raw,"bodyRange"),body,at-1,p,false)
    ||!source->span(field(raw,"range"),first,at-1,p,false))return false;
  source=saved;return true;
}
bool SourceProof::modules(){
  const auto &owned=items(field(p.hir,"modules")),&groups=items(field(snapshot,"exports")),&ownedSources=items(field(snapshot,"sources"));
  if(!p.require(owned.size()==ownedSources.size()&&groups.size()==ownedSources.size(),"whole source/module ownership"))return false;
  for(size_t i=0;i<owned.size();++i){const auto &m=owned[i],&s=ownedSources[i],&g=groups[i];
    const auto path=string(field(s,"path")),id=hirIdentity("module",Object{{"source",Object{{"path",path},{"digest",field(s,"hash")}}},{"external",field(g,"external")}});
    if(!p.require(string(field(g,"sourcePath"))==path&&string(field(m,"sourcePath"))==path
      &&string(field(m,"id"))==id&&equal(field(m,"external"),field(g,"external"))&&p.modules.emplace(id,&m).second,"module identity"))return false;
    const auto scope=hirIdentity("scope",Object{{"ownerKind","module"},{"owner",id},{"path",Array{}}});
    Array expectedFunctions;
    for(const auto &f:items(field(p.hir,"functions")))if(string(field(f,"sourcePath"))==path)expectedFunctions.push_back(field(f,"id"));
    if(!p.require(equal(field(m,"functions"),Json(std::move(expectedFunctions)))&&items(field(m,"globals")).empty(),"complete module functions/storage"))return false;
    const auto &exports=items(field(p.hir,"exports"));if(!p.require(exports.size()==owned.size(),"whole export groups"))return false;
    Array actualExports;
    const auto &text=sources.at(path);
    for(const auto &[rawId,raw]:rawFunctions){const auto fn=p.functions.find(p.rawFunctions.at(rawId));
      if(fn==p.functions.end()||string(field(*fn->second,"sourcePath"))!=path||!field(*raw,"lexicalParent").getAsNull())continue;
      uint32_t a,b;if(!text.range(field(*raw,"range"),a,b,p))return false;size_t token=0;
      while(token<text.tokens.size()&&text.tokens[token].end<=a)++token;
      if(text.spelling(token)=="export")actualExports.push_back(Object{{"name",field(*raw,"name")},{"target",rawId},
        {"sourcePath",path},{"range",field(*raw,"range")},{"definition",field(*fn->second,"nameRange")}});
    }
    std::sort(actualExports.begin(),actualExports.end(),[](const Json &a,const Json &b){return string(field(a,"name"))<string(field(b,"name"));});
    if(!p.require(equal(field(g,"bindings"),Json(std::move(actualExports))),"complete actual Source exports"))return false;
    auto projected=g;
    auto *bindings=projected.getAsObject()->getArray("bindings");if(!p.require(bool(bindings),"export bindings"))return false;
    for(auto &b:*bindings){auto target=p.rawFunctions.find(string(field(b,"target")));
      if(!p.require(target!=p.rawFunctions.end(),"export targets an unowned function"))return false;
      (*b.getAsObject())["target"]=target->second;}
    (*projected.getAsObject())["module"]=id;
    if(!p.require(equal(projected,exports[i]),"actual export/function relation"))return false;
    const auto &rawModules=items(field(facts,"modules"));
    if(rawModules.empty()){
      if(!p.require(items(field(m,"imports")).empty()&&field(m,"initialization").getAsNull()
        &&field(m,"closure").getAsNull(),"invented module initialization/import"))return false;
    }else{
      if(!p.require(rawModules.size()==owned.size(),"complete defining module facts"))return false;
      const auto &raw=rawModules[i];
      if(!p.require(string(field(raw,"sourcePath"))==path&&equal(field(raw,"external"),field(m,"external"))
        &&items(field(raw,"globals")).empty()&&field(m,"initialization").getAsObject(),"actual module initialization"))return false;
      const auto &initial=field(m,"initialization");
      if(!p.require(string(field(initial,"scope"))==scope&&field(raw,"external").getAsBoolean()==true
        &&equal(field(initial,"range"),Object{{"start",0},{"end",int64_t(text.content.size())}}),"module root scope and whole-source range"))return false;
      Array imports;
      for(const auto &edge:items(field(raw,"imports"))){
        const auto sourcePath=string(field(edge,"sourcePath"));const auto defining=sources.find(sourcePath);
        if(!p.require(defining!=sources.end()&&string(field(edge,"kind"))=="import","owned defining import module"))return false;
        Array imported;
        for(const auto &binding:items(field(edge,"bindings"))){const auto target=p.rawFunctions.find(string(field(binding,"target")));
          if(!p.require(target!=p.rawFunctions.end()&&string(field(*p.functions.at(target->second),"sourcePath"))==sourcePath,
            "import target defining function"))return false;
          imported.push_back(Object{{"name",field(binding,"name")},{"target",target->second},{"range",field(binding,"range")}});
        }
        const auto targetModule=std::find_if(owned.begin(),owned.end(),[&](const Json &value){return string(field(value,"sourcePath"))==sourcePath;});
        if(!p.require(targetModule!=owned.end(),"missing defining module"))return false;
        imports.push_back(Object{{"specifier",field(edge,"specifier")},{"sourcePath",sourcePath},{"module",field(*targetModule,"id")},
          {"range",field(edge,"range")},{"bindings",std::move(imported)}});
      }
      if(!p.require(equal(field(m,"imports"),Json(std::move(imports))),"complete independently mapped imports"))return false;
    }
    const auto &configuration=field(field(snapshot,"identityInput"),"compilationClosure");
    if(configuration.getAsNull()){if(!p.require(bool(field(m,"closure").getAsNull()),"invented embedding roots"))return false;}
    else{
      if(!p.require(exception::exact(configuration,{"roots","requiredRoots"})&&!items(field(configuration,"roots")).empty()
        &&items(field(configuration,"roots")).size()<=128&&items(field(configuration,"requiredRoots")).size()<=128,"embedding root bounds"))return false;
      Object closure;
      std::set<std::string> roots;
      for(const auto &r:items(field(configuration,"roots")))roots.insert(canonical(r));
      for(const auto key:{"roots","requiredRoots"}){Array mapped;std::string previous;
        for(const auto &r:items(field(configuration,key))){const auto kind=string(field(r,"kind")),sourcePath=string(field(r,"sourcePath")),name=string(field(r,"name"));
          const std::set<std::string> kinds={"application","module-initialization","host-export","host-callback","hot-function","kernel"};
          const auto tuple=kind+std::string(1,'\0')+sourcePath+std::string(1,'\0')+name;
          if(!p.step()||!p.require(exception::exact(r,{"kind","sourcePath","name"})&&kinds.count(kind)&&sources.count(sourcePath)
            &&!name.empty()&&name.find('\0')==std::string::npos&&(previous.empty()||previous<tuple)
            &&(llvm::StringRef(key)!="requiredRoots"||roots.count(canonical(r))),"exact ordered embedding root contract"))return false;previous=tuple;
          if(sourcePath!=path)continue;
          std::string target;
          if(kind=="module-initialization"){if(!p.require(name=="$moduleInit","initialization root name"))return false;target=id;}
          else for(const auto &f:items(field(p.hir,"functions")))if(string(field(f,"sourcePath"))==path&&field(f,"lexicalParent").getAsNull()
            &&string(field(f,"name"))==name){if(!p.require(target.empty(),"ambiguous root function"))return false;target=string(field(f,"id"));}
          if(!p.require(!target.empty(),"root lacks an actual same-source function"))return false;
          mapped.push_back(Object{{"kind",kind},{"sourcePath",path},{"name",name},{"target",target}});
        }closure[key]=std::move(mapped);
      }
      if(!p.require(equal(field(m,"closure"),Json(std::move(closure))),"complete resolved embedding roots"))return false;
    }
  }
  return true;
}
bool SourceProof::moduleDeclarations(size_t &at){
  while(at<source->tokens.size()){
    if(!p.step())return false;bool skipped=false;
    for(const auto &[rawId,raw]:rawFunctions){const auto &h=*p.functions.at(p.rawFunctions.at(rawId));
      if(string(field(h,"sourcePath"))!=currentSource||!field(*raw,"lexicalParent").getAsNull())continue;
      uint32_t a,b;if(!source->range(field(*raw,"range"),a,b,p))return false;
      if(source->tokens[at].start>=a&&source->tokens[at].end<=b){while(at<source->tokens.size()&&source->tokens[at].end<=b)++at;skipped=true;break;}
    }
    if(skipped)continue;if(source->spelling(at)!="import")return true;
    const Json *edge=nullptr;
    for(const auto &m:items(field(facts,"modules")))if(string(field(m,"sourcePath"))==currentSource)
      for(const auto &e:items(field(m,"imports"))){uint32_t a,b;if(!source->range(field(e,"range"),a,b,p))return false;
        if(source->tokens[at].start>=a&&source->tokens[at].end<=b){if(!p.require(!edge,"ambiguous import declaration"))return false;edge=&e;}}
    if(!p.require(edge&&!items(field(*edge,"bindings")).empty(),"Source import has no complete owned fact"))return false;
    const auto first=at;if(!source->expect(at,"import",p)||!source->expect(at,"{",p))return false;
    size_t ordinal=0;
    for(const auto &binding:items(field(*edge,"bindings"))){if(ordinal++&&!source->expect(at,",",p))return false;
      const auto raw=rawFunctions.find(string(field(binding,"target")));if(!p.require(raw!=rawFunctions.end(),"import target declaration"))return false;
      const auto imported=source->spelling(at).str(),name=string(field(binding,"name"));
      bool exported=false;for(const auto &g:items(field(snapshot,"exports")))if(string(field(g,"sourcePath"))==string(field(*edge,"sourcePath")))
        for(const auto &b:items(field(g,"bindings")))if(string(field(b,"name"))==imported&&string(field(b,"target"))==string(field(binding,"target")))exported=true;
      if(!p.require(exported,"named import must name the actual exported function"))return false;
      if(source->spelling(at+1)=="as"){at+=2;if(!source->name(at,name,field(binding,"range"),p,true))return false;}
      else if(!source->name(at,name,field(binding,"range"),p,true))return false;
    }
    if(source->spelling(at)==",")++at;
    if(!source->expect(at,"}",p)||!source->expect(at,"from",p))return false;
    const auto specifier=string(field(*edge,"specifier"));const auto literal=source->spelling(at);
    if(!p.require((literal=="\""+specifier+"\""||literal=="'"+specifier+"'")&&specifier.find('\\')==std::string::npos
      &&(llvm::StringRef(specifier).starts_with("./")||llvm::StringRef(specifier).starts_with("../")),"actual relative module literal"))return false;
    ++at;
    std::vector<std::string> components;llvm::StringRef path(currentSource);const auto slash=path.find_last_of('/');
    const auto combined=(path.take_front(slash+1)+specifier).str();llvm::StringRef remaining(combined);
    while(!remaining.empty()){auto split=remaining.split('/');remaining=split.second;const auto part=split.first;
      if(part.empty()||part==".")continue;if(part==".."){if(!p.require(!components.empty(),"import escapes logical root"))return false;components.pop_back();}
      else components.push_back(part.str());}
    std::string logical;for(const auto &part:components)logical+="/"+part;
    std::set<std::string> candidates;for(const auto &candidate:{logical,logical+".ts",logical+"/index.ts",
      llvm::StringRef(logical).ends_with(".js")?logical.substr(0,logical.size()-3)+".ts":logical})if(sources.count(candidate))candidates.insert(candidate);
    if(!p.require(candidates.size()==1&&*candidates.begin()==string(field(*edge,"sourcePath")),"relative import resolution differs from supplied sources"))return false;
    if(source->spelling(at)==";")++at;if(!source->span(field(*edge,"range"),first,at-1,p))return false;
  }
  return true;
}
bool SourceProof::run(){
  if(!p.require(field(facts,"status").getAsString()=="ok"&&field(facts,"functions").getAsArray()
    &&field(facts,"symbols").getAsArray(),"complete Source facts tables"))return false;
  for(const auto &s:items(field(snapshot,"sources"))){SourceText text;
    if(!text.read(string(field(s,"content")),p)||!p.require(sources.emplace(string(field(s,"path")),std::move(text)).second,"source ownership"))return false;}
  for(const auto &s:items(field(facts,"symbols")))if(!p.require(s.getAsObject()&&symbols.emplace(string(field(s,"id")),&s).second,"duplicate original symbol"))return false;
  const auto &raw=items(field(facts,"functions")),&hir=items(field(p.hir,"functions"));
  if(!p.require(!raw.empty()&&raw.size()==hir.size()&&raw.size()<=512,"complete owned function table"))return false;
  for(size_t i=0;i<raw.size();++i){
    if(!p.require(rawFunctions.emplace(string(field(raw[i],"symbol")),&raw[i]).second
      &&p.functions.emplace(string(field(hir[i],"id")),&hir[i]).second
      &&p.rawFunctions.emplace(string(field(raw[i],"symbol")),string(field(hir[i],"id"))).second,"function table identity"))return false;
  }
  if(!types()||!modules())return false;
  for(size_t i=0;i<raw.size();++i)if(field(raw[i],"lexicalParent").getAsNull())if(!function(raw[i],hir[i],SourceScope{}))return false;
  if(items(field(facts,"modules")).empty())for(const auto &[path,text]:sources){
    std::vector<std::pair<uint32_t,uint32_t>> covered;
    auto cover=[&](const Json &range){uint32_t a,b;if(!text.range(range,a,b,p))return false;covered.emplace_back(a,b);return true;};
    for(size_t i=0;i<raw.size();++i)if(field(raw[i],"lexicalParent").getAsNull()&&string(field(hir[i],"sourcePath"))==path)
      if(!cover(field(raw[i],"range")))return false;
    for(const auto &decl:items(field(field(facts,"aggregateFacts"),"declarations")))
      if(string(field(field(decl,"nominalKey"),"sourcePath"))==path&&!cover(field(decl,"range")))return false;
    for(const auto &token:text.tokens){
      if(!p.step())return false;
      if(!p.require(std::any_of(covered.begin(),covered.end(),[&](const auto &r){return token.start>=r.first&&token.end<=r.second;}),
        "Source contains an omitted top-level declaration or statement"))return false;
    }
  }
  for(size_t i=0;i<items(field(facts,"modules")).size();++i){
    const auto &raw=items(field(facts,"modules"))[i],&m=items(field(p.hir,"modules"))[i];
    currentOwner=string(field(m,"id"));currentSource=string(field(m,"sourcePath"));source=&sources.at(currentSource);
    SourceScope scope;scope.role="module";size_t index=0;
    if(!region(items(field(raw,"initialization")),field(m,"initialization"),scope,index,false))return false;
  }
  return p.require(claimedFunctions.size()==rawFunctions.size()&&usedTypes.size()==p.types.size(),"unprojected function or extra semantic type");
}
}
