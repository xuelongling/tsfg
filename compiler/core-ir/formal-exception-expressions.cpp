// SPDX-License-Identifier: MIT
#include "formal-exception-source.h"
namespace tsfg::formalException {
bool SourceProof::expression(const Json &raw,const Json &h,SourceScope &scope,size_t &at,bool write,bool trimmed){
  if(!p.step()||!p.require(raw.getAsObject()&&h.getAsObject()&&equal(field(raw,"range"),field(h,"range")),"original expression anchor"))return false;
  const auto kind=string(field(raw,"kind")),rawType=type(raw),hType=string(field(h,"type"));const auto first=at;
  if(!p.require(rawType==hType,"expression semantic type identity"))return false;
  if(kind=="reference"){
    const auto id=string(field(raw,"symbol"));const auto visible=scope.visible.find(id);const auto original=symbols.find(id);
    const auto nearest=original==symbols.end()?scope.names.end():scope.names.find(string(field(*original->second,"name")));
    if(!p.require(visible!=scope.visible.end()&&original!=symbols.end()&&nearest!=scope.names.end()&&nearest->second==id&&scope.initialized.count(id)
      &&string(field(h,"binding"))==visible->second&&string(field(h,"kind"))==(write?"bindingTarget":"bindingRead"),"reference scope, TDZ or original binding"))return false;
    const auto expected=scope.narrowed.count(id)&&!write?type(Object{{"type","bool"}}):type(*original->second);
    if(!p.require(hType==expected&&(!write||field(*original->second,"writable").getAsBoolean()==true)
      &&(write||equal(field(raw,"presenceFlow"),field(h,"presenceFlow"))),"same-binding narrowing, permission or presence"))return false;
    const auto semantic=p.types.find(hType);const bool aggregate=semantic!=p.types.end()&&string(field(*semantic->second,"kind"))=="aggregate";
    if(!source->name(at,string(field(*original->second,"name")),field(raw,"range"),p,trimmed||aggregate))return false;
    if(p.bindingOwner.at(visible->second)!=currentOwner){auto &access=actualCaptures[currentOwner][visible->second];if(write)access.second=true;else access.first=true;}
    if(write){scope.narrowed.erase(id);scope.written.insert(id);}return true;
  }
  if(kind=="group"){
    if(!p.require(string(field(h,"kind"))==(write?"targetGroup":"group"),"group role")||!source->expect(at,"(",p)
      ||!expression(field(raw,"operand"),field(h,"operand"),scope,at,write,true)||!source->expect(at,")",p))return false;
    return source->span(field(raw,"range"),first,at-1,p,false);
  }
  if(write)return p.require(false,"write target is not an owned binding");
  if(kind=="boolean"){
    if(!p.require(string(field(h,"kind"))=="boolean"&&field(raw,"boolean").getAsBoolean().has_value()
      &&field(raw,"boolean").getAsBoolean()==field(h,"value").getAsBoolean(),"boolean literal value"))return false;
    if(!source->expect(at,field(raw,"boolean").getAsBoolean()==true?"true":"false",p))return false;
    return source->span(field(raw,"range"),first,at-1,p,!trimmed);
  }
  if(kind=="write"){
    if(!p.require(string(field(h,"kind"))=="bindingWrite"&&string(field(raw,"operator"))=="="&&string(field(h,"operator"))=="=","write result mapping")
      ||!expression(field(raw,"left"),field(h,"target"),scope,at,true,true)||!source->expect(at,"=",p)
      ||!expression(field(raw,"right"),field(h,"value"),scope,at,false,true))return false;
    return source->span(field(raw,"range"),first,at-1,p,false);
  }
  if(kind=="type-test"){
    const auto op=string(field(raw,"operator"));const auto &test=field(raw,"typeTest");
    if(!p.require(string(field(h,"kind"))=="typeTest"&&(op=="==="||op=="!==")&&string(field(h,"operator"))==op
      &&string(field(test,"tag"))=="boolean"&&string(field(h,"tag"))=="boolean"
      &&equal(field(test,"typeofRange"),field(h,"typeofRange"))&&equal(field(test,"tagRange"),field(h,"tagRange")),"typeof relation"))return false;
    const Json *tested=&field(raw,"operand");while(string(field(*tested,"kind"))=="group")tested=&field(*tested,"operand");
    const auto testedType=string(field(*tested,"type"));
    if(!p.require(string(field(*tested,"kind"))=="reference"&&(testedType=="unknown"||testedType=="bool"),"typeof requires an actual unknown/bool binding"))return false;
    const bool typeofFirst=source->spelling(at)=="typeof";size_t typeofStart=0,typeofLast=0,tagIndex=0;
    auto tag=[&]{const auto value=source->spelling(at);
      if(!p.require(value.size()>=2&&(value.front()=='\''||value.front()=='"')&&value.back()==value.front(),"boolean typeof tag literal"))return false;
      std::string decoded;tagIndex=at;
      for(size_t i=1;i+1<value.size();++i){unsigned point=static_cast<unsigned char>(value[i]);
        if(point=='\\'){
          if(!p.require(++i+1<value.size(),"typeof string escape"))return false;const char escape=value[i];
          if(escape=='x'||escape=='u'){
            const bool braced=escape=='u'&&i+1<value.size()&&value[i+1]=='{';if(braced)++i;
            const size_t digits=braced?6:escape=='x'?2:4;point=0;size_t count=0;
            while(i+1<value.size()&&count<digits){const char c=value[i+1];const int digit=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;
              if(digit<0)break;point=point*16+unsigned(digit);++i;++count;}
            if(!p.require(braced?count>0&&i+1<value.size()&&value[++i]=='}':count==digits,"typeof hexadecimal escape"))return false;
          }else{
            if(!p.require(!(escape>='1'&&escape<='9')&&!(escape=='0'&&i+1<value.size()&&value[i+1]>='0'&&value[i+1]<='9'),"legacy typeof numeric escape"))return false;
            point=escape=='b'?8:escape=='f'?12:escape=='n'?10:escape=='r'?13:escape=='t'?9:escape=='v'?11:escape=='0'?0:static_cast<unsigned char>(escape);
          }
        }
        if(!p.require(point<128&&decoded.size()<7,"boolean tag decoded width"))return false;decoded+=char(point);
      }
      if(!p.require(decoded=="boolean","actual boolean typeof tag")||!source->span(field(test,"tagRange"),tagIndex,tagIndex,p))return false;++at;return true;};
    if(typeofFirst){
      typeofStart=at;if(!source->expect(at,"typeof",p)||!expression(field(raw,"operand"),field(h,"operand"),scope,at))return false;typeofLast=at-1;
      if(!source->expect(at,op,p)||!tag())return false;
    }else{
      if(!tag()||!source->expect(at,op,p))return false;typeofStart=at;
      if(!source->expect(at,"typeof",p)||!expression(field(raw,"operand"),field(h,"operand"),scope,at))return false;typeofLast=at-1;
    }
    return p.require(string(field(h,"order"))==(typeofFirst?"typeof-first":"tag-first"),"typeof operand order")
      &&source->span(field(test,"typeofRange"),typeofStart,typeofLast,p)
      &&source->span(field(raw,"range"),first,at-1,p,false);
  }
  if(kind=="binary"){
    const auto op=string(field(raw,"operator"));
    if(!p.require(string(field(h,"kind"))=="binary"&&(op=="==="||op=="!==")&&string(field(h,"operator"))==op,"strict boolean binary relation")
      ||!expression(field(raw,"left"),field(h,"left"),scope,at,false,true)||!source->expect(at,op,p)
      ||!expression(field(raw,"right"),field(h,"right"),scope,at,false,true))return false;
    const auto boolean=type(Object{{"type","bool"}});
    return p.require(hType==boolean&&string(field(field(h,"left"),"type"))==boolean
      &&string(field(field(h,"right"),"type"))==boolean,"binary boolean operands")&&source->span(field(raw,"range"),first,at-1,p,false);
  }
  if(kind=="functionReference"){
    const auto target=string(field(raw,"target"));const auto mapped=p.rawFunctions.find(target);const auto declared=rawFunctions.find(target);
    if(!p.require(string(field(h,"kind"))=="functionReference"&&mapped!=p.rawFunctions.end()&&declared!=rawFunctions.end()
      &&mapped->second==string(field(h,"target")),"function value actual owned declaration"))return false;
    const auto fn=p.functions.find(mapped->second);
    if(!p.require(fn!=p.functions.end()&&field(*declared->second,"lexicalParent").getAsNull()
      &&string(field(*fn->second,"sourcePath"))==currentSource&&string(field(*fn->second,"type"))==hType
      &&string(field(field(h,"signature"),"owner"))==mapped->second
      &&string(field(field(h,"signature"),"type"))==hType,"function value source and signature"))return false;
    if(!p.require(!scope.names.count(string(field(*declared->second,"name"))),"function value is shadowed by a local binding"))return false;
    return source->name(at,string(field(*declared->second,"name")),field(raw,"range"),p);
  }
  if(kind=="indirectCall"){
    if(!p.require(string(field(h,"kind"))=="indirectCall","indirect call mapping")
      ||!expression(field(raw,"callee"),field(h,"callee"),scope,at)||!source->expect(at,"(",p))return false;
    const auto callable=p.types.find(string(field(field(h,"callee"),"type")));
    if(!p.require(callable!=p.types.end()&&string(field(*callable->second,"kind"))=="callable"
      &&string(field(*callable->second,"returnType"))==hType
      &&string(field(field(h,"signature"),"ownerKind"))=="callableType"
      &&string(field(field(h,"signature"),"owner"))==callable->first
      &&string(field(field(h,"signature"),"type"))==callable->first,"indirect callable signature"))return false;
    const auto &arguments=items(field(raw,"arguments")),&projected=items(field(h,"arguments")),&parameters=items(field(*callable->second,"parameters"));
    if(!p.require(arguments.size()==projected.size()&&arguments.size()==parameters.size(),"complete indirect argument list"))return false;
    for(size_t i=0;i<arguments.size();++i){if(i&&!source->expect(at,",",p))return false;
      if(!expression(arguments[i],projected[i],scope,at)||!p.require(string(parameters[i])==string(field(projected[i],"type")),"indirect argument type"))return false;}
    if(!source->expect(at,")",p))return false;
    return source->span(field(raw,"range"),first,at-1,p);
  }
  if(kind=="construct"){
    const auto constructor=constructors.find(string(field(raw,"target")));
    if(!p.require(string(field(h,"kind"))=="construct"&&constructor!=constructors.end()&&constructor->second==string(field(h,"constructorId"))
      &&items(field(raw,"arguments")).empty()&&items(field(h,"arguments")).empty()
      &&string(field(*p.types.at(hType),"kind"))=="aggregate"&&items(field(*p.types.at(hType),"constructors")).size()==1
      &&string(field(items(field(*p.types.at(hType),"constructors"))[0],"id"))==constructor->second,"actual constructor target/arguments"))return false;
    if(!p.require(!scope.names.count(string(field(*p.types.at(hType),"name"))),"constructor name is shadowed by a local binding"))return false;
    if(!source->expect(at,"new",p)||!source->expect(at,string(field(*p.types.at(hType),"name")),p))return false;
    if(source->spelling(at)=="("&&(!source->expect(at,"(",p)||!source->expect(at,")",p)))return false;
    return source->span(field(raw,"range"),first,at-1,p,false);
  }
  if(kind=="field"){
    if(!p.require(string(field(h,"kind"))=="fieldRead","field read mapping")
      ||!expression(field(raw,"receiver"),field(h,"receiver"),scope,at,false,true))return false;
    const auto &rawPath=items(field(raw,"fieldPath")),&hPath=items(field(h,"fieldPath"));
    if(!p.require(!rawPath.empty()&&rawPath.size()==hPath.size(),"field path completeness"))return false;
    std::string owner=string(field(field(h,"receiver"),"type"));
    for(size_t i=0;i<rawPath.size();++i){const auto mapped=fields.find(string(rawPath[i]));
      if(!p.require(mapped!=fields.end()&&mapped->second==string(hPath[i])&&p.types.count(owner),"field path actual owner"))return false;
      const Json *member=nullptr;for(const auto &f:items(field(*p.types.at(owner),"fields")))if(string(field(f,"id"))==mapped->second)member=&f;
      if(!p.require(member&&string(field(*member,"access"))=="public","field access permission")
        ||!source->expect(at,".",p)||!source->expect(at,string(field(*member,"name")),p))return false;
      owner=string(field(*member,"type"));
    }
    return p.require(owner==hType&&field(field(h,"permission"),"readable").getAsBoolean()==true
      &&field(field(h,"permission"),"constructorSelf").getAsBoolean()==false,"field result permission/type")
      &&source->span(field(raw,"range"),first,at-1,p,false);
  }
  if(kind=="call"){
    const auto rawTarget=string(field(raw,"target"));const auto found=p.rawFunctions.find(rawTarget);
    if(!p.require(string(field(h,"kind"))=="directCall"&&found!=p.rawFunctions.end()
      &&found->second==string(field(h,"target")),"actual direct call target"))return false;
    const auto &callee=*rawFunctions.at(rawTarget),&fn=*p.functions.at(found->second);
    const auto calleeSource=string(field(fn,"sourcePath"));const auto name=string(field(raw,"name")).empty()?string(field(callee,"name")):string(field(raw,"name"));
    const auto nearest=scope.names.find(name);
    bool visible=nearest==scope.names.end()&&calleeSource==currentSource&&field(callee,"lexicalParent").getAsNull()
      &&name==string(field(callee,"name"));
    if(!field(callee,"lexicalParent").getAsNull())visible=nearest!=scope.names.end()&&nearest->second==rawTarget&&scope.initialized.count(rawTarget);
    if(nearest==scope.names.end())for(const auto &m:items(field(facts,"modules")))if(string(field(m,"sourcePath"))==currentSource)
      for(const auto &edge:items(field(m,"imports")))if(string(field(edge,"sourcePath"))==calleeSource)
        for(const auto &b:items(field(edge,"bindings")))if(string(field(b,"name"))==name&&string(field(b,"target"))==rawTarget)visible=true;
    if(!p.require(visible&&type(callee,"returnType")==hType&&string(field(field(h,"signature"),"owner"))==found->second
      &&string(field(field(h,"signature"),"type"))==string(field(fn,"type")),"direct call scope/signature")
      ||!source->expect(at,name,p)||!source->expect(at,"(",p))return false;
    const auto &arguments=items(field(raw,"arguments")),&projected=items(field(h,"arguments")),&parameters=items(field(callee,"parameters"));
    if(!p.require(arguments.size()==projected.size()&&arguments.size()==parameters.size(),"complete call argument list"))return false;
    for(size_t i=0;i<arguments.size();++i){if(i&&!source->expect(at,",",p))return false;
      if(!expression(arguments[i],projected[i],scope,at)||!p.require(type(parameters[i])==string(field(projected[i],"type")),"call argument type"))return false;}
    if(!source->expect(at,")",p))return false;return source->span(field(raw,"range"),first,at-1,p);
  }
  return p.require(false,"unrepresented actual Source expression");
}
}
