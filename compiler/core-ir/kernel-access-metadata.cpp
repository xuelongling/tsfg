// SPDX-License-Identifier: MIT
#include "kernel-access.h"
#include "bytecode_encoding.h"
#include "dialect.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <optional>
namespace tsfg::kernelGlobal {
mlir::LogicalResult reject(llvm::StringRef code,llvm::StringRef detail){
  llvm::errs()<<'['<<code<<"] "<<detail<<'\n';return mlir::failure();
}
bool usesCandidate(mlir::ModuleOp module){return module->hasAttr(marker);}
std::string hash(llvm::StringRef bytes){return "sha256:"+bytecode::hex(bytecode::hash(bytes));}
namespace {
std::string quote(llvm::StringRef value){
  constexpr char digits[]="0123456789abcdef";std::string out="\"";
  for(unsigned char c:value.bytes())switch(c){
  case '"':out+="\\\"";break;case '\\':out+="\\\\";break;
  case '\b':out+="\\b";break;case '\f':out+="\\f";break;case '\n':out+="\\n";break;
  case '\r':out+="\\r";break;case '\t':out+="\\t";break;
  default:if(c<32){out+="\\u00";out+=digits[c>>4];out+=digits[c&15];}else out+=static_cast<char>(c);
  }return out+'"';
}
bool digest(llvm::StringRef value){bytecode::Hash ignored;return bytecode::decodeHash(value,ignored);}
bool bounded(const llvm::json::Value &value,size_t depth,size_t &tokens,size_t &members){
  if(depth>128||++tokens>200000)return false;
  if(auto string=value.getAsString())return string->size()<=1048576;
  if(auto object=value.getAsObject()){
    for(const auto &field:*object){if(++members>65536||++tokens>200000||field.first.str().size()>1048576||!bounded(field.second,depth+1,tokens,members))return false;}
    return true;
  }
  if(auto array=value.getAsArray()){for(const auto &item:*array)if(!bounded(item,depth+1,tokens,members))return false;return true;}
  if(auto n=value.getAsInteger())return *n>=0&&*n<=INT64_C(9007199254740991);
  return value.kind()==llvm::json::Value::Null||value.getAsBoolean().has_value();
}
// The existing exception JSON reader is fixed to1MiB/100k work. This8MiB
// proof grammar keeps its own finite policy; all admitted dictionary keys are ASCII.
bool depthBeforeParse(llvm::StringRef input){
  unsigned depth=0;size_t tokens=0;bool string=false;
  for(size_t i=0;i<input.size();++i){char c=input[i];if(string){if(c=='\\')++i;else if(c=='"')string=false;continue;}
    if(c=='"'){if(++tokens>200000)return false;string=true;}
    else if(c=='{'||c=='['){if(++depth>128||++tokens>200000)return false;}
    else if(c=='}'||c==']'){if(!depth)return false;--depth;}
    else if((c>='0'&&c<='9')||c=='-'||c=='t'||c=='f'||c=='n'){
      if(++tokens>200000)return false;while(i+1<input.size()&&input[i+1]!=','&&input[i+1]!='}'&&input[i+1]!=']'&&input[i+1]!=' '&&input[i+1]!='\n'&&input[i+1]!='\r'&&input[i+1]!='\t')++i;
    }}
  return !depth&&!string;
}
std::string attr(mlir::Operation *op,llvm::StringRef key){auto s=op->getAttrOfType<mlir::StringAttr>(key);return s?s.getValue().str():std::string();}
std::string typeId(mlir::Type type){return hash((std::string("tsfg.type")+'\0')+tsfg::scalarName(tsfg::typeCode(type)).str());}
bool sameStrings(const llvm::json::Value *value,const std::vector<std::string> &expected){
  auto array=value?value->getAsArray():nullptr;if(!array||array->size()!=expected.size())return false;
  for(size_t i=0;i<expected.size();++i)if((*array)[i].getAsString()!=expected[i])return false;return true;
}
} // namespace
std::string canonical(const llvm::json::Value &value){
  if(auto object=value.getAsObject()){
    std::vector<std::string> keys;for(const auto &field:*object)keys.push_back(field.first.str());std::sort(keys.begin(),keys.end());
    std::string out="{";for(const auto &key:keys){if(out.size()>1)out+=',';out+=quote(key)+':'+canonical(*object->get(key));}return out+'}';
  }
  if(auto array=value.getAsArray()){std::string out="[";for(const auto &item:*array){if(out.size()>1)out+=',';out+=canonical(item);}return out+']';}
  if(auto string=value.getAsString())return quote(*string);
  if(auto b=value.getAsBoolean())return *b?"true":"false";
  if(auto n=value.getAsInteger())return std::to_string(*n);
  return "null";
}
bool fields(const llvm::json::Object *value,llvm::ArrayRef<llvm::StringRef> names){
  return value&&value->size()==names.size()&&llvm::all_of(names,[&](auto n){return value->get(n)!=nullptr;});
}
std::string text(const llvm::json::Object *value,llvm::StringRef key){auto s=value?value->getString(key):std::nullopt;return s?s->str():std::string();}
bool hashes(const llvm::json::Value *value,std::set<std::string> &result){
  auto array=value?value->getAsArray():nullptr;if(!array||array->size()>4096)return false;
  std::string previous;for(const auto &item:*array){auto s=item.getAsString();if(!s||!digest(*s)||(!previous.empty()&&previous>=*s))return false;previous=s->str();result.insert(previous);}return true;
}
mlir::LogicalResult readInput(mlir::ModuleOp module,Input &input){
  auto fail=[&](llvm::StringRef detail){return reject("core-ir-kernel-metadata",detail);};
  for(auto candidate:{"tsfg_core.array","tsfg_core.reference","tsfg_core.nullable","tsfg_core.string","tsfg_core.closure","tsfg_core.exception"})
    if(module->hasAttr(candidate))return fail("mixed candidate domain");
  auto m=module->getAttrOfType<mlir::DictionaryAttr>(marker);
  if(!m||m.size()!=4)return fail("private marker fields differ");
  for(auto key:{"family","schema","payload"})if(!llvm::isa_and_nonnull<mlir::StringAttr>(m.get(key)))return fail("marker string differs");
  auto version=llvm::dyn_cast_or_null<mlir::IntegerAttr>(m.get("version"));
  auto string=[&](llvm::StringRef key){return llvm::cast<mlir::StringAttr>(m.get(key)).getValue();};
  if(!version||!version.getType().isSignlessInteger(32)||version.getInt()!=1||string("family")!="tsfg.core-kernel-global-candidate"||string("schema")!=schema)return fail("private marker identity differs");
  auto bytes=string("payload");if(bytes.size()>8388608||!depthBeforeParse(bytes))return fail("payload byte/depth bound differs");
  auto parsed=llvm::json::parse(bytes);if(!parsed){llvm::consumeError(parsed.takeError());return fail("payload JSON differs");}
  input.payload=std::move(*parsed);size_t tokens=0,members=0;
  if(!bounded(input.payload,0,tokens,members)||canonical(input.payload)!=bytes)return fail("payload is not canonical bounded JSON");
  auto p=input.payload.getAsObject();if(!fields(p,{"scope","context","proof"}))return fail("payload fields differ");
  auto scope=p->getObject("scope"),context=p->getObject("context"),proof=p->getObject("proof");
  if(!fields(scope,{"roots","modules","functions","globals"})||!fields(context,{"mode","scopeDigest","expectedDigest","contracts"})||text(context,"mode")!="fixed"||!proof)return fail("scope/publication fields differ");
  std::vector<mlir::func::FuncOp> functions;
  for(auto &op:*module.getBody()){auto fn=llvm::dyn_cast<mlir::func::FuncOp>(&op);if(!fn)return fail("complete functions only");functions.push_back(fn);}
  if(functions.empty()||functions.size()>256||mlir::failed(readModuleTables(module,input.tables,functions))||!input.tables.present)return fail("module tables differ");
  auto sf=scope->getArray("functions"),sg=scope->getArray("globals"),sm=scope->getArray("modules");
  if(!sf||!sg||!sm||sg->size()!=input.tables.globals.size()||sm->size()!=input.tables.modules.size())return fail("complete scope counts differ");
  size_t sourceFunction=0;
  for(auto fn:functions){
    auto initializer=fn->getAttrOfType<mlir::BoolAttr>("tsfg_core.initializer");auto source=fn->getAttrOfType<mlir::IntegerAttr>("tsfg_core.source_index");
    if(!initializer||!source||!source.getType().isSignlessInteger(64)||source.getInt()<0||size_t(source.getInt())>=input.tables.sources.size()||fn.getFunctionType().getNumResults()!=1||fn.getFunctionType().getNumInputs()>32)return fail("function header differs");
    Function f{fn,attr(fn,"tsfg_core.function_id"),attr(fn,"tsfg_core.signature_hash"),attr(fn,"tsfg_core.logical_name"),input.tables.sources[source.getInt()].path,"","",initializer.getValue()};
    std::vector<std::string> names,ids;for(auto type:fn.getFunctionType().getInputs()){
      auto code=tsfg::typeCode(type);if(code!=1&&code!=2)return fail("scalar parameter profile differs");names.push_back(tsfg::scalarName(code).str());ids.push_back(typeId(type));}
    auto result=tsfg::typeCode(fn.getFunctionType().getResult(0));if(result!=1&&result!=2)return fail("scalar result profile differs");
    llvm::json::Array parameters;for(const auto &n:names)parameters.push_back(n);
    llvm::json::Value signature=llvm::json::Object{{"parameters",std::move(parameters)},{"returns",tsfg::scalarName(result)}};
    if(f.signature!=hash((std::string("tsfg.module-callable-signature.candidate.v1")+'\0')+canonical(signature)))return fail("private signature identity differs");
    std::string formal="(";for(const auto &n:names){if(formal.size()>1)formal+=',';formal+=n;}formal+=")->"+tsfg::scalarName(result).str();
    f.formalSignature=hash((std::string("tsfg.signature")+'\0')+formal);
    if(f.initializer){
      auto &s=input.tables.sources[source.getInt()];
      f.formalId=hash((std::string("tsfg.module-initializer.v1")+'\0')+s.path+'\0'+"sha256:"+bytecode::hex(s.hash)+'\0'+hash((std::string("tsfg.module")+'\0')+s.path)+'\0'+f.formalSignature);
      if(f.id!=f.formalId)return fail("initializer identity differs");
    }else{
      llvm::json::Value identity=llvm::json::Object{{"path",f.path},{"name",f.name},{"signatureHash",f.signature}};
      if(f.id!=hash((std::string("tsfg.module-callable-function.candidate.v1")+'\0')+canonical(identity)))return fail("private function identity differs");
      f.formalId=hash((std::string("tsfg.function")+'\0')+f.path+'\0'+f.name+'\0'+f.formalSignature.substr(7));
      if(sourceFunction>=sf->size())return fail("source function scope omitted");
      auto row=(*sf)[sourceFunction++].getAsObject();
      if(!fields(row,{"functionId","sourcePath","name","signatureHash","parameters","returnType"})||text(row,"functionId")!=f.id||text(row,"sourcePath")!=f.path||text(row,"name")!=f.name||text(row,"signatureHash")!=f.signature||text(row,"returnType")!=typeId(fn.getFunctionType().getResult(0))||!sameStrings(row->get("parameters"),ids))return fail("source function scope differs");
    }
    if(fn.getSymName()!="f"+f.id.substr(7))return fail("private symbol identity differs");
    input.functions.push_back(std::move(f));
  }
  if(sourceFunction!=sf->size())return fail("source function scope count differs");
  for(size_t i=0;i<sg->size();++i){auto row=(*sg)[i].getAsObject();const auto &g=input.tables.globals[i];
    if(!fields(row,{"globalId","sourcePath","name","type","writable"})||text(row,"globalId")!="sha256:"+bytecode::hex(g.id)||text(row,"sourcePath")!=input.tables.sources[g.source].path||text(row,"name")!=g.name||text(row,"type")!=hash((std::string("tsfg.type")+'\0')+tsfg::scalarName(g.type).str())||row->getBoolean("writable")!=g.writable)return fail("global scope differs");}
  std::set<std::string> visible;for(const auto &f:input.functions)if(!f.initializer)visible.insert(f.id);for(const auto &g:input.tables.globals)visible.insert("sha256:"+bytecode::hex(g.id));
  for(size_t i=0;i<sm->size();++i){auto row=(*sm)[i].getAsObject();const auto &m=input.tables.modules[i];std::vector<std::string> deps;for(auto d:m.dependencies)deps.push_back(input.tables.sources[input.tables.modules[d].source].path);
    if(!fields(row,{"moduleId","sourcePath","dependencies","exports","bindings"})||text(row,"moduleId")!="sha256:"+bytecode::hex(m.id)||text(row,"sourcePath")!=input.tables.sources[m.source].path||!sameStrings(row->get("dependencies"),deps))return fail("module scope differs");
    for(auto key:{"exports","bindings"}){auto list=row->getArray(key);if(!list)return fail("binding table absent");std::string previous;
      for(const auto &value:*list){auto b=value.getAsObject();auto name=text(b,"name");if(!fields(b,{"name","target"})||name.empty()||name.size()>4096||name.find('\0')!=std::string::npos||(!previous.empty()&&name<=previous)||!visible.count(text(b,"target")))return fail("binding table differs");previous=name;}}
  }
  auto roots=scope->getObject("roots");if(!fields(roots,{"roots","requiredRoots"}))return fail("root scope differs");
  auto list=roots->getArray("roots"),required=roots->getArray("requiredRoots");if(!list||!required||required->size()>list->size()||list->size()!=input.tables.roots.size())return fail("explicit complete roots required");
  constexpr llvm::StringLiteral kinds[]={"application","module-initialization","host-export","host-callback","hot-function","kernel"};
  // Match normalizeClosure: rootKey = kind + NUL + path + NUL + name,
  // ordered by Buffer.from(key).compare, i.e. unsigned UTF-8 bytes, not UTF-16.
  for(auto rootsList:{list,required}){
    std::string previous;bool first=true;
    for(const auto &value:*rootsList){auto row=value.getAsObject();auto kind=text(row,"kind"),source=text(row,"sourcePath"),name=text(row,"name");
      if(!fields(row,{"kind","sourcePath","name"})||llvm::none_of(kinds,[&](auto k){return kind==k;})||!validSourcePath(source,false)||name.empty()||name.find('\0')!=std::string::npos||(kind=="module-initialization"&&name!="$moduleInit"))return fail("root fields differ");
      const auto key=kind+'\0'+source+'\0'+name;
      if(!first&&!std::lexicographical_compare(previous.begin(),previous.end(),key.begin(),key.end(),[](char a,char b){return static_cast<unsigned char>(a)<static_cast<unsigned char>(b);}))return fail("root order/uniqueness differs");
      previous=key;first=false;
    }
  }
  for(const auto &wanted:*required)if(llvm::none_of(*list,[&](const auto &actual){return canonical(wanted)==canonical(actual);}))return fail("required root absent");
  for(size_t i=0;i<list->size();++i){auto row=(*list)[i].getAsObject();const auto &r=input.tables.roots[i];if(!fields(row,{"kind","sourcePath","name"})||text(row,"kind")!=kinds[r.kind]||text(row,"sourcePath")!=input.tables.sources[r.source].path||text(row,"name")!=r.name)return fail("root scope binding differs");}
  // Join original named roots to original export/private-function identities,
  // not merely to an in-range numeric function index.
  for(const auto &r:input.tables.roots)if(r.kind!=1){
    const auto &source=input.tables.sources[r.source].path;std::string target;
    for(const auto &moduleScope:*sm){auto owner=moduleScope.getAsObject();if(text(owner,"sourcePath")!=source)continue;
      for(const auto &exported:*owner->getArray("exports")){auto e=exported.getAsObject();if(text(e,"name")==r.name)target=text(e,"target");}}
    if(target.empty())for(const auto &f:input.functions)if(!f.initializer&&f.path==source&&f.name==r.name)target=f.id;
    if(target.empty()||input.functions[r.function].id!=target)return fail("original named root target differs");
  }
  const auto scopeDigest=hash((std::string("tsfg.module-call-scope.v1")+'\0')+canonical(*p->get("scope")));
  if(text(context,"scopeDigest")!=scopeDigest)return fail("scope digest differs");
  auto records=context->getArray("contracts");if(!records||records->size()!=sourceFunction)return fail("complete fixed records required");
  std::string previous;
  for(const auto &value:*records){auto row=value.getAsObject(),upper=row?row->getObject("upper"):nullptr;auto id=text(row,"functionId"),signature=text(row,"signatureHash");
    auto fn=llvm::find_if(input.functions,[&](const auto &f){return !f.initializer&&f.id==id&&f.signature==signature;});
    auto params=row?row->getArray("parameters"):nullptr;auto returns=row?row->get("returns"):nullptr;
    if(!fields(row,{"functionId","signatureHash","parameters","returns","upper","digest"})||fn==input.functions.end()||(!previous.empty()&&id<=previous)||!params||!params->empty()||!returns||returns->kind()!=llvm::json::Value::Null||!fields(upper,{"reads","writes","unknown"})||!upper->getBoolean("unknown"))return fail("fixed record fields differ");
    Published record;record.digest=text(row,"digest");record.unknown=*upper->getBoolean("unknown");
    if(!hashes(upper->get("reads"),record.reads)||!hashes(upper->get("writes"),record.writes)||record.unknown&&(!record.reads.empty()||!record.writes.empty()))return fail("fixed access sets differ");
    for(const auto &g:record.reads)if(!visible.count(g)||llvm::none_of(input.tables.globals,[&](const auto &x){return g=="sha256:"+bytecode::hex(x.id);}))return fail("fixed read GlobalId absent");
    for(const auto &g:record.writes)if(llvm::none_of(input.tables.globals,[&](const auto &x){return x.writable&&g=="sha256:"+bytecode::hex(x.id);}))return fail("fixed write GlobalId absent/writable differs");
    llvm::json::Object body;for(const auto &field:*row)if(field.first!="digest")body[field.first]=field.second;
    if(record.digest!=hash((std::string("tsfg.module-published-call-contract.v1")+'\0')+canonical(llvm::json::Value(std::move(body)))))return fail("fixed record digest differs");
    previous=id;input.contracts.emplace(id,std::move(record));
  }
  llvm::json::Value table=llvm::json::Object{{"scopeDigest",scopeDigest},{"contracts",llvm::json::Value(*context->get("contracts"))}};
  if(text(context,"expectedDigest")!=hash((std::string("tsfg.module-call-publication.v1")+'\0')+canonical(table)))return fail("fixed publication digest differs");
  if(!fields(proof,{"inputIdentity","hirDigest","publishedDigest","targets","accesses","pairs"})||text(proof,"inputIdentity")!=attr(module,"tsfg_core.input_identity")||!digest(text(proof,"hirDigest"))||text(proof,"publishedDigest")!=text(context,"expectedDigest"))return fail("proof provenance differs");
  std::set<std::string> targets;if(!hashes(proof->get("targets"),targets)||targets.size()<2||targets.size()>32)return fail("target request differs");
  for(const auto &id:targets){size_t index=0;for(;index<input.functions.size();++index)if(input.functions[index].id==id)break;
    if(index==input.functions.size()||llvm::none_of(input.tables.roots,[&](const auto &r){return r.kind==5&&r.function==index;}))return fail("target is not a real kernel root");input.targets.push_back(index);}
  return mlir::success();
}
} // namespace tsfg::kernelGlobal
