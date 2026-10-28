// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/ADT/APFloat.h"
#include "llvm/ADT/APInt.h"
namespace tsfg::systemQuery {
bool Model::expression(const Json &value,const Json &body,const std::map<std::string,const Json *> &scope,const std::string &path,unsigned depth,const std::string &expected){
  if(!spend()||!need(depth<32,"Query expression path exceeds32"))return false;
  const auto kind=string(field(value,"kind")),type=string(field(value,"type"));const auto &r=field(value,"range");
  error.range={uint32_t(number(field(r,"start"))),uint32_t(number(field(r,"end")))};
  if(!need(source->types.count(type)&&number(field(r,"start"))>=number(field(body,"start"))&&number(field(r,"end"))<=number(field(body,"end"))&&
    (kind=="fieldTarget"||kind=="bindingTarget"||string(field(value,"flowType"))==type),"original expression range/logical type differs"))return false;
  auto &g=grammar(path);const auto astKind=kind=="numericLiteral"?(llvm::StringRef(string(field(value,"token"))).starts_with("-")?"KindPrefixUnaryExpression":"KindNumericLiteral"):kind=="bindingReference"||kind=="bindingTarget"?"KindIdentifier":kind=="fieldAccess"||kind=="fieldTarget"?"KindPropertyAccessExpression":kind=="call"?"KindCallExpression":kind=="parentheses"?"KindParenthesizedExpression":"KindBinaryExpression";
  if(!at(path,r,astKind))return false;
  if(kind=="numericLiteral"){
    const auto token=string(field(value,"token"));const auto inferred=token.find_first_of(".eE")!=std::string::npos&&token.find_first_of("xX")==std::string::npos?"f64":"i32";
    if(!need((type=="f32"||type=="f64")&&type==(expected.empty()?inferred:expected),"Query literal original contextual/default width differs")||!verifySourceLiteral(g,value))return false;
    const llvm::APInt bits(type=="f32"?32:64,string(field(value,"bits")),16);
    const llvm::APFloat number(type=="f32"?llvm::APFloat::IEEEsingle():llvm::APFloat::IEEEdouble(),bits);
    return need(number.isFinite(),"Query literal must preserve finite floating-point value");
  }
  if(kind=="bindingReference"||kind=="bindingTarget"){
    const auto id=string(field(value,"binding"));if(!need(scope.count(id),"original lexical binding missing"))return false;
    const auto &binding=*scope.at(id);const bool local=string(field(binding,"kind"))=="local";
    const auto &decl=local?binding:field(binding,field(binding,"componentType").getAsString()?"declaration":"binding");
    const auto selected=string(field(binding,local?"declaredType":field(binding,"componentType").getAsString()?"componentType":"logicalType"));
    const Json origin=local?Json(Object{{"id",field(binding,"id")},{"sourcePath",path},{"kind","KindVariableDeclaration"},{"name",field(binding,"name")},{"range",field(binding,"declarationRange")},{"nameRange",field(binding,"nameRange")}}):Json(decl);
    return need(type==selected&&(field(binding,"componentType").getAsString()||!field(binding,"view").getAsNull()||type=="f32"||type=="f64"),"original expression binding type differs")&&
      need(kind!="bindingTarget"||(local&&field(binding,"writable").getAsBoolean()==true),"local target requires original writable initialized binding")&&g.name(r,string(field(decl,"name")))&&scalarTarget(path,r,origin);  }
  if(kind=="parentheses")return need(string(field(field(value,"expression"),"type"))==type,"grouping logical type differs")&&expression(field(value,"expression"),body,scope,path,depth+1,expected)&&g.sequence(r,{Json("("),field(field(value,"expression"),"range"),Json(")")});
  if(kind=="call"){
    const auto id=string(field(value,"callee"));if(!need(helperIndex.count(id)&&field(value,"arguments").getAsArray()&&field(value,"receiver").getAsNull(),"direct floating-point helper target required"))return false;
    const auto &helper=scalarHelpers[helperIndex.at(id)];const auto &raw=*helper.raw;
    if(!need(type==string(field(raw,"returnType")),"original helper call return width differs"))return false;
    size_t a,b;if(!g.span(field(value,"calleeRange"),a,b)||!need(a+1==b,"direct scalar callee identifier required"))return false;
    for(const auto &[id,binding]:scope){const auto &decl=string(field(*binding,"kind"))=="local"?*binding:field(*binding,field(*binding,"componentType").getAsString()?"declaration":"binding");if(!need(string(field(decl,"name"))!=g.tokens[a].text,"scalar call is shadowed by original local binding"))return false;}
    if(!scalarTarget(path,field(value,"calleeRange"),field(raw,"declaration"))||!need(same(field(value,"signature"),field(raw,"signature"))&&items(field(value,"arguments")).size()==helper.parameters.size(),"scalar helper call signature/arity differs"))return false;
    std::vector<Json> pieces{field(value,"calleeRange"),Json("(")};size_t index=0;
    for(const auto &arg:items(field(value,"arguments"))){
      const auto &formal=*helper.parameters[index].raw;if(index++)pieces.push_back(",");pieces.push_back(field(arg,"range"));
      if(!need(same(field(arg,"type"),field(formal,"logicalType")),"helper argument component/type differs")||!expression(arg,body,scope,path,depth+1,string(field(formal,"logicalType"))))return false;
      if(!field(formal,"view").getAsNull()){
        const Json *reference=&arg;while(string(field(*reference,"kind"))=="parentheses")reference=&field(*reference,"expression");
        const auto binding=string(field(*reference,"binding"));if(!need(string(field(*reference,"kind"))=="bindingReference"&&scope.count(binding),"helper view requires original borrowed binding"))return false;
        const auto &actual=*scope.at(binding),&access=field(actual,"componentType").getAsString()?actual:field(field(actual,"view"),"access");
        const auto mode=string(field(access,"mode"));if(!need((mode=="read"||mode=="write")&&(string(field(field(field(formal,"view"),"access"),"mode"))!="write"||mode=="write"),"helper cannot widen Read to Write"))return false;
      }
    }
    pieces.push_back(")");return g.sequence(r,pieces);
  }
  if(kind=="fieldAccess"||kind=="fieldTarget"){
    const auto &receiver=field(value,"receiver");const auto binding=string(field(receiver,"binding")),property=string(field(value,"property"));
    if(!need(string(field(receiver,"kind"))=="bindingReference"&&scope.count(binding)&&fields.count(property),"direct original component receiver required")||!expression(receiver,body,scope,path,depth+1))return false;
    const auto &raw=*scope.at(binding),&slot=field(raw,"componentType").getAsString()?raw:field(field(raw,"view"),"access"),&f=*fields.at(property);auto owner=string(field(slot,"componentType"));const auto name=string(field(f,"name"));
    std::set<std::string> seen;const Json *selected=nullptr;
    while(!owner.empty()){
      if(!spend()||!need(seen.size()<32&&seen.insert(owner).second&&source->types.count(owner),"component inheritance graph exceeds32 or unowned"))return false;
      const auto &t=*source->types.at(owner);for(const auto &candidate:items(field(t,"fields")))if(string(field(candidate,"name"))==name){selected=&candidate;break;}
      if(selected)break;owner=string(field(t,"base"));
    }
    if(!need(selected&&same(field(*selected,"id"),field(value,"property"))&&(type=="f32"||type=="f64")&&string(field(f,"type"))==type&&string(field(f,"access"))=="public","first visible original field/type/access differs"))return false;
    if(kind=="fieldTarget"&&!need(string(field(slot,"mode"))=="write"&&field(f,"readonly").getAsBoolean()==false,"Read borrow or declared readonly field cannot be written"))return false;
    return g.name(field(value,"nameRange"),name)&&g.sequence(r,{field(receiver,"range"),Json("."),field(value,"nameRange")});
  }
  if(kind=="binary"){
    const auto op=string(field(value,"operator"));const auto &left=field(value,"left"),&right=field(value,"right");
    return need((type=="f32"||type=="f64")&&llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"+","-","*","/"},op)&&string(field(left,"type"))==type&&string(field(right,"type"))==type,"owned same-width floating-point arithmetic required")&&
      expression(left,body,scope,path,depth+1,expected)&&expression(right,body,scope,path,depth+1,expected.empty()?string(field(left,"type")):expected)&&g.sequence(field(value,"operatorRange"),{Json(op)})&&g.sequence(r,{field(left,"range"),field(value,"operatorRange"),field(right,"range")});
  }
  if(kind=="fieldAssignment"||kind=="bindingAssignment"){
    const auto op=string(field(value,"operator"));const auto &target=field(value,"target"),&rhs=field(value,"value");
    return need((type=="f32"||type=="f64")&&llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"=","+=","-=","*=","/="},op)&&string(field(target,"kind"))==(kind=="fieldAssignment"?"fieldTarget":"bindingTarget")&&string(field(target,"type"))==type&&string(field(rhs,"type"))==type,"owned same-width floating-point field assignment required")&&
      expression(target,body,scope,path,depth+1)&&expression(rhs,body,scope,path,depth+1,type)&&g.sequence(field(value,"operatorRange"),{Json(op)})&&g.sequence(r,{field(target,"range"),field(value,"operatorRange"),field(rhs,"range")});
  }
  return need(false,"Query expression has no selected typed representation");
}
bool Model::statements(const Json &rows,const Json &locals,const Json &body,const Json &owner,std::map<std::string,const Json *> scope,const std::string &path,const std::string &returns){
  if(!need(rows.getAsArray()&&locals.getAsArray(),"Query statement/local arrays required")||!verifySourceShapeValue(*source,rows,"[]arrayGenericStatement")||!verifySourceShapeValue(*source,locals,"[]arrayFactsBinding"))return false;
  const auto ownerId=digest(std::string("tsfg.array-facts.function.v8")+std::string(1,'\0')+canonical(Object{{"sourcePath",path},{"declarationRange",field(owner,"range")}}));
  std::map<std::string,const Json *> directory;std::set<std::string> seen;
  for(const auto &binding:items(locals)){
    if(!spend())return false;const auto id=string(field(binding,"id")),type=string(field(binding,"declaredType"));
    auto *node=at(path,field(binding,"declarationRange"),"KindVariableDeclaration");
    if(!node||!need(string(field(binding,"kind"))=="local"&&(type=="f32"||type=="f64")&&field(binding,"elementAnnotationRange").getAsNull()&&
      string(field(binding,"lexicalOwner"))==ownerId&&same(field(binding,"name"),field(*node,"name"))&&same(field(binding,"nameRange"),field(*node,"nameRange"))&&
      id==originId(path,field(binding,"nameRange"))&&!scope.count(id)&&directory.emplace(id,&binding).second,"original Query local declaration/owner/type differs"))return false;
  }
  auto &g=grammar(path);const auto &statements_=items(rows);size_t cursor=0;std::vector<Json> bodyPieces{Json("{")};
  const auto &originals=children[string(field(body,"id"))];
  for(size_t originalIndex=0;originalIndex<originals.size();++originalIndex){
    const auto &node=*originals[originalIndex];const auto kind=string(field(node,"kind"));if(!spend())return false;
    if(kind=="KindVariableStatement"){
      const auto &lists=children[string(field(node,"id"))];if(!need(lists.size()==1&&string(field(*lists[0],"kind"))=="KindVariableDeclarationList","original local declaration list differs"))return false;
      const auto &list=*lists[0];std::vector<Json> pieces;std::string keyword;
      for(auto *declaration:children[string(field(list,"id"))]){
        if(!spend()||!need(cursor<statements_.size(),"missing original local statement"))return false;const auto &statement=statements_[cursor++];const auto id=string(field(statement,"binding")),statementKind=string(field(statement,"kind"));
        if(!need(seen.size()<items(locals).size()&&same(field(items(locals)[seen.size()],"id"),field(statement,"binding"))&&directory.count(id)&&seen.insert(id).second&&(statementKind=="constDeclaration"||statementKind=="letDeclaration"),"original local statement binding/kind/order differs"))return false;
        const auto &binding=*directory.at(id);const auto word=statementKind=="constDeclaration"?"const":"let";const auto &value=field(statement,"initializer");
        if(!need((keyword.empty()||keyword==word)&&field(binding,"writable").getAsBoolean()==(statementKind=="letDeclaration")&&
          same(field(binding,"declarationRange"),field(*declaration,"range"))&&same(field(statement,"range"),field(*declaration,"range"))&&string(field(value,"type"))==string(field(binding,"declaredType")),"original local declaration/order/writability differs")||
          !expression(value,field(body,"range"),scope,path,0,field(binding,"annotationRange").getAsNull()?"":string(field(binding,"declaredType"))))return false;
        keyword=word;const auto &values=children[string(field(*declaration,"id"))];
        if(!need(!values.empty()&&same(field(*values.back(),"range"),field(value,"range")),"original local initializer differs"))return false;
        std::vector<Json> declarationPieces{field(binding,"nameRange")};
        if(!field(binding,"annotationRange").getAsNull()){
          if(!annotation(path,field(binding,"annotationRange"),string(field(binding,"declaredType"))))return false;
          declarationPieces.push_back(":");declarationPieces.push_back(field(binding,"annotationRange"));
        }
        declarationPieces.push_back("=");declarationPieces.push_back(field(value,"range"));
        if(!g.sequence(field(*declaration,"range"),declarationPieces))return false;
        if(!pieces.empty())pieces.push_back(",");pieces.push_back(field(*declaration,"range"));scope.emplace(id,&binding);
      }
      pieces.insert(pieces.begin(),Json(keyword));if(!g.sequence(field(list,"range"),pieces)||!g.sequence(field(node,"range"),{field(list,"range")},true))return false;
    }else{
      if(!need(cursor<statements_.size(),"missing original Query statement"))return false;const auto &statement=statements_[cursor++],&value=field(statement,"value");
      const bool returned=kind=="KindReturnStatement";
      if(!need((returned||kind=="KindExpressionStatement")&&string(field(statement,"kind"))==(returned?"return":"expression")&&same(field(statement,"range"),field(node,"range")),"original Query statement differs"))return false;
      if(returned){if(!need(!returns.empty()&&originalIndex+1==originals.size()&&string(field(value,"type"))==returns,"helper requires final same-width return"))return false;}
      else if(!need(llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"fieldAssignment","bindingAssignment","call"},string(field(value,"kind"))),"Query effect statement differs"))return false;
      const auto &values=children[string(field(node,"id"))];
      if(!need(values.size()==1&&same(field(*values[0],"range"),field(value,"range")),"original statement value differs")||!expression(value,field(body,"range"),scope,path,0,returned?returns:""))return false;
      std::vector<Json> pieces;if(returned)pieces.push_back("return");pieces.push_back(field(value,"range"));if(!g.sequence(field(node,"range"),pieces,true))return false;
    }
    bodyPieces.push_back(field(node,"range"));
  }
  bodyPieces.push_back("}");return need(cursor==statements_.size()&&seen.size()==directory.size()&&(returns.empty()||(!statements_.empty()&&string(field(statements_.back(),"kind"))=="return")),"complete Query local/statement inventory differs")&&g.sequence(field(body,"range"),bodyPieces);
}
bool Model::loop(const Json &raw,const Json &node,const Json &system,const std::vector<Parameter> &parameters){
  const auto path=string(field(field(system,"declaration"),"sourcePath"));auto &g=grammar(path);
  if(!spend()||!need(exact(raw,{"range","queryBinding","queryRange","bindingRange","bodyRange","bindings","localBindings","statements"})&&string(field(node,"kind"))=="KindForOfStatement"&&same(field(raw,"range"),field(node,"range")),"original for-of loop boundary differs"))return false;
  const Parameter *query=nullptr;for(const auto &p:parameters)if(string(field(field(*p.raw,"binding"),"id"))==string(field(raw,"queryBinding")))query=&p;
  if(!need(query&&!query->selection.empty(),"loop is not on original Query parameter"))return false;
  const Json *body=nullptr,*initializer=nullptr,*expressionNode=nullptr;
  for(auto *child:children[string(field(node,"id"))]){
    const auto kind=string(field(*child,"kind"));if(kind=="KindBlock")body=child;else if(kind=="KindVariableDeclarationList")initializer=child;
    else if(kind=="KindIdentifier"&&same(field(*child,"range"),field(raw,"queryRange")))expressionNode=child;
  }
  if(!need(body&&initializer&&expressionNode&&same(field(*body,"range"),field(raw,"bodyRange")),"original loop header/body differs"))return false;
  auto *pattern=at(path,field(raw,"bindingRange"),"KindArrayBindingPattern");
  if(!pattern||!need(nodes.count(string(field(*pattern,"parent"))),"original tuple declaration missing"))return false;
  const auto &declaration=*nodes.at(string(field(*pattern,"parent")));
  if(!need(string(field(declaration,"kind"))=="KindVariableDeclaration"&&same(field(declaration,"parent"),field(*initializer,"id"))&&same(field(declaration,"range"),field(raw,"bindingRange")),"original inferred tuple declaration differs"))return false;
  const auto &tuple=items(field(field(*query->raw,"query"),"items")),&bindings=items(field(raw,"bindings"));const auto &originalBindings=children[string(field(*pattern,"id"))];
  if(!need(field(raw,"bindings").getAsArray()&&bindings.size()==tuple.size()&&bindings.size()==originalBindings.size(),"complete original tuple binding inventory differs"))return false;
  std::map<std::string,const Json *> scope;
  for(const auto &p:parameters)if(p.selection.empty())scope.emplace(string(field(field(*p.raw,"binding"),"id")),p.raw);
  std::vector<Json> pieces{Json("[")};
  for(size_t i=0;i<bindings.size();++i){const auto &b=bindings[i],&decl=field(b,"declaration");auto *originalBinding=original(decl);
    if(!need(exact(b,{"index","declaration","componentType","mode"})&&number(field(b,"index"))==int64_t(i)&&originalBinding==originalBindings[i]&&string(field(decl,"kind"))=="KindBindingElement"&&
      same(field(b,"componentType"),field(tuple[i],"componentType"))&&same(field(b,"mode"),field(tuple[i],"mode"))&&scope.emplace(string(field(decl,"id")),&b).second,"original tuple order/access/component differs")||!g.sequence(field(decl,"range"),{field(decl,"nameRange")}))return false;
    if(i)pieces.push_back(",");pieces.push_back(field(decl,"range"));
  }
  pieces.push_back("]");if(!g.sequence(field(raw,"bindingRange"),pieces)||!g.sequence(field(*initializer,"range"),{Json("const"),field(raw,"bindingRange")})||
    !g.name(field(raw,"queryRange"),string(field(field(*query->raw,"binding"),"name")))||
    !g.sequence(field(raw,"range"),{Json("for"),Json("("),field(*initializer,"range"),Json("of"),field(raw,"queryRange"),Json(")"),field(raw,"bodyRange")}))return false;
  return statements(field(raw,"statements"),field(raw,"localBindings"),*body,field(system,"declaration"),std::move(scope),path,"");
}
} // namespace tsfg::systemQuery
