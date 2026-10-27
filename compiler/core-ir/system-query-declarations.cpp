// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::systemQuery {
namespace {
std::string hash(llvm::StringRef domain,const Json &value){return digest(domain.str()+std::string(1,'\0')+canonical(value));}
Json range(const Json &origin){return Object{{"start",field(origin,"start")},{"end",field(origin,"end")}};}
bool nominal(Model &m,const Json &t,std::set<const Json *> &used){
  const auto path=string(field(t,"sourcePath")),id=string(field(t,"id")),kind=string(field(t,"kind"));
  if(!m.need(m.syntax.count(path),"component original source missing"))return false;auto &g=m.grammar(path);const auto &key=field(t,"nominalKey");
  auto *declaration=m.at(path,field(t,"declarationRange"),"KindClassDeclaration");
  if(!declaration||!m.need(same(field(*declaration,"nameRange"),field(t,"nameRange"))&&same(field(*declaration,"name"),field(t,"name")),"nominal metadata is not the original AST class declaration"))return false;
  Array files;for(const auto &f:items(field(field(m.payload(),"program"),"files")))files.push_back(Object{{"path",field(f,"path")},{"sha256",field(f,"sha256")}});
  if(!m.need(id=="nominal:"+hash("tsfg.array-facts.nominal.v8",key).substr(7)&&string(field(key,"sourcePath"))==path&&
    same(field(key,"declarationPath"),Array{field(t,"name")})&&
    string(field(t,"runtimeKey"))==hash("tsfg.array-facts.runtime-class.v8",Object{{"files",std::move(files)},{"nominalKey",key}}),"original nominal/runtime identity differs"))return false;
  // Constructor signatures participate in the shared TypeId even though this
  // route executes no constructor. Derive the selected implicit metadata;
  // never accept an arbitrary Node-supplied signature/access as type authority.
  if(!m.need(field(t,"constructor").getAsNull()&&items(field(t,"methods")).empty(),"Query component callable bodies have no selected Source validation"))return false;
  const auto baseType=string(field(t,"base"));const auto &construction=field(t,"construction");Array initialization;
  for(const auto &f:items(field(t,"fields")))initialization.push_back(field(f,"id"));
  const Json origin=Object{{"source",path},{"start",field(field(t,"declarationRange"),"start")},{"end",field(field(t,"declarationRange"),"end")}};
  const Json signature=Object{{"id",hash("tsfg.array-facts.signature.v8",Object{{"sourcePath",path},{"declarationRange",field(t,"declarationRange")}})},
    {"sourcePath",path},{"declarationRange",field(t,"declarationRange")},{"parameters",Array{}},{"returnType",id}};
  const Json forwarding=baseType.empty()?Json(nullptr):Json(Object{{"target",baseType+".ctor"},{"baseSignature",Object{{"parameters",Array{}},{"return",baseType}}},{"parameters",Array{}},{"origin",origin}});
  if(!m.need(same(construction,Object{{"id",id+".ctor"},{"kind",baseType.empty()?"implicit-base":"implicit-derived"},
    {"access","public"},{"initializationPhase",baseType.empty()?"before-body":"after-successful-super"},{"initializationFields",std::move(initialization)},
    {"parameters",Array{}},{"signature",signature},{"origin",origin},{"implicitForward",forwarding}}),"original implicit construction metadata differs"))return false;
  size_t a,b,n,z;if(!g.span(field(t,"declarationRange"),a,b)||!g.span(field(t,"nameRange"),n,z)||!g.name(field(t,"nameRange"),string(field(t,"name"))))return false;
  std::vector<Json> pieces;std::vector<std::string> header;
  for(auto i=a;i<n;++i){if(!m.spend())return false;pieces.push_back(g.tokens[i].text);header.push_back(g.tokens[i].text);}
  if(!m.need(!header.empty()&&header.back()=="class"&&llvm::all_of(header,[](const auto &s){return llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"@","component","tsfgComponent","tsfgValue","export","default","class"},s);}),"original nominal class header differs"))return false;
  const auto &marker=field(t,"markerOrigin");
  if(!marker.getAsNull()){
    const auto markerName=kind=="value"?"tsfgValue":"tsfgComponent";
    if(!m.need(string(field(key,"category"))==(kind=="value"?"value":"component")&&string(field(marker,"declarationPath"))=="/src/minimal-arrays-v8.d.ts"&&
      string(field(marker,"declarationSha256"))=="sha256:0d30a2f626bb7455decf36f5a7a8d3308d4254100d2cb10e7c0d2353d28b141e"&&string(field(marker,"version"))=="minimal-arrays-v8"&&
      string(field(marker,"contextName"))=="ClassDecoratorContext"&&number(field(marker,"contextArity"))==1&&string(field(marker,"mode"))=="standard"&&
      string(field(marker,"entryId"))==hash("tsfg.array-facts.marker.v8",Object{{"sourcePath",field(marker,"declarationPath")},{"declarationRange",field(marker,"declarationRange")}}),"pinned component marker authority differs"))return false;
    const Json *alias=nullptr;for(const auto &row:items(field(m.payload(),"markerAliases"))){if(!m.spend())return false;
      if(string(field(row,"useSourcePath"))==path&&same(field(row,"useRange"),field(marker,"range"))){if(!m.need(!alias,"ambiguous original component marker alias"))return false;alias=&row;}}
    if(alias){
      if(!m.need(exact(*alias,{"useSourcePath","useRange","declaration","target"})&&same(field(*alias,"declaration"),*m.builtins.at("component"))&&
        string(field(field(*alias,"target"),"sourcePath"))=="/src/minimal-arrays-v8.d.ts"&&string(field(field(*alias,"target"),"name"))==markerName&&
        same(field(field(*alias,"target"),"range"),field(marker,"declarationRange")),"original marker alias target differs")||!m.original(field(*alias,"target"))||
        !g.sequence(field(marker,"range"),{Json("@"),Json("component")})||!m.ownedMarker(path,field(marker,"range"),*m.builtins.at("component")))return false;used.insert(alias);
    }else {
      auto *declaration=m.at(string(field(marker,"declarationPath")),field(marker,"declarationRange"),"KindFunctionDeclaration");if(!declaration)return false;
      const Json expected=Object{{"id",originId(string(field(*declaration,"sourcePath")),field(*declaration,"nameRange"))},{"sourcePath",field(*declaration,"sourcePath")},
        {"kind",field(*declaration,"kind")},{"name",field(*declaration,"name")},{"range",field(*declaration,"range")},{"nameRange",field(*declaration,"nameRange")}};
      if(!g.sequence(field(marker,"range"),{Json("@"),Json(markerName)})||!m.ownedMarker(path,field(marker,"range"),expected))return false;
    }
  }else if(!m.need(kind=="reference"&&string(field(key,"category"))=="reference","nominal marker missing"))return false;
  pieces.push_back(field(t,"nameRange"));const auto base=string(field(t,"base"));
  if(!base.empty()){
    if(!m.need(m.source->types.count(base)&&string(field(*m.source->types.at(base),"kind"))=="reference","unowned original nominal base"))return false;
    pieces.push_back("extends");pieces.push_back(field(*m.source->types.at(base),"name"));
  }
  pieces.push_back("{");std::vector<Json> members;int64_t prior=-1;
  for(const auto &f:items(field(t,"fields"))){
    const auto &origin=field(f,"origin");const auto r=range(origin);size_t fa,fb;
    if(!m.spend()||!m.need(string(field(origin,"source"))==path&&number(field(origin,"start"))>prior&&m.source->types.count(string(field(f,"type"))),"ordered original field source/type differs")||!g.span(r,fa,fb))return false;
    prior=number(field(origin,"start"));size_t cursor=fa;bool readonly=false;std::string access="public";std::vector<Json> fp;
    while(cursor<fb&&llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"readonly","public","private","protected","declare"},g.tokens[cursor].text)){
      const auto token=g.tokens[cursor++].text;if(token=="readonly")readonly=true;else if(token!="declare")access=token;fp.push_back(token);}
    if(!m.need(cursor<fb&&g.tokens[cursor].text==string(field(f,"name"))&&field(f,"readonly").getAsBoolean()==readonly&&string(field(f,"access"))==access,"original field spelling/access/readonly differs"))return false;
    const Json nameRange=Object{{"start",int64_t(g.tokens[cursor].start)},{"end",int64_t(g.tokens[cursor].end)}};
    if(!g.name(nameRange,string(field(f,"name")))||!m.need(string(field(f,"id"))==hash("tsfg.array-facts.field.v8",Object{{"sourcePath",path},{"nameRange",nameRange}}),"original Field ID differs"))return false;
    fp.push_back(nameRange);if(!m.need(++cursor<fb&&g.tokens[cursor++].text==":","original field annotation missing"))return false;
    size_t end=fb;if(g.tokens[end-1].text==";")--end;const auto &initializer=field(f,"initializer");
    if(!initializer.getAsNull()){
      size_t ia,ib;if(!g.span(field(initializer,"range"),ia,ib)||!m.need(ia>cursor&&g.tokens[ia-1].text=="="&&same(field(initializer,"type"),field(f,"type"))&&same(field(initializer,"flowType"),field(f,"type"))&&field(initializer,"compatibilityRoots").getAsNull(),"fixed field initializer type/punctuation differs")||!verifySourceLiteral(g,initializer))return false;end=ia-1;
    }
    if(!m.need(cursor<end,"original field type range missing"))return false;
    const Json annotation=Object{{"start",int64_t(g.tokens[cursor].start)},{"end",int64_t(g.tokens[end-1].end)}};
    if(!m.annotation(path,annotation,string(field(f,"type"))))return false;fp.push_back(":");fp.push_back(annotation);
    if(!initializer.getAsNull()){fp.push_back("=");fp.push_back(field(initializer,"range"));}
    if(!g.sequence(r,fp,true))return false;members.push_back(r);
  }
  std::sort(members.begin(),members.end(),[](const Json &x,const Json &y){return number(field(x,"start"))<number(field(y,"start"));});
  for(const auto &r:members)pieces.push_back(r);pieces.push_back("}");return g.sequence(field(t,"declarationRange"),pieces);
}
}
bool Model::declarations(){
  if(!need(source->functions.empty(),"Query component callable metadata has no selected Source body validation"))return false;
  constexpr llvm::StringLiteral names[]={"component","system","Query","Read","Write"};
  const auto &rows=items(field(payload(),"builtins"));if(!need(field(payload(),"builtins").getAsArray()&&rows.size()==5,"complete builtin inventory differs"))return false;
  for(size_t i=0;i<5;++i){const auto &row=rows[i];if(!original(row)||!need(string(field(row,"name"))==names[i]&&string(field(row,"sourcePath"))=="/src/system-query-context.d.ts"&&
    string(field(row,"kind"))==(i==0?"KindVariableDeclaration":i==1?"KindFunctionDeclaration":i>=3?"KindTypeAliasDeclaration":"KindInterfaceDeclaration"),"owned builtin declaration differs"))return false;builtins.emplace(names[i].str(),&row);}
  std::set<const Json *> used;std::string previous;
  for(const auto &t:items(field(payload(),"types"))){const auto id=string(field(t,"id")),kind=string(field(t,"kind"));
    if(!spend()||!need(previous.empty()||previous<id,"original type order differs"))return false;previous=id;
    if(kind=="value"||kind=="reference"){if(!nominal(*this,t,used))return false;}
    else if(kind=="scalar"){
      if(!need(id==string(field(t,"name"))&&string(field(t,"sourcePath"))=="/src/minimal-arrays-v8.d.ts"&&field(t,"constructor").getAsNull(),"pinned scalar identity differs"))return false;
      auto *node=at(string(field(t,"sourcePath")),field(t,"declarationRange"));if(!node||!need(same(field(*node,"nameRange"),field(t,"nameRange")),"pinned scalar declaration differs"))return false;
    }else if(kind=="void"||kind=="undefined"||kind=="unknown"||kind=="null"){
      if(!need(id==kind&&field(t,"constructor").getAsNull(),"absence type identity differs"))return false;
    }else return need(false,"Query type context has unsupported non-fixed declaration");
  }
  return need(field(payload(),"markerAliases").getAsArray()&&used.size()==items(field(payload(),"markerAliases")).size(),"unbound original component marker alias");
}
bool Model::bodies(){
  const auto &rows=items(field(payload(),"systems"));if(!need(field(payload(),"systems").getAsArray()&&!rows.empty()&&rows.size()<=4096,"complete system inventory required"))return false;
  std::set<std::string> ids;
  for(const auto &raw:rows){
    if(!spend()||!need(exact(raw,{"declaration","markerRange","marker","signature","parameters","returnType","bodyRange","loops"}),"system boundary differs"))return false;
    const auto &decl=field(raw,"declaration");auto *node=original(decl);const auto path=string(field(decl,"sourcePath"));
    if(!node||!need(string(field(decl,"kind"))=="KindFunctionDeclaration"&&!llvm::StringRef(path).ends_with(".d.ts")&&
      ids.insert(string(field(decl,"id"))).second&&same(field(raw,"signature"),decl)&&same(field(raw,"marker"),*builtins.at("system")),"original system declaration/signature differs"))return false;
    error.path=path;error.range={uint32_t(number(field(field(decl,"range"),"start"))),uint32_t(number(field(field(decl,"range"),"end")))};
    auto &g=grammar(path);if(!g.sequence(field(raw,"markerRange"),{Json("@"),Json("system")})||!ownedMarker(path,field(raw,"markerRange"),*builtins.at("system")))return false;
    std::vector<const Json *> parameters;const Json *body=nullptr,*returned=nullptr;
    for(auto *child:children[string(field(*node,"id"))]){const auto kind=string(field(*child,"kind"));
      if(kind=="KindParameter")parameters.push_back(child);else if(kind=="KindBlock")body=child;}
    if(!need(body&&field(raw,"parameters").getAsArray()&&parameters.size()==items(field(raw,"parameters")).size()&&same(field(raw,"bodyRange"),field(*body,"range"))&&string(field(raw,"returnType"))=="void","complete void system signature/body differs"))return false;
    const auto last=parameters.empty()?number(field(field(decl,"nameRange"),"end")):number(field(field(*parameters.back(),"range"),"end"));
    for(auto *child:children[string(field(*node,"id"))])if(string(field(*child,"kind"))!="KindParameter"&&number(field(field(*child,"range"),"start"))>=last&&number(field(field(*child,"range"),"end"))<=number(field(field(*body,"range"),"start")))returned=child;
    if(!need(returned,"original return annotation missing")||!annotation(path,field(*returned,"range"),"void"))return false;
    System system;system.raw=&raw;Array signatureTypes;bool hasQuery=false;
    for(size_t i=0;i<parameters.size();++i){const auto &parameter=items(field(raw,"parameters"))[i],&binding=field(parameter,"binding"),&query=field(parameter,"query");
      auto *originalParameter=original(binding);
      if(!need(exact(parameter,{"index","binding","annotationRange","logicalType","query","view"})&&field(parameter,"view").getAsNull()&&number(field(parameter,"index"))==int64_t(i)&&originalParameter==parameters[i],"original system parameter order differs")||
        !g.sequence(field(binding,"range"),{field(binding,"nameRange"),Json(":"),field(parameter,"annotationRange")}))return false;
      Parameter checked;checked.raw=&parameter;const auto logical=string(field(parameter,"logicalType"));
      if(query.getAsNull()){
        if(!need(source->types.count(logical)&&string(field(*source->types.at(logical),"kind"))=="scalar","ordinary Query parameter must have a selected scalar type")||!annotation(path,field(parameter,"annotationRange"),logical))return false;checked.type=source->typeIds.at(logical);
      }else {if(!need(logical=="Query","Query parameter logical identity differs")||!selection(query,path,field(parameter,"annotationRange")))return false;checked.selection=selectionId(query);checked.type=checked.selection;hasQuery=true;}
      signatureTypes.push_back(checked.type);system.parameters.push_back(std::move(checked));
    }
    if(!need(hasQuery,"system has no original Query parameter"))return false;
    const Json signature=Object{{"parameters",std::move(signatureTypes)},{"returns",source->typeIds.at("void")}};
    system.signature=hash("tsfg.module-callable-signature.candidate.v1",signature);
    system.id=hash("tsfg.module-callable-function.candidate.v1",Object{{"path",path},{"name",canonical(Object{{"path",Array{}},{"kind","function"},{"name",field(decl,"name")}})},{"signatureHash",system.signature}});
    size_t a,b,n,z;if(!g.span(field(decl,"range"),a,b)||!g.span(field(decl,"nameRange"),n,z))return false;
    std::vector<Json> pieces;std::vector<std::string> prefix;for(auto i=a;i<n;++i){pieces.push_back(g.tokens[i].text);prefix.push_back(g.tokens[i].text);}
    if(!need(prefix==std::vector<std::string>{"@","system","function"}||prefix==std::vector<std::string>{"@","system","export","function"}||prefix==std::vector<std::string>{"@","system","export","default","function"},"system declaration prefix has unsupported semantics"))return false;
    pieces.push_back(field(decl,"nameRange"));pieces.push_back("(");
    for(size_t i=0;i<parameters.size();++i){if(i)pieces.push_back(",");pieces.push_back(field(*parameters[i],"range"));}pieces.push_back(")");pieces.push_back(":");pieces.push_back(field(*returned,"range"));pieces.push_back(field(*body,"range"));
    if(!g.sequence(field(decl,"range"),pieces)||!need(field(raw,"loops").getAsArray()&&items(field(raw,"loops")).size()==children[string(field(*body,"id"))].size(),"complete original system body differs"))return false;
    std::vector<Json> bodyPieces{Json("{")};size_t index=0;
    for(const auto &l:items(field(raw,"loops"))){if(!loop(l,*children[string(field(*body,"id"))][index++],raw,system.parameters))return false;bodyPieces.push_back(field(l,"range"));}
    bodyPieces.push_back("}");if(!g.sequence(field(*body,"range"),bodyPieces))return false;systems.push_back(std::move(system));
  }
  return inventory();
}
} // namespace tsfg::systemQuery
