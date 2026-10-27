// SPDX-License-Identifier: MIT
// Permanent CPU value-plane layouts: semantic declarations, never flow carriers.
#include "component-layout.h"
#include "common-program-source.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/DerivedTypes.h"
#include "llvm/IR/LLVMContext.h"
#include <algorithm>
namespace tsfg::commonProgram {
namespace {
constexpr llvm::StringLiteral componentSchema="sha256:26a6e0fe97b3f269eba8aec94061c980c5985eb5f3595c9feb4bc7c13036db8f";
struct DeclaredField {const Json *value;std::string path;};
struct Components {
  Program &p;Error &e;llvm::LLVMContext context;llvm::DataLayout dataLayout;
  std::map<std::string,const Json *> types;
  std::map<std::string,llvm::Type *> native;
  std::map<std::string,Json> records;
  std::map<std::string,size_t> heights;
  std::set<std::string> active;
  size_t retained=0;
  Components(Program &p,Error &e):p(p),e(e),dataLayout(string(field(field(p.hir,"target"),"llvmDataLayout"))){}
  bool need(bool value,llvm::StringRef detail){return value||reject(e,"core-ir-component-capability",detail);}
  bool step(size_t n=1){return p.charge(n)||reject(e,"core-ir-component-budget","component layout work exceeded");}
  bool component(const Json &t)const{return string(field(field(t,"nominalKey"),"category"))=="component";}
  bool fields(const std::string &id,std::vector<DeclaredField> &out){
    std::set<std::string> seen;std::vector<const Json *> chain;auto current=id;
    while(!current.empty()){
      if(!step()||!need(types.count(current)&&seen.insert(current).second&&chain.size()<32,"unowned/cyclic component inheritance"))return false;
      const auto *t=types.at(current);chain.push_back(t);current=string(field(*t,"base"));
    }
    for(auto at=chain.rbegin();at!=chain.rend();++at)for(const auto &f:items(field(**at,"fields"))){
      if(!step()||!need(out.size()<256,"component field budget exceeded"))return false;
      out.push_back({&f,string(field(field(**at,"origin"),"sourcePath"))});
    }return true;
  }
  llvm::Type *scalar(llvm::StringRef name){
    if(name=="bool"||name=="i8"||name=="u8")return llvm::Type::getInt8Ty(context);
    if(name=="i16"||name=="u16")return llvm::Type::getInt16Ty(context);
    if(name=="i32"||name=="u32")return llvm::Type::getInt32Ty(context);
    if(name=="i64"||name=="u64")return llvm::Type::getInt64Ty(context);
    if(name=="isize"||name=="usize")return dataLayout.getIntPtrType(context);
    if(name=="f32")return llvm::Type::getFloatTy(context);
    if(name=="f64")return llvm::Type::getDoubleTy(context);
    return nullptr;
  }
  llvm::Type *build(const std::string &id,size_t depth=0){
    if(!step()||!need(depth<32&&types.count(id),"fixed component type path exceeds 32 nodes"))return nullptr;
    if(native.count(id)){
      if(!need(depth+heights.at(id)<=32,"cached fixed component type path exceeds 32 nodes"))return nullptr;
      return native.at(id);
    }
    if(!need(active.insert(id).second,"cyclic fixed component type"))return nullptr;
    size_t height=1;
    const auto &decl=*types.at(id);const auto kind=string(field(decl,"kind")),name=string(field(decl,"name"));
    const bool isComponent=component(decl);llvm::Type *type=nullptr;std::vector<DeclaredField> members;Array layoutFields;
    std::string outputKind=kind;
    if(kind=="scalar"){
      type=scalar(name);if(!need(type!=nullptr,"unsupported fixed scalar"))return nullptr;
    }else{
      if(!need(kind=="value"||isComponent,"component field has GC/non-fixed content; no storage ABI selected"))return nullptr;
      outputKind=isComponent?"component":"value";
      if(!fields(id,members))return nullptr;
      std::vector<llvm::Type *> children;
      for(const auto &member:members){auto *child=build(string(field(*member.value,"type")),depth+1);if(!child){
        if(e.path.empty()){e.path=string(field(field(*member.value,"origin"),"source"));e.range={static_cast<uint32_t>(field(field(*member.value,"origin"),"start").getAsInteger().value_or(0)),static_cast<uint32_t>(field(field(*member.value,"origin"),"end").getAsInteger().value_or(0))};}return nullptr;}children.push_back(child);height=std::max(height,1+heights.at(string(field(*member.value,"type"))));}
      auto *structure=llvm::StructType::get(context,children,false);type=structure;
      const auto *layout=dataLayout.getStructLayout(structure);
      for(size_t i=0;i<members.size();++i){
        const auto &member=members[i];const auto &f=*member.value;
        layoutFields.push_back(Object{{"id",field(f,"id")},{"name",field(f,"name")},{"type",field(f,"type")},
          {"offset",static_cast<int64_t>(layout->getElementOffset(i))},{"readonly",field(f,"readonly")},
          {"sourcePath",field(field(f,"origin"),"source")},{"range",Object{{"start",field(field(f,"origin"),"start")},{"end",field(field(f,"origin"),"end")}}}});
      }
    }
    const auto size=dataLayout.getTypeAllocSize(type);const auto alignment=dataLayout.getABITypeAlign(type).value();
    if(!need(!size.isScalable()&&size.getFixedValue()<=65536&&alignment<=65536,"fixed component storage bound exceeded"))return nullptr;
    const auto &origin=field(decl,"origin");
    Json row=Object{{"id",id},{"kind",outputKind},{"name",name},{"sourcePath",kind=="scalar"?Json(""):field(origin,"sourcePath")},
      {"range",kind=="scalar"?Json(Object{{"start",0},{"end",0}}):field(origin,"range")},
      {"byteSize",static_cast<int64_t>(size.getFixedValue())},{"alignment",static_cast<int64_t>(alignment)},
      {"stride",static_cast<int64_t>(size.getFixedValue())},{"scalar",kind=="scalar"?name:std::string()},
      {"fields",std::move(layoutFields)}};
    const auto encoded=canonical(row);
    if(!need(!encoded.empty()&&encoded.size()<=2097152-retained,"component layout byte budget exceeded"))return nullptr;
    retained+=encoded.size();records.emplace(id,std::move(row));active.erase(id);native.emplace(id,type);heights.emplace(id,height);return type;
  }
  bool run(Json &out){
    Array roots;
    for(const auto &t:items(field(p.hir,"types"))){if(!step())return false;types.emplace(string(field(t,"id")),&t);}
    for(const auto &[id,t]:types)if(component(*t)){if(!build(id))return false;roots.push_back(id);}
    Array rows;for(const auto &[id,row]:records){if(!step())return false;rows.push_back(row);}
    Json payload=Object{{"components",std::move(roots)},{"types",std::move(rows)},
      {"inputIdentity",p.inputIdentity},{"hirDigest",p.hirHash},{"target",field(p.hir,"target")}};
    const auto text=canonical(payload);
    if(!need(!text.empty()&&text.size()<=2097152,"component layout packet exceeded"))return false;
    const std::string domain("tsfg.component-layout.v1\0",25);
    out=Object{{"family","tsfg.component-layout-candidate"},{"version",1},{"schemaHash",componentSchema},
      {"payload",text},{"payloadHash",digest(domain+text)}};
    return need(canonical(out).size()<2097152,"component layout envelope byte budget exceeded");
  }
};
}
bool componentLayouts(Program &p,Json &out,Error &e){Components builder(p,e);return builder.run(out);}
} // namespace tsfg::commonProgram
