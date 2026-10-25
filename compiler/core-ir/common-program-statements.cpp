// SPDX-License-Identifier: MIT
#include "common-program-syntax.h"
namespace tsfg::commonProgram {
bool SourceBodies::statements(const Json &rows,size_t first,size_t end){
  if(!model.spend(scope.size()+initialized.size()))return false;
  for(const auto &[name,id]:scope)if(!model.spend((name.size()+id.size())/8+1))return false;
  for(const auto &id:initialized)if(!model.spend(id.size()/8+1))return false;
  auto outerScope=scope;auto outerInitialized=initialized;size_t at=first;
  std::function<bool(const Json &,size_t &,size_t)> branch;
  branch=[&](const Json &body,size_t &cursor,size_t limit){
    if(!model.need(cursor<limit,"original branch body missing"))return false;
    if(source->tokens[cursor].text=="{"){
      size_t finish=cursor+1;unsigned depth=1;
      while(finish<limit&&depth){if(!model.spend())return false;const auto &token=source->tokens[finish++].text;
        if(token=="{")++depth;else if(token=="}")--depth;}
      if(!model.need(!depth,"original branch block does not close")||!statements(body,cursor+1,finish-1))return false;cursor=finish;return true;
    }
    if(!model.need(items(body).size()==1,"unbraced original branch does not have one statement"))return false;
    size_t a,b;if(!source->span(field(items(body)[0],"range"),a,b)||!model.need(a==cursor&&b<=limit,"original branch range differs"))return false;
    if(b<limit&&source->tokens[b].text==";")++b;
    if(!statements(body,cursor,b))return false;cursor=b;return true;
  };
  for(const auto &row:items(rows)){
    if(!model.spend())return false;size_t a,b;if(!source->span(field(row,"range"),a,b))return false;
    const auto kind=string(field(row,"kind"));const auto bindingId=string(field(row,"binding"));
    if(kind=="constDeclaration"||kind=="letDeclaration"||kind=="initialize"){
      const auto keyword=kind=="constDeclaration"?"const":kind=="letDeclaration"?"let":
        model.globals.count(bindingId)?string(field(*model.globals.at(bindingId),"bindingKind")):std::string();
      if(!model.need(at<end&&(source->tokens[at].text==keyword||source->tokens[at].text==","),"original declaration prefix differs"))return false;++at;
    }
    if(!model.need(a==at&&b<=end,"missing/reordered original statement"))return false;
    if(kind=="constDeclaration"||kind=="letDeclaration"||kind=="initialize"){
      if(!model.need(bindings.count(bindingId),"declaration storage absent from complete inventory"))return false;const auto &binding=*bindings.at(bindingId);
      const bool global=kind=="initialize";
      if(!model.need(global?model.globals.count(bindingId)&&string(field(*model.globals.at(bindingId),"sourcePath"))==source->path:
        string(field(binding,"kind"))=="local"&&!declared.count(bindingId)&&field(binding,"writable").getAsBoolean()==(kind=="letDeclaration"),"original local/global declaration kind differs")||
        !expression(field(row,"initializer"))||!model.need(logical(string(field(field(row,"initializer"),"flowType")),string(field(binding,"declaredType"))),"declaration initializer slot differs"))return false;
      std::vector<Json> pieces{field(binding,"nameRange")};
      if(!field(binding,"annotationRange").getAsNull()){
        if(!annotation(field(binding,"annotationRange"),string(field(binding,"declaredType"))))return false;
        pieces.push_back(":");pieces.push_back(field(binding,"annotationRange"));
      }
      pieces.push_back("=");pieces.push_back(field(field(row,"initializer"),"range"));
      if(!model.need(same(field(row,"range"),field(binding,"declarationRange")),"declaration anchor differs from storage")||!source->sequence(field(row,"range"),pieces))return false;
      scope[string(field(binding,"name"))]=bindingId;initialized.insert(bindingId);declared.insert(bindingId);
    }else if(kind=="return"||kind=="throw"||kind=="expression"){
      std::vector<Json> pieces;if(kind!="expression")pieces.push_back(kind);
      if(row.getAsObject()->get("value")){
        if(!expression(field(row,"value"))||kind=="return"&&!model.need(logical(string(field(field(row,"value"),"flowType")),string(field(*current,"returnType"))),"return flow does not satisfy original function result"))return false;pieces.push_back(field(field(row,"value"),"range"));
      }else if(!model.need(kind=="return"&&string(field(*current,"returnType"))=="void","missing original completion value"))return false;
      if(!source->sequence(field(row,"range"),pieces,true))return false;
    }else if(kind=="block"){
      if(!model.need(source->tokens[a].text=="{"&&source->tokens[b-1].text=="}","original block punctuation differs")||!statements(field(row,"body"),a+1,b-1))return false;
    }else if(kind=="if"||kind=="while"){
      if(!expression(field(row,"condition"))||!model.need(string(field(field(row,"condition"),"flowType"))=="bool","original condition is not bool"))return false;
      size_t c,d;if(!source->span(field(field(row,"condition"),"range"),c,d)||
        !model.need(a+2==c&&source->tokens[a].text==kind&&source->tokens[a+1].text=="("&&d<b&&source->tokens[d].text==")","original conditional header differs"))return false;
      auto cursor=d+1;if(!branch(field(row,kind=="if"?"then":"body"),cursor,b))return false;
      if(kind=="if"){
        if(cursor<b&&source->tokens[cursor].text=="else"){++cursor;if(!branch(field(row,"else"),cursor,b))return false;}
        else if(!model.need(items(field(row,"else")).empty(),"unrepresented original else body"))return false;
      }
      if(!model.need(cursor==b,"original conditional trailing syntax differs"))return false;
    }else if(kind=="try"){
      const auto &tb=field(row,"tryBlock");size_t c,d;
      if(!source->span(field(tb,"range"),c,d)||!model.need(source->tokens[c].text=="{"&&source->tokens[d-1].text=="}","original try block differs")||
        !statements(field(tb,"body"),c+1,d-1))return false;
      std::vector<Json> pieces{Json("try"),field(tb,"range")};
      if(row.getAsObject()->get("catchClause")){
        const auto &caught=field(row,"catchClause"),&binding=field(caught,"binding"),&block=field(caught,"block");
        if(!model.spend(scope.size()+initialized.size()))return false;
        for(const auto &[name,id]:scope)if(!model.spend((name.size()+id.size())/8+1))return false;
        for(const auto &id:initialized)if(!model.spend(id.size()/8+1))return false;
        std::vector<Json> catchPieces{Json("catch")};auto savedScope=scope;auto savedInitialized=initialized;
        if(!binding.getAsNull()){
          const auto id=string(field(binding,"id"));
          if(!model.need(bindings.count(id)&&same(binding,*bindings.at(id))&&string(field(binding,"kind"))=="catch"&&
            string(field(binding,"declaredType"))=="unknown"&&!declared.count(id)&&same(field(caught,"declarationRange"),field(binding,"declarationRange")),"original catch binding/scope differs"))return false;
          if(!source->sequence(field(caught,"declarationRange"),{field(binding,"nameRange")}))return false;
          catchPieces.push_back("(");catchPieces.push_back(field(caught,"declarationRange"));catchPieces.push_back(")");
          scope[string(field(binding,"name"))]=id;initialized.insert(id);declared.insert(id);
        }else if(!model.need(bool(field(caught,"declarationRange").getAsNull()),"bindingless catch declaration differs"))return false;
        size_t ca,cb;if(!source->span(field(block,"range"),ca,cb)||!model.need(source->tokens[ca].text=="{"&&source->tokens[cb-1].text=="}","original catch block differs")||
          !statements(field(block,"body"),ca+1,cb-1))return false;
        scope=std::move(savedScope);initialized=std::move(savedInitialized);catchPieces.push_back(field(block,"range"));
        if(!source->sequence(field(caught,"range"),catchPieces))return false;pieces.push_back(field(caught,"range"));
      }
      if(row.getAsObject()->get("finallyBlock")){
        const auto &final=field(row,"finallyBlock");size_t fa,fb;
        if(!source->span(field(final,"range"),fa,fb)||!model.need(source->tokens[fa].text=="{"&&source->tokens[fb-1].text=="}","original finally block differs")||
          !statements(field(final,"body"),fa+1,fb-1))return false;pieces.push_back("finally");pieces.push_back(field(final,"range"));
      }
      if(!model.need(row.getAsObject()->get("catchClause")||row.getAsObject()->get("finallyBlock"),"try lacks catch/finally")||!source->sequence(field(row,"range"),pieces))return false;
    }else return model.need(false,"unsupported complete common Source statement; no omission permitted");
    at=b;if(at<end&&source->tokens[at].text==";")++at;
  }
  if(!model.need(at==end,"unrepresented original body statement"))return false;
  scope=std::move(outerScope);initialized=std::move(outerInitialized);return true;
}
} // namespace tsfg::commonProgram
