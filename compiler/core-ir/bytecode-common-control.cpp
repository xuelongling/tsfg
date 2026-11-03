// SPDX-License-Identifier: MIT
#include "bytecode-common-model.h"
#include <functional>
#include <set>

namespace tsfg::wire::common {
using namespace commonProgram;
bool Builder::controlTable() {
  std::set<std::pair<std::string,std::vector<std::string>>> lexical;
  for(const auto &scope:scopes)lexical.emplace(scope.owner,scope.path);
  Array functionRows,cells;
  for(const auto &[id,fn]:functions){
    if(!step())return false;Array handlers;
    const auto original=sourceFunctions.find(id);const Json *body;
    if(original!=sourceFunctions.end())body=&field(*original->second,"body");
    else{const Json *module=nullptr;for(const auto &[mid,m]:modules){if(!step())return false;if(string(field(*m,"initializer"))==id)module=m;}
      if(!module)return reject("Common initializer lacks its admitted module body");body=&field(*module,"initialization");}
    std::function<bool(const Array &,const std::string &,const std::vector<std::string> &)> walk;
    walk=[&](const Array &rows,const std::string &path,const std::vector<std::string> &scope){
      for(size_t index=0;index<rows.size();++index){
        if(!step())return false;const auto &row=rows[index];const auto kind=string(field(row,"kind")),at=path+"/"+std::to_string(index);
        const auto descend=[&](const Json &children,const std::string &label,const std::string &childPath){
          auto child=scope;child.push_back(label+":"+std::to_string(index));if(!step(child.size()+1))return false;
          lexical.emplace(id,child);return walk(items(children),childPath,child);
        };
        if(kind=="block"){if(!descend(field(row,"body"),"block",at))return false;}
        else if(kind=="while"){if(!descend(field(row,"body"),"while",at+"/body"))return false;}
        else if(kind=="if"){
          if(!descend(field(row,"then"),"if:then",at+"/then")||!descend(field(row,"else"),"if:else",at+"/else"))return false;
        }else if(kind=="try"){
          const auto handler=id+"/"+at;const bool caught=!field(row,"catchClause").getAsNull(),final=!field(row,"finallyBlock").getAsNull();
          Json catchBinding=nullptr,catchBlock=nullptr;Array finals;
          if(caught&&!field(field(row,"catchClause"),"binding").getAsNull())catchBinding=bindingIds.at(string(field(field(field(row,"catchClause"),"binding"),"id")));
          for(size_t b=0;b<fn->blocks.size();++b)for(const auto &op:fn->blocks[b].operations){
            if(!step())return false;if(string(field(op.properties,"handler"))!=handler)continue;
            if(op.name=="finally_enter")finals.push_back(Object{{"block",int64_t(b)},{"completion",field(op.properties,"completion")}});
            if(op.name!="route"||!caught||string(field(op.properties,"completion"))!="throw")continue;
            const auto next=op.successors[0];const auto &entry=fn->blocks[next].operations.front();
            if(entry.name=="finally_enter"&&string(field(entry.properties,"handler"))==handler)continue;
            if(!catchBlock.getAsNull()&&catchBlock.getAsInteger()!=int64_t(next))return reject("Common handler routes to differing catch entries");catchBlock=next;
          }
          const auto &range=field(row,"range");handlers.push_back(Object{{"id",handler},{"source",sourceIds.at(fn->path)},
            {"range",range},{"hasCatch",caught},{"hasFinally",final},{"catchBinding",std::move(catchBinding)},
            {"catchBlock",std::move(catchBlock)},{"finallyBlocks",std::move(finals)}});
          if(!descend(field(field(row,"tryBlock"),"body"),"try",at+"/try"))return false;
          if(caught&&!descend(field(field(field(row,"catchClause"),"block"),"body"),"catch",at+"/catch"))return false;
          if(final&&!descend(field(field(row,"finallyBlock"),"body"),"finally",at+"/finally"))return false;
        }
      }return true;
    };
    if(!walk(items(*body),"body",{}))return false;
    functionRows.push_back(Object{{"function",functionIds.at(id)},{"handlers",std::move(handlers)}});
  }
  if(lexical.size()>8192)return reject("Common complete lexical scope count bound");scopes.clear();scopeIds.clear();Array scopeRows;
  for(const auto &[owner,path]:lexical){
    if(!step(path.size()+1))return false;scopeIds.emplace(std::pair{owner,path},uint16_t(scopes.size()));scopes.push_back({owner,path});Array parts;
    for(const auto &part:path){if(!step(1+part.size()/64))return false;parts.push_back(part);}
    scopeRows.push_back(Object{{"owner",functionIds.at(owner)},{"path",std::move(parts)}});
  }
  for(const auto &[id,index]:cellIds){if(!step())return false;const auto &b=bindings[bindingIds.at(id)];
    cells.push_back(Object{{"binding",bindingIds.at(id)},{"scope",scopeIds.at({b.owner,b.scope})}});}
  out.table(Table::Exceptions)=Object{{"functions",std::move(functionRows)},{"bindings",std::move(cells)},{"scopes",std::move(scopeRows)}};
  return true;
}
} // namespace tsfg::wire::common
