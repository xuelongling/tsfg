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

Array *arrayMember(Json &owner,llvm::StringRef name){
  auto *object=owner.getAsObject();
  return object?object->getArray(name):nullptr;
}
Json *namedRow(Array *rows,llvm::StringRef key,llvm::StringRef value){
  if(!rows)return nullptr;
  for(auto &row:*rows)if(field(row,key).getAsString()==value)return &row;
  return nullptr;
}
Array *moduleRows(Json &payload,llvm::StringRef source){
  auto *module=namedRow(arrayMember(payload,"modules"),"sourcePath",source);
  return module?arrayMember(*module,"exports"):nullptr;
}
bool moveOccurrence(Json &payload,llvm::StringRef source,llvm::StringRef name,llvm::StringRef sibling){
  auto *rows=moduleRows(payload,source);
  auto *row=namedRow(rows,"name",name),*other=namedRow(rows,"name",sibling);
  if(!row||!other||same(field(*row,"range"),field(*other,"range")))return false;
  (*row->getAsObject())["range"]=field(*other,"range");
  return true;
}
bool removeRows(Array &rows,llvm::StringRef key,llvm::StringRef value){
  bool removed=false;
  for(auto it=rows.begin();it!=rows.end();){
    if(field(*it,key).getAsString()==value){it=rows.erase(it);removed=true;}
    else ++it;
  }
  return removed;
}
struct ModuleResult {
  bool directory,identities,accepted;
  Error error;
};
ModuleResult readModuleModel(Program &program){
  Error error;SourceModel model(program,error);
  const bool directory=model.directory(),identities=directory&&model.identities();
  const bool accepted=identities&&model.sourceText();
  return {directory,identities,accepted,std::move(error)};
}
int moduleExports(const char *path){
  Program original;
  if(!prepare(path,original)||original.inputIdentity!="sha256:d874f6097cd20fdb0a3740634407e5c4b3408b3dadcc00c761a56d657b4ad457")return 2;
  Program control=original;
  const auto baseline=readModuleModel(control);
  if(!check("retained four-module input",baseline.directory&&baseline.identities&&baseline.accepted)){
    llvm::errs()<<baseline.error.code<<": "<<baseline.error.message<<"\n";
    return 1;
  }
  bool ok=true;
  const auto negative=[&](const char *label,auto mutate,llvm::StringRef message,llvm::StringRef historicalMessage={}){
    Program changed=original;
    auto &snapshot=*changed.hir.getAsObject()->get("snapshot");
    auto &payload=*snapshot.getAsObject()->get("payload");
    if(!mutate(payload)){
      ok&=check(label,false);llvm::errs()<<"expected retained export occurrence missing\n";return;
    }
    rebind(changed);
    const auto outcome=readModuleModel(changed);
    const bool expected=outcome.directory&&outcome.identities&&!outcome.accepted&&outcome.error.code=="core-ir-common-source"&&
      (outcome.error.message==message||(!historicalMessage.empty()&&outcome.error.message==historicalMessage));
    ok&=check(label,expected);
    llvm::outs()<<"  directory="<<outcome.directory<<" identities="<<outcome.identities<<" accepted="<<outcome.accepted<<"\n";
    if(!outcome.error.code.empty())llvm::outs()<<"  "<<outcome.error.code<<": "<<outcome.error.message<<"\n";
  };
  constexpr llvm::StringLiteral direct="direct export does not match its original declaration";
  constexpr llvm::StringLiteral kind="export kind, occurrence or definition differs";
  negative("direct function public name",[](Json &payload){
    auto *row=namedRow(moduleRows(payload,"/src/main.ts"),"name","ordinary");
    auto *root=namedRow(arrayMember(payload,"exports"),"name","ordinary");
    if(!row||!root)return false;
    (*row->getAsObject())["name"]="other";(*root->getAsObject())["name"]="other";
    return true;
  },direct);
  negative("direct function target",[](Json &payload){
    auto *rows=moduleRows(payload,"/src/main.ts");
    auto *row=namedRow(rows,"name","ordinary"),*view=namedRow(rows,"name","view");
    auto *root=namedRow(arrayMember(payload,"exports"),"name","ordinary");
    auto *parameters=arrayMember(payload,"entryCompatibilityRoots");
    if(!row||!view||!root||!parameters)return false;
    const auto former=string(field(*row,"target"));
    (*row->getAsObject())["target"]=field(*view,"target");
    (*row->getAsObject())["definitionRange"]=field(*view,"definitionRange");
    (*root->getAsObject())["functionId"]=field(*view,"target");
    removeRows(*parameters,"functionId",former);
    return true;
  },direct);
  negative("direct nominal occurrence",[](Json &payload){return moveOccurrence(payload,"/src/data.ts","Box","Delta");},direct);
  negative("direct global occurrence",[](Json &payload){return moveOccurrence(payload,"/src/state.ts","leftTotal","rightTotal");},direct);
  negative("direct nominal export kind",[](Json &payload){
    auto *row=namedRow(moduleRows(payload,"/src/data.ts"),"name","Box");
    if(!row||field(*row,"kind").getAsString()!="type")return false;
    (*row->getAsObject())["kind"]="function";return true;
  },kind);
  negative("direct function omission",[](Json &payload){
    auto *rows=moduleRows(payload,"/src/main.ts"),*root=arrayMember(payload,"exports");
    auto *row=namedRow(rows,"name","ordinary");
    auto *parameters=arrayMember(payload,"entryCompatibilityRoots");
    if(!row||!root||!parameters)return false;
    const auto former=string(field(*row,"target"));
    removeRows(*parameters,"functionId",former);
    return removeRows(*rows,"name","ordinary")&&removeRows(*root,"name","ordinary");
  },direct);
  negative("wrong named re-export occurrence",[](Json &payload){return moveOccurrence(payload,"/src/barrel.ts","add","bump");},
    "named re-export differs from original alias");
  negative("existing definition range control",[](Json &payload){
    auto *rows=moduleRows(payload,"/src/data.ts");
    auto *row=namedRow(rows,"name","Box"),*other=namedRow(rows,"name","Delta");
    if(!row||!other)return false;
    (*row->getAsObject())["definitionRange"]=field(*other,"definitionRange");return true;
  },kind,"export occurrence/definition join differs");
  return ok?0:1;
}

int localExports(const char *path){
  Program original;
  if(!prepare(path,original)||original.inputIdentity!="sha256:5d908acb3d7157f07854abdd22d6e027cebaa68c9d31d42096804069db46b423")return 2;
  const auto report=[](const ModuleResult &outcome){
    llvm::outs()<<"  directory="<<outcome.directory<<" identities="<<outcome.identities<<" accepted="<<outcome.accepted<<"\n";
    if(!outcome.error.code.empty())llvm::outs()<<"  "<<outcome.error.code<<": "<<outcome.error.message<<"\n";
  };
  Program control=original;
  const auto baseline=readModuleModel(control);
  bool ok=check("retained local binding, imported function and imported nominal",baseline.directory&&baseline.identities&&baseline.accepted);
  report(baseline);
  const auto negative=[&](const char *label,auto mutate){
    Program changed=original;
    auto &snapshot=*changed.hir.getAsObject()->get("snapshot");
    auto &payload=*snapshot.getAsObject()->get("payload");
    if(!mutate(payload)){ok&=check(label,false);return;}
    rebind(changed);
    const auto outcome=readModuleModel(changed);
    ok&=check(label,outcome.directory&&outcome.identities&&!outcome.accepted&&outcome.error.code=="core-ir-common-source"&&
      outcome.error.message=="local export differs from its original binding");
    report(outcome);
  };
  negative("local alias references another visible function",[](Json &payload){
    auto *rows=moduleRows(payload,"/src/main.ts");
    auto *row=namedRow(rows,"name","alias"),*other=namedRow(rows,"name","importedRun");
    auto *root=namedRow(arrayMember(payload,"exports"),"name","alias");
    if(!row||!other||!root)return false;
    for(const auto *key:{"target","targetSourcePath","definitionRange"}) (*row->getAsObject())[key]=field(*other,key);
    (*root->getAsObject())["functionId"]=field(*other,"target");
    return true;
  });
  negative("local alias omitted from both directories",[](Json &payload){
    auto *rows=moduleRows(payload,"/src/main.ts"),*root=arrayMember(payload,"exports");
    return rows&&root&&removeRows(*rows,"name","alias")&&removeRows(*root,"name","alias");
  });
  negative("local alias name absent from original Source",[](Json &payload){
    auto *row=namedRow(moduleRows(payload,"/src/main.ts"),"name","alias");
    auto *root=namedRow(arrayMember(payload,"exports"),"name","alias");
    if(!row||!root)return false;
    (*row->getAsObject())["name"]="also";(*root->getAsObject())["name"]="also";
    return true;
  });
  negative("clause span differs from local specifier span",[](Json &payload){
    auto *row=namedRow(moduleRows(payload,"/src/main.ts"),"name","alias");
    auto *raw=namedRow(arrayMember(payload,"files"),"path","/src/main.ts");
    if(!row||!raw)return false;
    const auto start=field(field(*row,"range"),"start").getAsInteger().value_or(0);
    const auto length=field(*raw,"utf16Length").getAsInteger().value_or(0);
    if(start<9||length<=start)return false;
    (*row->getAsObject())["range"]=Object{{"start",start-9},{"end",length-1}};
    return true;
  });
  negative("local nominal row references another exported type",[](Json &payload){
    auto *row=namedRow(moduleRows(payload,"/src/main.ts"),"name","Box");
    auto *other=namedRow(moduleRows(payload,"/src/data.ts"),"name","Delta");
    if(!row||!other)return false;
    for(const auto *key:{"target","targetSourcePath","definitionRange"}) (*row->getAsObject())[key]=field(*other,key);
    return true;
  });
  return ok?0:1;
}
}
int main(int argc,char **argv){
  if(argc>1&&llvm::StringRef(argv[1])=="--local-exports"){
    if(argc!=3){llvm::errs()<<"expected --local-exports retained-hir\n";return 2;}
    return localExports(argv[2]);
  }
  if(argc>1&&llvm::StringRef(argv[1])=="--module-exports"){
    if(argc!=3){llvm::errs()<<"expected --module-exports retained-hir\n";return 2;}
    return moduleExports(argv[2]);
  }
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
    rebind(p);Error e;SourceModel model(p,e);
    const bool identified=model.directory()&&model.identities();
    const bool rejected=identified&&!model.sourceText()&&e.code=="core-ir-common-source"
      &&e.message=="original binding reference resolves to another symbol";
    ok&=check("same-owner block shadow is not lexical capture authority",rejected);
    if(!rejected)llvm::errs()<<e.message<<"\n";
  }
  return ok?0:1;
}
