// SPDX-License-Identifier: MIT
#include "common-program-source.h"
#include <algorithm>
namespace tsfg::commonProgram {
namespace {
struct Types {
  Program &p;Error &e;
  std::map<std::string,Json> builtins;
  std::map<std::string,const Json *> types,domains,bindings,functions;
  std::set<std::string> active;
  std::map<std::string,const Json *> environments;
  bool need(bool c,llvm::StringRef message){return c||reject(e,"core-ir-common-representation",message);}
  bool step(size_t n=1){return p.charge(n)||reject(e,"core-ir-common-budget","physical type/capacity directory work exceeded");}
  bool internal(const std::string &id)const{
    const auto key=llvm::StringRef(id);const auto prefix=key.starts_with("receiver:")?9:key.starts_with("initialization:")?15:0;
    if(!prefix)return false;const auto owner=types.find(id.substr(prefix));
    return owner!=types.end()&&!field(*owner->second,"construction").getAsNull()&&
      (string(field(*owner->second,"kind"))=="reference"||string(field(*owner->second,"kind"))=="value");
  }
  bool valid(const std::string &id)const{return id=="void"||id=="payload:"+schema.str()||types.count(id)||domains.count(id)||environments.count(id)||internal(id);}
  std::vector<const Json *> fields(const std::string &id){
    std::vector<const Json *> result;std::set<std::string> visited;std::vector<const Json *> chain;auto current=id;
    while(!current.empty()){
      if(!step()||!need(types.count(current)&&visited.insert(current).second,"cyclic or unowned inheritance"))return {};
      const auto *t=types.at(current);chain.push_back(t);current=string(field(*t,"base"));
    }
    for(auto i=chain.rbegin();i!=chain.rend();++i)for(const auto &f:items(field(**i,"fields"))){
      if(!step()||!need(result.size()<65536,"physical member count exceeded"))return {};result.push_back(&f);
    }return result;
  }
  const Layout &layout(const std::string &id){
    static const Layout failed;
    if(p.layouts.count(id))return p.layouts.at(id);Layout out;
    if(!step()||!need(valid(id)&&active.insert(id).second,"cyclic/unowned inline physical layout"))return failed;
    const auto align=[](uint32_t bytes,uint32_t a){return (bytes+a-1)/a*a;};
    const auto *t=types.count(id)?types.at(id):nullptr;const auto kind=t?string(field(*t,"kind")):std::string();
    if(internal(id))out={llvm::StringRef(id).starts_with("receiver:")?32u:16u,8,1,{}};
    else if(environments.count(id))out={8,8,1,{}};
    else if(kind=="function")out={40,8,1,{}};
    else if(id=="payload:"+schema.str()||kind=="unknown")out={16,8,1,{}};
    else if(kind=="scalar"){
      static const std::map<std::string,uint32_t> widths={{"bool",1},{"i8",1},{"u8",1},{"i16",2},{"u16",2},
        {"i32",4},{"u32",4},{"f32",4},{"i64",8},{"u64",8},{"isize",8},{"usize",8},{"f64",8}};
      auto found=widths.find(string(field(*t,"name")));if(!need(found!=widths.end(),"scalar physical width differs"))return failed;out.byteSize=out.alignment=found->second;
    }else if(kind=="reference"||kind=="array"||kind=="string")out={8,8,1,{}};
    else if(kind=="readSpan")out={16,8,1,{}};
    else if(kind=="value"){
      for(const auto *f:fields(id)){
        const auto binding=string(field(*f,"sourceBinding"));if(!need(bindings.count(binding),"field physical storage capacity missing"))return failed;
        const auto &child=layout(string(field(*bindings.at(binding),"carrier")));out.byteSize=align(out.byteSize,child.alignment);
        out.fieldOffsets.push_back(out.byteSize);out.byteSize+=child.byteSize;out.alignment=std::max(out.alignment,child.alignment);out.referenceCount+=child.referenceCount;
        if(!need(out.byteSize<=65536&&out.referenceCount<=256,"inline physical layout budget exceeded"))return failed;
      }out.byteSize=align(out.byteSize,out.alignment);
    }else if(domains.count(id)){
      const auto &d=*domains.at(id);bool reference=!items(field(d,"actualTypes")).empty();
      for(const auto &member:items(field(d,"actualTypes"))){
        if(!step())return failed;const auto key=string(member),memberKind=string(field(*types.at(key),"kind"));const auto &child=layout(key);
        out.byteSize=std::max(out.byteSize,child.byteSize);out.alignment=std::max(out.alignment,child.alignment);out.referenceCount=std::max(out.referenceCount,child.referenceCount);
        reference&=memberKind=="reference"||memberKind=="array"||memberKind=="string";
      }
      const auto count=items(field(d,"actualTypes")).size();const bool tagged=count>1&&!reference;const auto tag=tagged?2:0;
      if(tagged){out.byteSize=align(align(2,out.alignment)+out.byteSize,std::max(2u,out.alignment));out.alignment=std::max(2u,out.alignment);}
      if(!need(field(d,"byteSize").getAsInteger()==out.byteSize&&field(d,"alignment").getAsInteger()==out.alignment&&
        field(d,"referenceCount").getAsInteger()==out.referenceCount&&field(d,"tagBytes").getAsInteger()==tag&&
        string(field(d,"representation"))==(!count?"bottom":reference?"reference":count==1?"absence":"finite-union"),"independent actual domain bytes/alignment/tag/GC count differs"))return failed;
    }else if(!need(id=="void"||kind=="undefined"||kind=="null"||kind=="void","nonactual union/static view used as physical carrier"))return failed;
    if(!need(out.byteSize<=65536&&out.referenceCount<=256,"physical type/root count exceeded"))return failed;
    active.erase(id);return p.layouts.emplace(id,std::move(out)).first->second;
  }
  bool run(){
    const auto &r=p.representation;
    if(!need(exact(r,{"domains","bindings","functions","internalConstructors"})&&field(r,"domains").getAsArray()&&items(field(r,"domains")).size()<=4096&&
      field(r,"bindings").getAsArray()&&items(field(r,"bindings")).size()<=65536&&field(r,"functions").getAsArray()&&field(r,"internalConstructors").getAsArray(),"complete four-table physical representation required"))return false;
    if(!prepareInternalConstructors(p,e))return false;
    for(const auto &t:items(field(p.hir,"types"))){if(!step())return false;types.emplace(string(field(t,"id")),&t);}
    for(const auto &[id,t]:p.internalTypes){if(!step())return false;types.emplace(id,&t);}
    for(auto kind:{"bool","undefined","null"}){
      const auto id=digest(std::string("tsfg.type")+std::string(1,'\0')+kind);
      if(!types.count(id)){builtins.emplace(id,Object{{"id",id},{"kind",llvm::StringRef(kind)=="bool"?"scalar":kind},{"name",kind}});types.emplace(id,&builtins.at(id));}
    }
    for(const auto &environment:items(field(p.hir,"environments"))){
      if(!step()||!need(environments.emplace("env:"+string(field(environment,"id")),&environment).second,"duplicate environment carrier"))return false;
    }
    std::set<std::string> storage;
    const auto add=[&](const std::string &id){return step()&&need(!id.empty()&&storage.insert(id).second,"duplicate original physical storage identity");};
    for(const auto &fn:items(field(p.hir,"functions"))){
      for(auto key:{"parameters","bindings"})for(const auto &b:items(field(fn,key)))if(!add(string(field(b,"id"))))return false;
      if(!field(fn,"receiverBinding").getAsNull()&&!add(string(field(fn,"receiverBinding"))))return false;
    }
    for(const auto &g:items(field(p.hir,"globals")))if(!add(string(field(g,"sourceBinding"))))return false;
    for(const auto &[id,t]:types){
      for(const auto &f:items(field(*t,"fields")))if(!add(string(field(f,"sourceBinding"))))return false;
      if(string(field(*t,"kind"))=="array"&&!add("element:"+id))return false;
    }
    std::string previous;
    for(const auto &d:items(field(r,"domains"))){const auto id=string(field(d,"id"));
      if(!step()||!need(exact(d,{"id","actualTypes","representation","alignment","tagBytes","byteSize","referenceCount"})&&
        field(d,"actualTypes").getAsArray()&&items(field(d,"actualTypes")).size()<=256&&(previous.empty()||previous<id)&&
        domains.emplace(id,&d).second&&id==digest(std::string("tsfg.actual-domain.v1")+std::string(1,'\0')+canonical(field(d,"actualTypes"))),"actual domain identity/shape/order differs"))return false;
      previous=id;std::string prior;for(const auto &member:items(field(d,"actualTypes"))){const auto key=string(member);
        if(!step()||!need(types.count(key)&&(prior.empty()||prior<key)&&string(field(*types.at(key),"kind"))!="unknown"&&
          string(field(*types.at(key),"kind"))!="union"&&string(field(*types.at(key),"kind"))!="void","domain actual alternative differs"))return false;prior=key;}
    }
    previous.clear();
    for(const auto &b:items(field(r,"bindings"))){const auto id=string(field(b,"id")),carrier=string(field(b,"carrier"));
      if(!step()||!need(exact(b,{"id","carrier"})&&storage.count(id)&&valid(carrier)&&!internal(carrier)&&carrier!="void"&&(previous.empty()||previous<id)&&bindings.emplace(id,&b).second,"complete conditional storage directory differs"))return false;previous=id;
    }
    if(!need(bindings.size()==storage.size(),"omitted physical field/Array/Binding storage"))return false;
    std::map<std::string,const Json *> expected;for(const auto &fn:items(field(p.hir,"functions")))expected.emplace(string(field(fn,"id")),&fn);
    for(const auto &m:items(field(p.hir,"modules")))expected.emplace(string(field(m,"initializer")),&m);previous.clear();
    for(const auto &f:items(field(r,"functions"))){const auto id=string(field(f,"id"));
      if(!step()||!need(exact(f,{"id","parameters","result"})&&expected.count(id)&&field(f,"parameters").getAsArray()&&
        (previous.empty()||previous<id)&&valid(string(field(f,"result")))&&!internal(string(field(f,"result")))&&functions.emplace(id,&f).second,"complete physical function ABI identity/order differs"))return false;
      previous=id;
      const auto &owner=*expected.at(id);const bool init=owner.getAsObject()->get("initializer");
      const auto count=init?0:items(field(owner,"parameters")).size()+(!field(owner,"ownerType").getAsNull())+(!field(owner,"lexicalEnvironment").getAsNull());
      if(!need(items(field(f,"parameters")).size()==count&&(!init||string(field(f,"result"))=="void"),"physical function ABI arity/result differs"))return false;
      if(!init&&!field(owner,"lexicalEnvironment").getAsNull()&&!need(!items(field(f,"parameters")).empty()&&string(items(field(f,"parameters"))[0])=="env:"+string(field(owner,"lexicalEnvironment")),"hidden lexical environment ABI differs"))return false;
      const bool constructor=!init&&string(field(owner,"kind"))=="construction-body";size_t parameterIndex=0;
      const size_t frameIndex=!field(owner,"lexicalEnvironment").getAsNull();
      for(const auto &a:items(field(f,"parameters"))){const auto carrier=string(a);const bool frame=constructor&&parameterIndex++==frameIndex;
        if(!step()||!need(valid(carrier)&&carrier!="void"&&(frame?carrier=="receiver:"+string(field(owner,"ownerType")):!internal(carrier)),"physical parameter/frame carrier differs"))return false;}
    }
    if(!need(functions.size()==expected.size()&&p.functions.size()==expected.size(),"complete Core function/init inventory omitted"))return false;
    // The public storage/function equalities above remain exact. Internal
    // records are a separate typed boundary, reconstructed from owned HIR.
    previous.clear();
    for(const auto &row:items(field(r,"internalConstructors"))){
      if(!internalConstructionCost(p,row,e))return false;const auto id=string(field(row,"id"));auto owner=p.internalOwners.find(id);
      if(!need(exact(row,{"id","owner","construction","signatureHash","parameters","result","bindings"})&&owner!=p.internalOwners.end()&&
        (previous.empty()||previous<id)&&field(row,"parameters").getAsArray()&&field(row,"bindings").getAsArray()&&
        same(field(row,"owner"),field(owner->second,"ownerType"))&&same(field(row,"signatureHash"),field(owner->second,"signatureHash")),"internal constructor ownership/signature/shape/order differs"))return false;
      const auto &source=owner->second;const auto &params=items(field(source,"parameters")),&abi=items(field(row,"parameters"));
      const auto typeId=string(field(source,"ownerType"));const auto &ctor=field(*types.at(typeId),"construction");
      if(!need(same(field(row,"construction"),field(ctor,"id"))&&abi.size()==params.size()+1&&string(abi[0])=="receiver:"+typeId&&
        valid(string(field(row,"result")))&&!internal(string(field(row,"result")))&&items(field(row,"bindings")).size()==params.size(),"internal constructor frame/result/parameter arity differs"))return false;
      std::map<std::string,size_t> parameterIds;for(size_t index=0;index<params.size();++index){if(!step())return false;
        parameterIds.emplace(string(field(params[index],"id")),index);
        if(!need(valid(string(abi[index+1]))&&!internal(string(abi[index+1]))&&string(abi[index+1])!="void","internal ordinary parameter carrier differs"))return false;}
      std::string prior;for(const auto &binding:items(field(row,"bindings"))){if(!step())return false;const auto key=string(field(binding,"id"));auto parameter=parameterIds.find(key);
        if(!need(exact(binding,{"id","carrier"})&&parameter!=parameterIds.end()&&(prior.empty()||prior<key)&&same(field(binding,"carrier"),abi[parameter->second+1]),"internal parameter storage identity/carrier/order differs"))return false;
        prior=key;}
      previous=id;if(!need(p.internalDeclarations.emplace(id,&row).second,"duplicate internal constructor declaration"))return false;
    }
    if(!need(p.internalDeclarations.size()==p.internalFunctions.size(),"internal function/declaration inventory differs"))return false;
    for(const auto &fn:p.internalFunctions)if(!step()||!need(p.internalDeclarations.count(fn.id),"internal function has no owned constructor declaration"))return false;
    for(const auto &[id,environment]:environments){layout(id);if(!e.message.empty())return false;}
    layout("payload:"+schema.str());if(!e.message.empty())return false;
    for(const auto &[id,d]:domains){layout(id);if(!e.message.empty())return false;}
    for(const auto &[id,t]:types)if(string(field(*t,"kind"))!="union"){layout(id);if(!e.message.empty())return false;}
    for(const auto &fn:p.functions)for(const auto &carrier:fn.carriers)if(internal(carrier)){layout(carrier);if(!e.message.empty())return false;}
    for(const auto &fn:p.internalFunctions)for(const auto &carrier:fn.carriers)if(internal(carrier)){layout(carrier);if(!e.message.empty())return false;}
    for(const auto &[id,row]:p.internalDeclarations){for(const auto &parameter:items(field(*row,"parameters"))){layout(string(parameter));if(!e.message.empty())return false;}layout(string(field(*row,"result")));if(!e.message.empty())return false;}
    for(const auto &[id,t]:types)if(string(field(*t,"kind"))=="reference"){
      uint32_t bytes=0,alignment=1,roots=0;
      for(const auto *f:fields(id)){
        const auto raw=string(field(*f,"sourceBinding"));if(!need(bindings.count(raw),"heap field storage missing"))return false;
        const auto &child=layout(string(field(*bindings.at(raw),"carrier")));bytes=(bytes+child.alignment-1)/child.alignment*child.alignment+child.byteSize;
        alignment=std::max(alignment,child.alignment);roots+=child.referenceCount;
        if(!need(bytes<=65536&&roots<=256,"heap object field bytes/GC roots exceeded"))return false;
      }
      if(!e.message.empty()||!need((bytes+alignment-1)/alignment*alignment<=65536,"aligned heap object bytes exceeded"))return false;
    }
    for(const auto &[id,environment]:environments){
      uint32_t bytes=field(*environment,"parent").getAsNull()?0:8,alignment=field(*environment,"parent").getAsNull()?1:8,roots=field(*environment,"parent").getAsNull()?0:1;
      for(const auto &slot:items(field(*environment,"slots"))){
        if(!step())return false;const auto raw=string(field(slot,"binding"));if(!need(bindings.count(raw),"environment cell storage missing"))return false;
        const auto &child=layout(string(field(*bindings.at(raw),"carrier")));bytes=(bytes+child.alignment-1)/child.alignment*child.alignment+child.byteSize;alignment=std::max(alignment,child.alignment);roots+=child.referenceCount;
        if(!need(bytes<=65536&&roots<=256,"environment body bytes/GC roots exceeded"))return false;
      }
      if(!need((bytes+alignment-1)/alignment*alignment<=65536,"aligned environment body bytes exceeded"))return false;
    }
    return true;
  }
};
}
bool verifyTypes(Program &p,Error &e){Types types{p,e};return types.run();}
} // namespace tsfg::commonProgram
