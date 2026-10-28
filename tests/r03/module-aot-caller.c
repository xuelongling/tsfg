// SPDX-License-Identifier: MIT
// Fixed complete linked-module cases. No loader, interpreter or request code.
#include "../../runtime/aot-instance.h"
typedef struct { uint32_t low, high; } Slot;
typedef struct { uint32_t source, length, initializer; } Function;
typedef struct {
  const char *id;
  uint32_t root, count; uint8_t types[4], result_type;
  Slot arguments[4], output;
  uint32_t success, status, zero_events, init_seen;
  TsfgAotFailureV4 failure, memo;
  uint32_t failure_anchor, memo_anchor;
  uint64_t globals[2]; uint8_t initialized[2];
} Case;
#include "module-cases.h"
__declspec(dllimport) void __stdcall ExitProcess(uint32_t);
__declspec(dllimport) void *__stdcall GetStdHandle(uint32_t);
__declspec(dllimport) int __stdcall WriteFile(void *,const void *,uint32_t,uint32_t *,void *);
extern const uint32_t tsfg_native_abi_version;
typedef struct {
  TsfgAotRequestV4 *request;
  uint32_t events, depth, bad, failed, init_seen;
  TsfgAotFailureV4 first;
} State;
static int failure_equal(const TsfgAotFailureV4 *a,const TsfgAotFailureV4 *b,int anchor) {
  return a->kind==b->kind && a->reason==b->reason && !a->reserved[0] && !a->reserved[1]
    && (!anchor || (a->function_index==b->function_index && a->source_index==b->source_index
      && a->start==b->start && a->end==b->end));
}
static int32_t event(void *opaque,uint32_t kind,uint32_t fn,uint32_t start,uint32_t end,uint64_t interval) {
  State *s=opaque;const TsfgAotFailureV4 *failure=&s->request->failure;
  if(++s->events>10000 || fn>=FUNCTION_COUNT || start>end || end>functions[fn].length || !interval) s->bad=1;
  if(s->failed) {
    if(kind!=3 || !failure_equal(failure,&s->first,1)) s->bad=1;
  } else if(failure->kind) {
    s->failed=1;s->first=*failure;
    if(kind!=3 && !(failure->kind==TSFG_AOT_TRAP &&
      ((kind==9 && failure->reason==TSFG_AOT_CONVERSION_NONFINITE)
        || (kind==10 && failure->reason==TSFG_AOT_CONVERSION_RANGE))
      && fn==failure->function_index && start==failure->start && end==failure->end)) s->bad=1;
  }
  if(kind==0) {
    if(++s->depth>64) s->bad=1;
    if(fn<FUNCTION_COUNT && functions[fn].initializer) {
      if(s->init_seen>=INITIALIZER_COUNT || initializer_order[s->init_seen]!=fn) s->bad=1;
      ++s->init_seen;
    }
  } else if(kind==3) { if(!s->depth) s->bad=1;else --s->depth; }
  else if(kind!=1 && kind!=2 && kind!=4 && kind!=8 && kind!=9 && kind!=10) s->bad=1;
  return !s->bad;
}
static void report(uint32_t n,int good) {
  char text[48],digits[12];uint32_t length=0,written=0,count=0;const char *prefix=good?"PASS cases ":"FAIL case ";
  while(*prefix)text[length++]=*prefix++;
  do{digits[count++]=(char)('0'+n%10);n/=10;}while(n);
  while(count)text[length++]=digits[--count];text[length++]='\n';
  WriteFile(GetStdHandle((uint32_t)-11),text,length,&written,0);
}
void mainCRTStartup(void) {
  uint64_t globals[GLOBAL_COUNT?GLOBAL_COUNT:1];uint8_t initialized[GLOBAL_COUNT?GLOBAL_COUNT:1];
  TsfgAotInstanceV4 instance={0};
  if(tsfg_native_abi_version!=4 || tsfg_aot_global_count_v4!=GLOBAL_COUNT || tsfg_aot_required_host_count_v4!=0) {
    report(0,0);ExitProcess(1);
  }
  for(unsigned i=0;i<32;++i) if(tsfg_aot_compiled_table_id_v4[i]!=compiled_id[i]) {report(0,0);ExitProcess(1);}
  instance.version=4;instance.bytes=sizeof(instance);instance.global_count=GLOBAL_COUNT;
  for(unsigned i=0;i<32;++i)instance.compiled_table_id[i]=compiled_id[i];
  instance.globals=GLOBAL_COUNT?globals:0;instance.initialized=GLOBAL_COUNT?initialized:0;
  if(tsfg_aot_instance_init_v4(&instance)!=1 || instance.status!=TSFG_AOT_COLD) {report(0,0);ExitProcess(1);}
  uint32_t total_initializers=0;
  for(uint32_t i=0;i<sizeof(cases)/sizeof(cases[0]);++i) {
    const Case *row=&cases[i];Slot output={0x12345678,0x87654321};State state={0};
    TsfgAotRequestV4 request={4,sizeof(request),&state,event,{0}};state.request=&request;
    uint32_t ok=tsfg_aot_invoke_v4(&instance,&request,row->root,row->count,row->types,row->result_type,row->arguments,&output);
    total_initializers+=state.init_seen;
    int bad=state.bad || state.depth || ok!=row->success || instance.status!=row->status || instance.active
      || output.low!=row->output.low || output.high!=row->output.high
      || !failure_equal(&request.failure,&row->failure,row->failure_anchor)
      || !failure_equal(&instance.memo,&row->memo,row->memo_anchor)
      || (row->zero_events && state.events) || state.init_seen!=row->init_seen || total_initializers>INITIALIZER_COUNT;
    if(state.failed)bad|=!failure_equal(&request.failure,&state.first,1);
    for(uint32_t g=0;g<GLOBAL_COUNT;++g)bad|=globals[g]!=row->globals[g] || initialized[g]!=row->initialized[g];
    if(bad){report(i,0);ExitProcess(1);}
  }
  report((uint32_t)(sizeof(cases)/sizeof(cases[0])),1);ExitProcess(0);
}
