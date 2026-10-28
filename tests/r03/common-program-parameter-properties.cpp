// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
using namespace tsfg::commonProgram;
namespace {
bool load(const char *path,Program &p){
  const auto bytes=llvm::MemoryBuffer::getFile(path);Error error;
  if(!bytes){llvm::errs()<<"original HIR unavailable\n";return false;}
  auto parsed=llvm::json::parse((*bytes)->getBuffer());if(!parsed){llvm::errs()<<llvm::toString(parsed.takeError())<<"\n";return false;}
  if(!readJson(canonical(*parsed),p.hir,p,error)){llvm::errs()<<error.message<<"\n";return false;}
  p.inputIdentity=string(field(p.hir,"inputIdentity"));p.sourcePath=string(field(p.hir,"rootFile"));
  for(const auto &source:items(field(p.hir,"sources")))if(string(field(source,"path"))==p.sourcePath)p.sourceHash=string(field(source,"hash"));
  for(const auto &source:items(field(field(field(p.hir,"snapshot"),"payload"),"files")))
    if(string(field(source,"path"))==p.sourcePath)p.sourceLength=field(source,"utf16Length").getAsInteger().value_or(0);
  return true;
}
Json &payload(Program &p){return *p.hir.getAsObject()->get("snapshot")->getAsObject()->get("payload");}
Json &nominal(Program &p,llvm::StringRef name){
  for(auto &type:*payload(p).getAsObject()->get("types")->getAsArray())if(string(field(type,"name"))==name)return type;
  llvm_unreachable("original complete fixture has the required nominal");
}
Json &property(Program &p){return (*nominal(p,"SpanHolder").getAsObject()->get("fields")->getAsArray())[0];}
Json &parameter(Program &p){return (*nominal(p,"SpanHolder").getAsObject()->get("constructor")->getAsObject()->get("parameters")->getAsArray())[0];}
Json &ordinary(Program &p){
  for(auto &fn:*payload(p).getAsObject()->get("functions")->getAsArray())if(string(field(fn,"name"))=="ordinary")return fn;
  llvm_unreachable("original complete fixture has ordinary");
}
void rebind(Program &p){
  const auto id=digest(std::string("tsfg.program-facts.package.v2")+std::string(1,'\0')+sourceSchema.str()+std::string(1,'\0')+canonical(payload(p)));
  (*p.hir.getAsObject()->get("snapshot")->getAsObject())["packageId"]=id;(*p.hir.getAsObject())["inputIdentity"]=id;p.inputIdentity=id;
}
bool report(const char *name,bool ok,const Error &error={}){
  llvm::outs()<<name<<": "<<(ok?"PASS":"FAIL");if(!error.message.empty())llvm::outs()<<" ["<<error.code<<"] "<<error.message;
  llvm::outs()<<"\n";return ok;
}
}
int main(int argc,char **argv){
  if(argc!=3)return 2;Program original;bool ok=true;
  for(int i=1;i<argc;++i){Program p;Error e;if(!load(argv[i],p))return 2;
    ok&=report(i==1?"real safe public parameter property":"real conflict input Source cold only",verifySource(p,e),e);
    if(i==1)original=std::move(p);
  }
  // These are hash-repaired malformed cold models of an unchanged official
  // complete packet. They carry no new Source, borrow or execution coverage.
  const auto negative=[&](const char *name,const std::function<void(Program &)> &mutate,llvm::StringRef expected){
    Program p;p.hir=original.hir;p.sourceHash=original.sourceHash;p.sourceLength=original.sourceLength;p.sourcePath=original.sourcePath;
    mutate(p);rebind(p);Error e;const bool accepted=verifySource(p,e);
    const bool rejected=!accepted&&e.code=="core-ir-common-source"&&llvm::StringRef(e.message).contains(expected);
    ok&=report(name,rejected,e);
  };
  negative("parameter property readonly matches original token",[](Program &p){(*property(p).getAsObject())["readonly"]=true;},"parameter property source, type or modifiers");
  negative("parameter property access matches original token",[](Program &p){(*property(p).getAsObject())["access"]="private";},"parameter property source, type or modifiers");
  negative("parameter property original occurrence",[](Program &p){auto &o=*property(p).getAsObject()->get("origin")->getAsObject();o["start"]=*o.getInteger("start")+1;},"parameter property source, type or modifiers");
  negative("parameter property name matches parameter",[](Program &p){(*property(p).getAsObject())["name"]="different";},"parameter property source, type or modifiers");
  negative("parameter property field identity",[](Program &p){(*property(p).getAsObject())["id"]="sha256:"+std::string(64,'0');},"parameter property source, type or modifiers");
  negative("parameter property logical type",[](Program &p){(*property(p).getAsObject())["type"]="i32";},"parameter property source, type or modifiers");
  negative("parameter property original binding",[](Program &p){(*property(p).getAsObject())["parameterBinding"]=field(items(field(ordinary(p),"parameters"))[0],"id");},"parameter property does not join");
  negative("property cannot be an ordinary field",[](Program &p){property(p).getAsObject()->erase("parameterBinding");},"parameter property does not join");
  negative("property declaration cannot omit owned field",[](Program &p){auto &type=*nominal(p,"SpanHolder").getAsObject();type["fields"]=Array{};(*type.get("construction")->getAsObject())["initializationFields"]=Array{};},"parameter property does not join");
  negative("property parameter remains a real parameter",[](Program &p){(*parameter(p).getAsObject())["kind"]="local";},"original parameter kind");
  negative("ordinary parameter kind remains checked",[](Program &p){(*ordinary(p).getAsObject()->get("parameters")->getAsArray())[0].getAsObject()->operator[]("kind")="local";},"original parameter kind");
  negative("ordinary parameter annotation remains checked",[](Program &p){(*ordinary(p).getAsObject()->get("parameters")->getAsArray())[0].getAsObject()->operator[]("declaredType")="u32";},"original annotation does not name");
  negative("ordinary class readonly write remains rejected",[](Program &p){(*nominal(p,"Box").getAsObject()->get("fields")->getAsArray())[0].getAsObject()->operator[]("readonly")=true;},"readonly member write");
  negative("ordinary class private access remains rejected",[](Program &p){(*nominal(p,"Box").getAsObject()->get("fields")->getAsArray())[0].getAsObject()->operator[]("access")="private";},"member access permission");
  negative("ordinary field modifiers match original Source",[](Program &p){(*nominal(p,"Delta").getAsObject()->get("fields")->getAsArray())[0].getAsObject()->operator[]("readonly")=true;},"original field name/modifiers");
  return ok?0:1;
}
