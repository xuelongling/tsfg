// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
bool prepare(const char *path,Program &p){
  auto bytes=llvm::MemoryBuffer::getFile(path);Error e;
  if(!bytes){llvm::errs()<<"input unavailable\n";return false;}auto text=(*bytes)->getBuffer();if(text.ends_with("\n"))text=text.drop_back();
  if(!readJson(text,p.hir,p,e)){llvm::errs()<<e.message<<"\n";return false;}
  p.inputIdentity=string(field(p.hir,"inputIdentity"));p.sourcePath=string(field(p.hir,"rootFile"));
  for(const auto &source:items(field(p.hir,"sources")))if(string(field(source,"path"))==p.sourcePath){
    p.sourceHash=string(field(source,"hash"));const auto &snapshot=field(field(p.hir,"snapshot"),"payload");
    for(const auto &raw:items(field(snapshot,"files")))if(string(field(raw,"path"))==p.sourcePath)p.sourceLength=field(raw,"utf16Length").getAsInteger().value_or(0);
  }
  return true;
}
void rebind(Program &p){
  auto &snapshot=*p.hir.getAsObject()->get("snapshot");const auto &payload=field(snapshot,"payload");
  const auto id=digest(std::string("tsfg.program-facts.package.v2")+std::string(1,'\0')+sourceSchema.str()+std::string(1,'\0')+canonical(payload));
  (*snapshot.getAsObject())["packageId"]=id;(*p.hir.getAsObject())["inputIdentity"]=id;p.inputIdentity=id;p.remaining=1000000;
}
bool check(const char *name,bool ok){llvm::outs()<<name<<": "<<(ok?"PASS":"FAIL")<<"\n";return ok;}
}
int main(int argc,char **argv){
  bool ok=argc>=3;Program original;
  for(int i=1;i<argc;++i){Program p;Error e;if(!prepare(argv[i],p))return 2;
    const bool accepted=verifySource(p,e);ok&=check(argv[i],accepted);if(!accepted)llvm::errs()<<e.code<<": "<<e.message<<"\n";
    if(i==1)original=std::move(p);
  }
  if(original.hir.getAsNull())return 2;
  const auto negative=[&](const char *name,const std::function<void(Program &)> &mutate){
    Program p;p.hir=original.hir;p.sourceHash=original.sourceHash;p.sourceLength=original.sourceLength;p.sourcePath=original.sourcePath;mutate(p);rebind(p);Error e;
    const bool rejected=!verifySource(p,e);ok&=check(name,rejected);if(!rejected)llvm::errs()<<"malformed cold model admitted\n";
  };
  negative("function spelling target",[](Program &p){
    auto &rows=*p.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload")->getAsObject()->get("functions")->getAsArray();std::string wrong;
    for(auto &f:rows)if(string(field(f,"name"))=="leafRight")wrong=string(field(f,"id"));
    for(auto &f:rows)if(string(field(f,"name"))=="left"){
      auto &body=*f.getAsObject()->get("body")->getAsArray();(*body[0].getAsObject()->get("initializer")->getAsObject())["functionId"]=wrong;
    }
  });
  negative("capture lexical owner",[](Program &p){
    auto &rows=*p.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload")->getAsObject()->get("functions")->getAsArray();
    for(auto &f:rows)if(string(field(f,"name"))=="factory")for(auto &b:*f.getAsObject()->get("bindings")->getAsArray())(*b.getAsObject())["lexicalOwner"]=nullptr;
  });
  negative("nested original scope",[](Program &p){
    auto &rows=*p.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload")->getAsObject()->get("functions")->getAsArray();
    for(auto &f:rows)if(string(field(f,"name"))=="bump")(*f.getAsObject())["declarationScope"]=field(f,"declarationRange");
  });
  negative("stable environment metadata",[](Program &p){
    auto &rows=*p.hir.getAsObject()->get("environments")->getAsArray();(*rows[0].getAsObject())["parent"]="missing";
  });
  for(bool path:{true,false}){
    Program p;p.hir=original.hir;p.sourceHash=original.sourceHash;p.sourceLength=original.sourceLength;p.sourcePath=original.sourcePath;
    std::function<bool(Json &)> mutate=[&](Json &v){
      if(auto *o=v.getAsObject()){
        if(string(field(v,"kind"))=="indirectCall"){
          auto &signature=*o->get("signature");auto &s=*signature.getAsObject();
          if(path)s["sourcePath"]="/src/not-the-original.ts";
          else (*s.getObject("declarationRange"))["start"]=*field(field(signature,"declarationRange"),"start").getAsInteger()+1;
          s["id"]=digest(std::string("tsfg.array-facts.signature.v8")+std::string(1,'\0')+canonical(Object{{"sourcePath",field(signature,"sourcePath")},{"declarationRange",field(signature,"declarationRange")}}));return true;
        }
        for(auto &member:*o)if(mutate(member.second))return true;
      }else if(auto *a=v.getAsArray())for(auto &child:*a)if(mutate(child))return true;return false;
    };
    if(!mutate(*p.hir.getAsObject()->get("snapshot")))return 2;rebind(p);Error e;SourceModel model(p,e);
    const bool accepted=model.directory()&&model.identities()&&model.sourceText();
    const bool correct=!accepted&&e.message.find("indirect signature has no exact original")!=std::string::npos;
    ok&=check(path?"indirect self-hashed foreign signature path":"indirect self-hashed wrong declaration range",correct);
    if(!correct)llvm::errs()<<e.message<<"\n";
  }
  if(argc>3){
    Program shadow;if(!prepare(argv[3],shadow))return 2;Program p;p.hir=shadow.hir;p.sourceHash=shadow.sourceHash;p.sourceLength=shadow.sourceLength;p.sourcePath=shadow.sourcePath;
    auto &rows=*p.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload")->getAsObject()->get("functions")->getAsArray();std::string inner;
    for(auto &f:rows)if(string(field(f,"name"))=="factory"){
      const auto &block=items(field(f,"body"))[1];if(string(field(block,"kind"))=="block")inner=string(field(items(field(block,"body"))[0],"binding"));
    }
    if(inner.empty()){llvm::errs()<<"shadow model input is not original shadow fixture\n";return 2;}
    std::function<void(Json &)> replace=[&](Json &v){
      if(auto *o=v.getAsObject()){if(o->get("binding"))(*o)["binding"]=inner;for(auto &m:*o)replace(m.second);}
      else if(auto *a=v.getAsArray())for(auto &child:*a)replace(child);
    };
    for(auto &f:rows)if(string(field(f,"name"))=="bump"){replace(*f.getAsObject()->get("body"));replace(*f.getAsObject()->get("captures"));}
    rebind(p);Error e;SourceModel model(p,e);const bool accepted=model.directory()&&model.identities()&&model.sourceText();
    ok&=check("same-owner block shadow is not lexical capture authority",!accepted&&e.message.find("function-body declaration")!=std::string::npos);
    if(accepted||e.message.find("function-body declaration")==std::string::npos)llvm::errs()<<e.message<<"\n";
  }
  return ok?0:1;
}
