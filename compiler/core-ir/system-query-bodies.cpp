// SPDX-License-Identifier: MIT
#include "system-query-source.h"
#include "llvm/ADT/STLExtras.h"
namespace tsfg::systemQuery {
bool Model::expression(const Json &value,const Json &body,const std::map<std::string,const Json *> &scope,const std::string &path,unsigned depth,bool scalar){
  if(!spend()||!need(depth<32,"Query expression path exceeds32"))return false;
  const auto kind=string(field(value,"kind")),type=string(field(value,"type"));const auto &r=field(value,"range");
  error.range={uint32_t(number(field(r,"start"))),uint32_t(number(field(r,"end")))};
  if(!need(source->types.count(type)&&number(field(r,"start"))>=number(field(body,"start"))&&number(field(r,"end"))<=number(field(body,"end"))&&
    (kind=="fieldTarget"||string(field(value,"flowType"))==type),"original expression range/logical type differs"))return false;
  if(scalar&&!llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"bindingReference","binary","call","parentheses"},kind))return reject(error,"core-ir-query-capability","scalar helper body has no selected pure scalar syntax");
  auto &g=grammar(path);const auto astKind=kind=="bindingReference"?"KindIdentifier":kind=="fieldAccess"||kind=="fieldTarget"?"KindPropertyAccessExpression":kind=="call"?"KindCallExpression":kind=="parentheses"?"KindParenthesizedExpression":"KindBinaryExpression";
  if(!at(path,r,astKind))return false;
  if(kind=="bindingReference"){
    const auto id=string(field(value,"binding"));if(!need(scope.count(id),"original lexical binding missing"))return false;
    const auto &binding=*scope.at(id),&decl=field(binding,field(binding,"componentType").getAsString()?"declaration":"binding");
    const auto selected=string(field(binding,field(binding,"componentType").getAsString()?"componentType":"logicalType"));
    return need(type==selected&&(field(binding,"componentType").getAsString()||type=="f32"),"original expression binding type differs")&&g.name(r,string(field(decl,"name")));
  }
  if(kind=="parentheses")return need(type=="f32"&&string(field(field(value,"expression"),"type"))=="f32","scalar grouping type differs")&&expression(field(value,"expression"),body,scope,path,depth+1,scalar)&&g.sequence(r,{Json("("),field(field(value,"expression"),"range"),Json(")")});
  if(kind=="call"){
    const auto id=string(field(value,"callee"));if(!need(type=="f32"&&helperIndex.count(id)&&field(value,"arguments").getAsArray()&&field(value,"receiver").getAsNull(),"direct native f32 helper target required"))return false;
    const auto &helper=scalarHelpers[helperIndex.at(id)];const auto &raw=*helper.raw;
    size_t a,b;if(!g.span(field(value,"calleeRange"),a,b)||!need(a+1==b,"direct scalar callee identifier required"))return false;
    for(const auto &[id,binding]:scope){const auto &decl=field(*binding,field(*binding,"componentType").getAsString()?"declaration":"binding");if(!need(string(field(decl,"name"))!=g.tokens[a].text,"scalar call is shadowed by original local binding"))return false;}
    if(!scalarTarget(path,field(value,"calleeRange"),field(raw,"declaration"))||!need(same(field(value,"signature"),field(raw,"signature"))&&items(field(value,"arguments")).size()==helper.parameters.size(),"scalar helper call signature/arity differs"))return false;
    std::vector<Json> pieces{field(value,"calleeRange"),Json("(")};size_t index=0;
    for(const auto &arg:items(field(value,"arguments"))){if(index++)pieces.push_back(",");pieces.push_back(field(arg,"range"));if(!need(string(field(arg,"type"))=="f32","scalar helper argument must be native f32")||!expression(arg,body,scope,path,depth+1,scalar))return false;}
    pieces.push_back(")");return g.sequence(r,pieces);
  }
  if(kind=="fieldAccess"||kind=="fieldTarget"){
    const auto &receiver=field(value,"receiver");const auto binding=string(field(receiver,"binding")),property=string(field(value,"property"));
    if(!need(string(field(receiver,"kind"))=="bindingReference"&&scope.count(binding)&&fields.count(property),"direct original component receiver required")||!expression(receiver,body,scope,path,depth+1))return false;
    const auto &slot=*scope.at(binding),&f=*fields.at(property);auto owner=string(field(slot,"componentType"));const auto name=string(field(f,"name"));
    std::set<std::string> seen;const Json *selected=nullptr;
    while(!owner.empty()){
      if(!spend()||!need(seen.size()<32&&seen.insert(owner).second&&source->types.count(owner),"component inheritance graph exceeds32 or unowned"))return false;
      const auto &t=*source->types.at(owner);for(const auto &candidate:items(field(t,"fields")))if(string(field(candidate,"name"))==name){selected=&candidate;break;}
      if(selected)break;owner=string(field(t,"base"));
    }
    if(!need(selected&&same(field(*selected,"id"),field(value,"property"))&&type=="f32"&&string(field(f,"type"))==type&&string(field(f,"access"))=="public","first visible original field/type/access differs"))return false;
    if(kind=="fieldTarget"&&!need(string(field(slot,"mode"))=="write"&&field(f,"readonly").getAsBoolean()==false,"Read borrow or declared readonly field cannot be written"))return false;
    return g.name(field(value,"nameRange"),name)&&g.sequence(r,{field(receiver,"range"),Json("."),field(value,"nameRange")});
  }
  if(kind=="binary"){
    const auto op=string(field(value,"operator"));const auto &left=field(value,"left"),&right=field(value,"right");
    return need(type=="f32"&&llvm::is_contained(llvm::ArrayRef<llvm::StringRef>{"+","-","*","/"},op)&&string(field(left,"type"))=="f32"&&string(field(right,"type"))=="f32","owned f32 arithmetic required")&&
      expression(left,body,scope,path,depth+1,scalar)&&expression(right,body,scope,path,depth+1,scalar)&&g.sequence(field(value,"operatorRange"),{Json(op)})&&g.sequence(r,{field(left,"range"),field(value,"operatorRange"),field(right,"range")});
  }
  if(kind=="fieldAssignment"){
    const auto op=string(field(value,"operator"));const auto &target=field(value,"target"),&rhs=field(value,"value");
    return need(type=="f32"&&(op=="="||op=="+=")&&string(field(target,"kind"))=="fieldTarget"&&string(field(rhs,"type"))=="f32","owned f32 field assignment required")&&
      expression(target,body,scope,path,depth+1)&&expression(rhs,body,scope,path,depth+1)&&g.sequence(field(value,"operatorRange"),{Json(op)})&&g.sequence(r,{field(target,"range"),field(value,"operatorRange"),field(rhs,"range")});
  }
  return need(false,"Query expression has no selected typed representation");
}
bool Model::loop(const Json &raw,const Json &node,const Json &system,const std::vector<Parameter> &parameters){
  const auto path=string(field(field(system,"declaration"),"sourcePath"));auto &g=grammar(path);
  if(!spend()||!need(exact(raw,{"range","queryBinding","queryRange","bindingRange","bodyRange","bindings","statements"})&&string(field(node,"kind"))=="KindForOfStatement"&&same(field(raw,"range"),field(node,"range")),"original for-of loop boundary differs"))return false;
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
  const auto &statements=items(field(raw,"statements"));const auto &originalStatements=children[string(field(*body,"id"))];
  if(!need(field(raw,"statements").getAsArray()&&statements.size()==originalStatements.size(),"complete original loop statement inventory differs")||!verifySourceShapeValue(*source,field(raw,"statements"),"[]arrayGenericStatement"))return false;
  pieces={Json("{")};for(size_t i=0;i<statements.size();++i){const auto &s=statements[i];
    if(!need(string(field(s,"kind"))=="expression"&&string(field(field(s,"value"),"kind"))=="fieldAssignment"&&string(field(*originalStatements[i],"kind"))=="KindExpressionStatement"&&same(field(s,"range"),field(*originalStatements[i],"range")),"original Query statement differs")||
      !expression(field(s,"value"),field(raw,"bodyRange"),scope,path)||!g.sequence(field(s,"range"),{field(field(s,"value"),"range")},true))return false;pieces.push_back(field(s,"range"));
  }
  pieces.push_back("}");return g.sequence(field(raw,"bodyRange"),pieces);
}
} // namespace tsfg::systemQuery
