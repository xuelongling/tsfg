// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::systemQuery {
namespace {
using Env=std::map<std::string,const Json *>;
struct Resolved {const Json *node=nullptr;Env env;};
struct Proof {
  Model &m;const Json &traces;size_t cursor=0;
  std::vector<const Json *> child(const Json &n){return m.children[string(field(n,"id"))];}
  Json origin(const Json &n){const auto &r=field(n,"nameRange").getAsNull()?field(n,"range"):field(n,"nameRange");
    return Object{{"id",originId(string(field(n,"sourcePath")),r)},{"kind",field(n,"kind")},{"sourcePath",field(n,"sourcePath")},
      {"name",field(n,"name")},{"range",field(n,"range")},{"nameRange",r}};}
  bool declaration(const Json &n,bool values=false){
    const auto kind=string(field(n,"kind"));
    return values?llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"KindFunctionDeclaration","KindVariableDeclaration","KindBindingElement","KindClassDeclaration","KindEnumDeclaration","KindModuleDeclaration","KindImportEqualsDeclaration"},kind):
      llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"KindTypeParameter","KindTypeAliasDeclaration","KindClassDeclaration","KindInterfaceDeclaration","KindImportEqualsDeclaration"},kind);
  }
  std::vector<const Json *> declarations(const Json &scope,bool values){
    std::vector<const Json *> rows;
    for(auto *n:child(scope)){
      if(!m.spend())return {};
      std::string name;
      if((declaration(*n,true)||declaration(*n,false)||string(field(scope,"kind"))=="KindSourceFile")&&!m.sourceName(*n,name))return {};
      if(declaration(*n,values))rows.push_back(n);
      if(values&&string(field(*n,"kind"))=="KindVariableStatement")for(auto *list:child(*n))if(string(field(*list,"kind"))=="KindVariableDeclarationList")
        for(auto *decl:child(*list)){
          std::vector<const Json *> pending{decl};while(!pending.empty()){
            if(!m.spend())return {};auto *binding=pending.back();pending.pop_back();if(declaration(*binding,true)){
              if(!m.sourceName(*binding,name))return {};rows.push_back(binding);}
            for(auto *nested:child(*binding)){const auto kind=string(field(*nested,"kind"));if(kind=="KindArrayBindingPattern"||kind=="KindObjectBindingPattern"||kind=="KindBindingElement")pending.push_back(nested);}
          }
        }
    }
    return rows;
  }
  bool module(const Json &root){
    auto &g=m.grammar(string(field(root,"sourcePath")));
    for(auto *n:child(root)){
      std::string name;if(!m.sourceName(*n,name))return false;
      const auto kind=string(field(*n,"kind"));if(kind=="KindImportDeclaration"||kind=="KindImportEqualsDeclaration"||kind=="KindExportDeclaration"||kind=="KindExportAssignment")return true;
      if(kind=="KindEndOfFile"||kind=="KindEndOfFileToken")continue;size_t a,b;if(!g.span(field(*n,"range"),a,b))return false;
      auto end=number(field(field(*n,"nameRange"),"start"));if(end<0)end=g.tokens[a].end;
      for(auto i=a;i<b&&g.tokens[i].start<=end;++i)if(g.tokens[i].text=="export")return true;
    }
    return false;
  }
  const Json *exportedBinding(const Json &root,const std::string &name,bool values){
    auto &g=m.grammar(string(field(root,"sourcePath")));const auto declared=declarations(root,values);if(!m.error.message.empty())return nullptr;
    std::vector<const Json *> found;
    for(auto *decl:declared){
      if(!m.spend())return nullptr;auto *statement=decl;
      while(string(field(*statement,"parent"))!=string(field(root,"id"))){if(!m.spend())return nullptr;statement=m.nodes.at(string(field(*statement,"parent")));}
      size_t a,b;if(!g.span(field(*statement,"range"),a,b))return nullptr;while(a<b&&g.tokens[a].text=="@")a+=2;
      if(m.declarationNames.at(string(field(*decl,"id")))==name&&a+1<b&&g.tokens[a].text=="export"&&g.tokens[a+1].text!="default")found.push_back(decl);
    }
    for(auto *statement:child(root)){
      if(!m.spend())return nullptr;const auto kind=string(field(*statement,"kind"));if(kind=="KindEndOfFile"||kind=="KindEndOfFileToken")continue;
      size_t a,b;if(!g.span(field(*statement,"range"),a,b))return nullptr;if(g.tokens[a].text!="export")continue;++a;bool typeOnly=false;
      if(a+1<b&&g.tokens[a].text=="type"&&(g.tokens[a+1].text=="{"||g.tokens[a+1].text=="*")){typeOnly=true;++a;}
      if(a<b&&(g.tokens[a].text=="*"||g.tokens[a].text=="=")){reject(m.error,"core-ir-query-capability","re-export or dynamic module export has no selected binding proof");return nullptr;}
      if(a==b||g.tokens[a].text!="{")continue;++a;
      const auto identifier=[&](std::string &out){
        if(!m.need(a<b,"original export identifier missing"))return false;const auto &token=g.tokens[a++];out=token.text;
        return g.name(Object{{"start",int64_t(token.start)},{"end",int64_t(token.end)}},out);
      };
      std::vector<std::string> locals;
      while(a<b&&g.tokens[a].text!="}"){
        if(!m.spend())return nullptr;bool type=typeOnly;
        if(a+1<b&&g.tokens[a].text=="type"&&g.tokens[a+1].text!="as"&&g.tokens[a+1].text!=","&&g.tokens[a+1].text!="}"){type=true;++a;}
        std::string local,exported;if(!identifier(local))return nullptr;exported=local;
        if(a<b&&g.tokens[a].text=="as"){++a;if(!identifier(exported))return nullptr;}
        if(exported==name&&(!values||!type))locals.push_back(local);if(a==b||g.tokens[a].text!=",")break;++a;
      }
      if(!m.need(a<b&&g.tokens[a++].text=="}","original named export list differs"))return nullptr;
      if(a<b&&g.tokens[a].text=="from"){reject(m.error,"core-ir-query-capability","module re-export has no selected binding proof");return nullptr;}
      if(a<b&&g.tokens[a].text==";")++a;if(!m.need(a==b,"original named export statement differs"))return nullptr;
      for(const auto &local:locals){
        std::vector<const Json *> selected;for(auto *decl:declared)if(m.declarationNames.at(string(field(*decl,"id")))==local)selected.push_back(decl);
        if(selected.size()!=1){reject(m.error,"core-ir-query-capability","local named export must select one original module declaration");return nullptr;}found.push_back(selected[0]);
      }
    }
    if(!m.need(found.size()==1,"original named import has no unique module export"))return nullptr;return found[0];
  }
  const Json *at(const std::string &path,const Json &range){
    for(auto kind:{"KindTypeReference","KindTupleType","KindParenthesizedType"}){
      for(const auto &[id,n]:m.nodes){if(!m.spend())return nullptr;if(string(field(*n,"sourcePath"))==path&&string(field(*n,"kind"))==kind&&same(field(*n,"range"),range))return n;}}
    m.need(false,"original type syntax missing");return nullptr;
  }
  std::vector<const Json *> arguments(const Json &n){std::vector<const Json *> rows;
    for(auto *c:child(n))if(string(field(*c,"kind"))!="KindIdentifier"&&string(field(*c,"kind"))!="KindQualifiedName")rows.push_back(c);return rows;}
  const Json *binding(const Json &node,bool values=false,const Json *scope=nullptr){
    auto &g=m.grammar(string(field(node,"sourcePath")));const Json *nameNode=nullptr;
    if(values)nameNode=&node;
    else for(auto *n:child(node))if(string(field(*n,"kind"))=="KindIdentifier"||string(field(*n,"kind"))=="KindQualifiedName"){nameNode=n;break;}
    size_t a,b;if(!m.need(nameNode&&string(field(*nameNode,"kind"))=="KindIdentifier","named original reference required")||!g.span(field(*nameNode,"range"),a,b)||!m.need(a+1==b,"single original reference name required"))return nullptr;
    const auto name=g.tokens[a].text;std::string parent=scope?string(field(*scope,"id")):string(field(node,"parent"));const Json *root=nullptr;
    std::vector<Json> reference{field(*nameNode,"range")};auto typeArguments=arguments(node);
    if(!typeArguments.empty()){reference.push_back("<");for(size_t i=0;i<typeArguments.size();++i){if(i)reference.push_back(",");reference.push_back(field(*typeArguments[i],"range"));}reference.push_back(">");}
    if(!values&&!g.sequence(field(node,"range"),reference))return nullptr;
    while(m.nodes.count(parent)){
      if(!m.spend())return nullptr;const auto *p=m.nodes.at(parent);root=p;std::vector<const Json *> local;
      const auto declared=declarations(*p,values);if(!m.error.message.empty())return nullptr;
      for(auto *n:declared)if(m.declarationNames.at(string(field(*n,"id")))==name)local.push_back(n);
      if(!local.empty()){if(!m.need(local.size()==1,"ambiguous original type binding"))return nullptr;return local[0];}
      parent=string(field(*p,"parent"));
    }
    std::vector<const Json *> found;
    if(root)for(auto *import:child(*root))if(string(field(*import,"kind"))=="KindImportDeclaration"){
      size_t importStart,importEnd;if(!g.span(field(*import,"range"),importStart,importEnd))return nullptr;
      if(values)for(const auto &[id,n]:m.nodes){if(!m.spend())return nullptr;const auto kind=string(field(*n,"kind"));
        if((kind=="KindNamespaceImport"||kind=="KindImportClause")&&string(field(*n,"sourcePath"))==string(field(node,"sourcePath"))&&
          number(field(field(*n,"range"),"start"))>=number(field(field(*import,"range"),"start"))&&number(field(field(*n,"range"),"end"))<=number(field(field(*import,"range"),"end"))){
          bool matches=string(field(*n,"name"))==name;
          for(auto *identifier:child(*n))if(string(field(*identifier,"kind"))=="KindIdentifier"){
            size_t start,end;if(!g.span(field(*identifier,"range"),start,end))return nullptr;if(end==start+1&&g.tokens[start].text==name)matches=true;
          }
          if(matches){m.need(false,"default/namespace decorator value binding is outside selected Source syntax");return nullptr;}
        }}
      const Json *literal=nullptr;for(auto *n:child(*import))if(string(field(*n,"kind"))=="KindStringLiteral")literal=n;
      if(!literal||!g.span(field(*literal,"range"),a,b)||!m.need(a+1==b,"original import string required"))return nullptr;
      const auto token=g.tokens[a].text;
      if(!m.need(token.size()>2&&(token.front()=='\''||token.front()=='"')&&token.back()==token.front(),"literal original import required"))return nullptr;
      const auto specifier=token.substr(1,token.size()-2),path=string(field(node,"sourcePath"));
      if(!m.need(llvm::StringRef(specifier).starts_with("./")||llvm::StringRef(specifier).starts_with("../"),"relative original import required"))return nullptr;
      std::vector<std::string> parts;llvm::SmallVector<llvm::StringRef> split;const auto importPath=path.substr(0,path.rfind('/')+1)+specifier;llvm::StringRef(importPath).split(split,'/');
      for(auto part:split){if(part.empty()||part==".")continue;if(part==".."){if(!m.need(!parts.empty(),"import escapes source root"))return nullptr;parts.pop_back();}else parts.push_back(part.str());}
      std::string target;for(auto &part:parts)target+="/"+part;
      if(llvm::StringRef(target).ends_with(".js"))target=target.substr(0,target.size()-3)+".ts";
      if(!m.syntax.count(target)&&m.syntax.count(target+".ts"))target+=".ts";
      if(!m.need(m.syntax.count(target),"complete original import closure missing"))return nullptr;
      for(const auto &[id,n]:m.nodes){if(!m.spend())return nullptr;
        if(string(field(*n,"sourcePath"))!=path||string(field(*n,"kind"))!="KindImportSpecifier"||
          number(field(field(*n,"range"),"start"))<number(field(field(*import,"range"),"start"))||
          number(field(field(*n,"range"),"end"))>number(field(field(*import,"range"),"end")))continue;
        if(!g.span(field(*n,"range"),a,b))return nullptr;std::vector<std::string> names;
        for(auto i=a;i<b;++i)if(g.tokens[i].text!="type")names.push_back(g.tokens[i].text);
        if(names.empty()||names.back()!=name)continue;
        if(values&&!m.need(g.tokens[a].text!="type"&&!(importStart+1<importEnd&&g.tokens[importStart+1].text=="type"),"type-only import cannot supply a scalar value callee"))return nullptr;
        if(!m.need(names.size()==1||(names.size()==3&&names[1]=="as"),"original named import syntax differs"))return nullptr;
        for(const auto &[foreignId,foreign]:m.nodes)if(string(field(*foreign,"sourcePath"))==target&&string(field(*foreign,"kind"))=="KindSourceFile"){
          auto *selected=exportedBinding(*foreign,names.front(),values);if(!selected)return nullptr;found.push_back(selected);}
        if(values&&!m.need(!found.empty(),"imported decorator has no selected value declaration"))return nullptr;
      }
    }
    if(found.empty())for(const auto &[id,n]:m.nodes){if(!m.spend())return nullptr;const auto path=string(field(*n,"sourcePath"));
      if(string(field(*n,"kind"))=="KindSourceFile"&&((values&&!module(*n))||(!values&&(path=="/src/system-query-context.d.ts"||path=="/src/minimal-arrays-v8.d.ts")))){
        if(!m.error.message.empty())return nullptr;const auto declared=declarations(*n,values);if(!m.error.message.empty())return nullptr;
        for(auto *decl:declared)if(m.declarationNames.at(string(field(*decl,"id")))==name)found.push_back(decl);}}
    if(!m.need(found.size()==1,"original binding outside owned scope or ambiguous"))return nullptr;return found[0];
  }
  Json target(const Json &n){auto *decl=string(field(n,"kind"))=="KindTypeReference"?binding(n):&n;return decl?origin(*decl):Json(nullptr);}
  const Json *definition(const Json &decl,std::vector<const Json *> &parameters){
    auto members=child(decl);if(!m.need(!members.empty(),"original alias definition missing"))return nullptr;auto *rhs=members.back();
    for(auto *n:members)if(string(field(*n,"kind"))=="KindTypeParameter")parameters.push_back(n);
    auto &g=m.grammar(string(field(decl,"sourcePath")));size_t a,b,n,z;
    if(!g.span(field(decl,"range"),a,b)||!g.span(field(decl,"nameRange"),n,z))return nullptr;
    std::vector<Json> pieces;std::string prefix;for(auto i=a;i<n;++i){if(i>a)prefix+=' ';prefix+=g.tokens[i].text;pieces.push_back(g.tokens[i].text);}
    if(!m.need(prefix=="type"||prefix=="export type","original alias declaration prefix differs"))return nullptr;
    pieces.push_back(field(decl,"nameRange"));if(!parameters.empty()){pieces.push_back("<");for(size_t i=0;i<parameters.size();++i){if(i)pieces.push_back(",");pieces.push_back(field(*parameters[i],"range"));}pieces.push_back(">");}
    pieces.push_back("=");pieces.push_back(field(*rhs,"range"));return g.sequence(field(decl,"range"),pieces,true)?rhs:nullptr;
  }
  Resolved resolve(const Json *node,Env env={},unsigned depth=0){
    if(!node||!m.spend()||!m.need(depth<=64,"original alias graph exceeds64"))return {};
    const auto kind=string(field(*node,"kind"));
    if(kind=="KindParenthesizedType"){auto rows=child(*node);if(!m.need(rows.size()==1,"original parenthesized type differs")||!m.grammar(string(field(*node,"sourcePath"))).sequence(field(*node,"range"),{Json("("),field(*rows[0],"range"),Json(")")}))return {};return resolve(rows[0],env,depth+1);}
    if(kind!="KindTypeReference")return {node,std::move(env)};
    auto *decl=binding(*node);if(!decl)return {};const auto actual=origin(*decl);const auto id=string(field(actual,"id"));
    const auto *substitution=string(field(*decl,"kind"))=="KindTypeParameter"&&env.count(id)?env.at(id):nullptr;
    if(!substitution&&string(field(*decl,"kind"))!="KindTypeAliasDeclaration")return {node,std::move(env)};
    if(!m.need(cursor<items(traces).size(),"missing original alias trace"))return {};const auto &trace=items(traces)[cursor++];
    if(!m.need(exact(trace,{"useSourcePath","useRange","declaration","target"})&&same(field(trace,"useSourcePath"),field(*node,"sourcePath"))&&same(field(trace,"useRange"),field(*node,"range"))&&same(field(trace,"declaration"),actual),"original alias occurrence/order differs"))return {};
    Resolved result;
    if(substitution)result=resolve(substitution,env,depth+1);
    else {std::vector<const Json *> parameters;auto *rhs=definition(*decl,parameters);auto args=arguments(*node);
      if(!rhs||!m.need(parameters.size()==args.size(),"original generic alias arity differs"))return {};
      for(size_t i=0;i<parameters.size();++i)env[string(field(origin(*parameters[i]),"id"))]=args[i];result=resolve(rhs,env,depth+1);}
    if(!result.node||!m.need(same(field(trace,"target"),target(*result.node)),"original alias substitution target differs"))return {};return result;
  }
};
}
bool Model::sourceName(const Json &node,std::string &out){
  const auto id=string(field(node,"id")),kind=string(field(node,"kind"));auto cached=declarationNames.find(id);
  if(cached!=declarationNames.end()){out=cached->second;return true;}
  if(!spend())return false;
  const auto parent=nodes.find(string(field(node,"parent")));
  if(!need(parent!=nodes.end(),"Source declaration has no owning container"))return false;
  const auto parentKind=string(field(*parent->second,"kind"));
  const bool nested=kind=="KindVariableDeclaration"||kind=="KindBindingElement"||kind=="KindTypeParameter";
  if(!need(!nested||parentKind!="KindSourceFile","nested Source declaration cannot be a SourceFile statement"))return false;
  if(nested){
    auto &text=grammar(string(field(node,"sourcePath")));std::string ownerName;
    if(kind=="KindVariableDeclaration"){
      const auto owner=nodes.find(string(field(*parent->second,"parent")));
      if(!need(parentKind=="KindVariableDeclarationList"&&owner!=nodes.end()&&string(field(*owner->second,"kind"))=="KindVariableStatement","Source variable requires an owning variable statement")||!sourceName(*owner->second,ownerName))return false;
    }else if(kind=="KindBindingElement"){
      const auto owner=nodes.find(string(field(*parent->second,"parent")));
      if(!need((parentKind=="KindArrayBindingPattern"||parentKind=="KindObjectBindingPattern")&&owner!=nodes.end()&&
        (string(field(*owner->second,"kind"))=="KindVariableDeclaration"||string(field(*owner->second,"kind"))=="KindBindingElement"),"Source binding requires an owning binding pattern")||!sourceName(*owner->second,ownerName))return false;
      const bool array=parentKind=="KindArrayBindingPattern";std::vector<Json> pieces{Json(array?"[":"{")};size_t ordinal=0;
      for(auto *element:children[string(field(*parent->second,"id"))]){
        if(!need(string(field(*element,"kind"))=="KindBindingElement","Source binding pattern member differs"))return false;
        if(ordinal++)pieces.push_back(",");pieces.push_back(field(*element,"range"));
      }
      pieces.push_back(array?"]":"}");if(!text.sequence(field(*parent->second,"range"),pieces))return false;
    }else{
      if(!need(llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"KindFunctionDeclaration","KindClassDeclaration","KindInterfaceDeclaration","KindTypeAliasDeclaration"},parentKind),"Source type parameter requires a selected generic declaration")||!sourceName(*parent->second,ownerName))return false;
      size_t a,b;if(!text.span(field(*parent->second,"nameRange"),a,b)||!need(b<text.tokens.size()&&text.tokens[b].text=="<","Source generic parameter list missing"))return false;
      std::vector<Json> pieces{Json("<")};size_t ordinal=0,end=b;
      for(auto *parameter:children[string(field(*parent->second,"id"))])if(string(field(*parameter,"kind"))=="KindTypeParameter"){
        if(ordinal++)pieces.push_back(",");pieces.push_back(field(*parameter,"range"));size_t first;if(!text.span(field(*parameter,"range"),first,end))return false;
      }
      if(!need(end<text.tokens.size()&&text.tokens[end].text==">","Source generic parameter list end differs"))return false;pieces.push_back(">");
      if(!text.sequence(Object{{"start",int64_t(text.tokens[b].start)},{"end",int64_t(text.tokens[end].end)}},pieces))return false;
    }
  }
  const auto empty=[&](){if(!need(string(field(node,"name")).empty()&&field(node,"nameRange").getAsNull(),"anonymous Source declaration has asserted name"))return false;declarationNames.emplace(id,"");out.clear();return true;};
  auto &g=grammar(string(field(node,"sourcePath")));
  if(kind=="KindEndOfFile"||kind=="KindEndOfFileToken"){
    if(!need(number(field(field(node,"range"),"start"))==int64_t(g.content.size())&&
      number(field(field(node,"range"),"end"))==int64_t(g.content.size())&&children[id].empty(),"original Source EOF must be empty at Source end"))return false;
    return empty();
  }
  size_t a,b;if(!g.span(field(node,"range"),a,b))return false;
  if(parentKind=="KindSourceFile"){
    // Root coverage must consist of real single statements. Child ranges are
    // not opaque authority to hide a subsequent lexical declaration.
    const bool body=llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"KindFunctionDeclaration","KindClassDeclaration","KindInterfaceDeclaration","KindEnumDeclaration","KindModuleDeclaration"},kind);
    std::vector<std::string> delimiters;bool openedBody=false,ended=false;
    for(size_t i=a;i<b;++i){
      if(!spend())return false;const auto &token=g.tokens[i].text;
      if(token=="("||token=="["||token=="{"){
        if(body&&delimiters.empty()&&token=="{")openedBody=true;delimiters.push_back(token);
      }else if(token==")"||token=="]"||token=="}"){
        if(!need(!delimiters.empty()&&delimiters.back()==(token==")"?"(":token=="]"?"[":"{"),"Source statement delimiter differs"))return false;
        delimiters.pop_back();if(body&&openedBody&&delimiters.empty())ended=true;
      }else if(token==";"&&delimiters.empty())ended=true;
      if(ended){if(!need(i+1==b,"Source statement range includes a following statement"))return false;break;}
    }
    if(!need(ended&&delimiters.empty(),"Source statement has no selected complete boundary"))return false;
  }
  size_t cursor=a;bool defaultExport=false;
  if(kind!="KindVariableDeclaration"&&kind!="KindBindingElement"&&kind!="KindTypeParameter"){
    while(cursor<b&&g.tokens[cursor].text=="@"){
      if(!need(cursor+1<b,"Source decorator name missing"))return false;
      const Json r=Object{{"start",int64_t(g.tokens[cursor+1].start)},{"end",int64_t(g.tokens[cursor+1].end)}};
      if(!g.name(r,g.tokens[cursor+1].text))return false;cursor+=2;
    }
    while(cursor<b&&llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"export","default","declare","async","abstract"},g.tokens[cursor].text)){
      if(g.tokens[cursor].text=="default")defaultExport=true;++cursor;
    }
  }
  if(!need(cursor<b,"Source declaration header missing"))return false;
  const auto keyword=g.tokens[cursor].text;
  const auto expect=[&](llvm::StringRef text){return need(keyword==text,"Source declaration kind/header differs");};
  if(kind=="KindImportDeclaration"||kind=="KindExportDeclaration"||kind=="KindExportAssignment"){
    // Nameless statements must prove their own Source header, rather than
    // consuming the range of a named declaration under an asserted kind.
    bool matches=false;
    if(kind=="KindImportDeclaration")matches=g.tokens[a].text=="import";
    else if(a+1<b&&g.tokens[a].text=="export"){
      const auto &next=g.tokens[a+1].text;
      if(kind=="KindExportDeclaration")matches=next=="{"||next=="*"||(next=="type"&&a+2<b&&(g.tokens[a+2].text=="{"||g.tokens[a+2].text=="*"));
      else matches=next=="="||(next=="default"&&cursor<b&&!llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"function","class","interface","type","enum","namespace","module","const","let","var"},keyword));
    }
    if(!need(matches,"nameless Source statement kind/header differs"))return false;return empty();
  }
  if(kind=="KindVariableStatement"){
    if(!need(keyword=="const"||keyword=="let"||keyword=="var","Source variable statement has unsupported syntax"))return false;
    const Json *list=nullptr;for(auto *child:children[id])if(string(field(*child,"kind"))=="KindVariableDeclarationList"){if(!need(!list,"multiple Source variable lists"))return false;list=child;}
    if(!need(list,"Source variable declaration list missing"))return false;
    std::vector<Json> pieces;for(auto i=a;i<=cursor;++i)pieces.push_back(g.tokens[i].text);size_t ordinal=0;
    for(auto *decl:children[string(field(*list,"id"))]){if(!need(string(field(*decl,"kind"))=="KindVariableDeclaration","Source variable list member differs"))return false;
      if(ordinal++)pieces.push_back(",");pieces.push_back(field(*decl,"range"));}
    if(!g.sequence(field(node,"range"),pieces,true))return false;return empty();
  }
  if(kind=="KindEmptyStatement")return expect(";")&&g.sequence(field(node,"range"),{Json(";")})&&empty();
  if(kind=="KindFunctionDeclaration"||kind=="KindClassDeclaration"||kind=="KindInterfaceDeclaration"||kind=="KindTypeAliasDeclaration"||kind=="KindEnumDeclaration"||kind=="KindModuleDeclaration"||kind=="KindImportEqualsDeclaration"){
    if(kind=="KindEnumDeclaration"&&keyword=="const"){++cursor;if(!need(cursor<b&&g.tokens[cursor].text=="enum","Source const enum header differs"))return false;}
    else if(kind=="KindModuleDeclaration"){if(!need(keyword=="namespace"||keyword=="module","Source namespace header differs"))return false;}
    else if(!expect(kind=="KindFunctionDeclaration"?"function":kind=="KindClassDeclaration"?"class":kind=="KindInterfaceDeclaration"?"interface":kind=="KindTypeAliasDeclaration"?"type":kind=="KindEnumDeclaration"?"enum":"import"))return false;
    ++cursor;if(kind=="KindFunctionDeclaration"&&cursor<b&&g.tokens[cursor].text=="*")++cursor;
    if(defaultExport&&cursor<b&&((kind=="KindFunctionDeclaration"&&(g.tokens[cursor].text=="("||g.tokens[cursor].text=="<"))||
      (kind=="KindClassDeclaration"&&(g.tokens[cursor].text=="{"||g.tokens[cursor].text=="extends"))))return empty();
  }else if(kind=="KindTypeParameter"){
    while(cursor+1<b&&llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"const","in","out"},g.tokens[cursor].text))++cursor;
  }else if(kind=="KindBindingElement"){
    if(cursor+2<b&&g.tokens[cursor].text=="."&&g.tokens[cursor+1].text=="."&&g.tokens[cursor+2].text==".")cursor+=3;
    if(cursor+1<b&&g.tokens[cursor+1].text==":")cursor+=2;
  }else if(kind!="KindVariableDeclaration")return reject(error,"core-ir-query-capability","Source scope declaration syntax has no selected name validation");
  if(!need(cursor<b,"Source declaration name missing"))return false;
  if((kind=="KindVariableDeclaration"||kind=="KindBindingElement")&&(g.tokens[cursor].text=="["||g.tokens[cursor].text=="{"))return empty();
  const auto &token=g.tokens[cursor];const Json range=Object{{"start",int64_t(token.start)},{"end",int64_t(token.end)}};
  if(!g.name(range,token.text)||!need(string(field(node,"name"))==token.text&&same(field(node,"nameRange"),range),"original Source declaration name/range differs"))return false;
  declarationNames.emplace(id,token.text);out=token.text;return true;
}
bool Model::ownedMarker(const std::string &path,const Json &range,const Json &expected){
  auto &g=grammar(path);size_t a,b;if(!g.span(range,a,b)||!need(a+2==b&&g.tokens[a].text=="@","simple original decorator required"))return false;
  const Json nameRange=Object{{"start",int64_t(g.tokens[a+1].start)},{"end",int64_t(g.tokens[a+1].end)}};
  auto *use=at(path,nameRange,"KindIdentifier");if(!use||!need(nodes.count(string(field(*use,"parent"))),"decorator use parent missing"))return false;
  const auto &decorator=*nodes.at(string(field(*use,"parent")));
  if(!need(string(field(decorator,"kind"))=="KindDecorator"&&same(field(decorator,"range"),range)&&nodes.count(string(field(decorator,"parent"))),"original decorator occurrence differs"))return false;
  const auto &owner=*nodes.at(string(field(decorator,"parent")));const auto parent=string(field(owner,"parent"));
  if(!need(nodes.count(parent)&&string(field(*nodes.at(parent),"kind"))=="KindSourceFile","decorator lexical scope is outside selected top-level Source syntax"))return false;
  Json traces=Array{};Proof proof{*this,traces};auto *binding=proof.binding(*use,true,nodes.at(parent));
  return binding&&need(same(proof.origin(*binding),expected),"decorator value binding is not the owned declaration");
}
bool Model::scalarTarget(const std::string &path,const Json &range,const Json &expected){
  auto *identifier=at(path,range,"KindIdentifier");if(!identifier)return false;
  Json traces=Array{};Proof proof{*this,traces};auto *binding=proof.binding(*identifier,true);
  return binding&&need(same(proof.origin(*binding),expected),"scalar call does not bind the original helper declaration");
}
bool Model::annotation(const std::string &path,const Json &range,const std::string &id,unsigned depth){
  if(!spend()||!need(depth<=64&&source->types.count(id),"original logical annotation graph differs"))return false;
  Json traces=Array{};Proof proof{*this,traces};const Json *reference=nullptr;
  for(const auto &[key,node]:nodes)if(string(field(*node,"kind"))=="KindTypeReference"&&string(field(*node,"sourcePath"))==path&&same(field(*node,"range"),range)){reference=node;break;}
  const auto &type=*source->types.at(id);
  if(reference){auto *decl=proof.binding(*reference);if(!decl)return false;
    if(same(field(type,"sourcePath"),field(*decl,"sourcePath"))&&same(field(type,"nameRange"),field(*decl,"nameRange")))return need(proof.arguments(*reference).empty(),"concrete source type has type arguments");
    if(string(field(*decl,"kind"))=="KindTypeAliasDeclaration"){
      std::vector<const Json *> parameters;auto *rhs=proof.definition(*decl,parameters);
      return rhs&&need(parameters.empty()&&proof.arguments(*reference).empty(),"ordinary logical alias must be concrete")&&annotation(string(field(*rhs,"sourcePath")),field(*rhs,"range"),id,depth+1);
    }
    return need(false,"original logical declaration target differs");
  }
  const auto kind=string(field(type,"kind"));return need(kind=="void"||kind=="undefined"||kind=="unknown","ordinary source annotation capability differs")&&grammar(path).sequence(range,{Json(kind)});
}
bool Model::selection(const Json &query,const std::string &path,const Json &annotation){
  if(!need(exact(query,{"declaration","tupleSourcePath","tupleRange","aliases","items"})&&field(query,"aliases").getAsArray()&&field(query,"items").getAsArray()&&
    same(field(query,"declaration"),*builtins.at("Query")),"owned Query selection boundary differs"))return false;
  Proof proof{*this,field(query,"aliases")};auto q=proof.resolve(proof.at(path,annotation));
  if(!q.node||!need(string(field(*q.node,"kind"))=="KindTypeReference"&&same(proof.target(*q.node),*builtins.at("Query")),"original Query annotation target differs"))return false;
  auto args=proof.arguments(*q.node);if(!need(args.size()==1,"owned Query type arity differs"))return false;auto tuple=proof.resolve(args[0],q.env);
  if(!tuple.node||!need(string(field(*tuple.node,"kind"))=="KindTupleType"&&same(field(*tuple.node,"sourcePath"),field(query,"tupleSourcePath"))&&same(field(*tuple.node,"range"),field(query,"tupleRange")),"original Query tuple differs"))return false;
  const auto members=proof.child(*tuple.node);const auto &items_=items(field(query,"items"));
  if(!need(!items_.empty()&&items_.size()<=256&&items_.size()==members.size(),"complete nonempty Query tuple inventory differs"))return false;
  std::vector<Json> pieces{Json("[")};
  for(size_t i=0;i<items_.size();++i){const auto &item=items_[i];const auto mode=string(field(item,"mode")),type=string(field(item,"componentType"));
    if(!spend()||!need(exact(item,{"index","mode","range","wrapper","componentType","component","componentSourcePath","componentRange"})&&number(field(item,"index"))==int64_t(i)&&
      (mode=="read"||mode=="write")&&source->types.count(type)&&string(field(field(*source->types.at(type),"nominalKey"),"category"))=="component"&&
      same(field(item,"wrapper"),*builtins.at(mode=="read"?"Read":"Write"))&&same(field(item,"range"),field(*members[i],"range")),"original tuple index/access/component differs"))return false;
    auto wrapper=proof.resolve(members[i],tuple.env);
    if(!wrapper.node||!need(string(field(*wrapper.node,"kind"))=="KindTypeReference"&&same(proof.target(*wrapper.node),field(item,"wrapper")),"original Read/Write wrapper differs"))return false;
    args=proof.arguments(*wrapper.node);if(!need(args.size()==1,"owned access wrapper arity differs"))return false;auto component=proof.resolve(args[0],wrapper.env);
    if(!component.node||!need(same(proof.target(*component.node),field(item,"component"))&&same(field(*component.node,"sourcePath"),field(item,"componentSourcePath"))&&same(field(*component.node,"range"),field(item,"componentRange")),"original component substitution differs"))return false;
    const auto &t=*source->types.at(type),&origin=field(item,"component");
    if(!original(origin)||!need(same(field(t,"sourcePath"),field(origin,"sourcePath"))&&same(field(t,"declarationRange"),field(origin,"range"))&&same(field(t,"nameRange"),field(origin,"nameRange"))&&same(field(t,"name"),field(origin,"name")),"selected source type is not original component"))return false;
    if(i)pieces.push_back(",");pieces.push_back(field(item,"range"));
  }
  pieces.push_back("]");return need(proof.cursor==items(field(query,"aliases")).size(),"unconsumed alias proof")&&grammar(string(field(query,"tupleSourcePath"))).sequence(field(query,"tupleRange"),pieces);
}
} // namespace tsfg::systemQuery
