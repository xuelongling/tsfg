// SPDX-License-Identifier: MIT
// Fixed cases for one complete shared-SSA ordinary-expression Core module.
// Program and expectations are compile-time data; no loader or interpreter.
#include <stdint.h>
#include <stddef.h>
typedef struct { uint32_t low,high; } Slot;
typedef uint32_t (*Event)(void *,uint32_t,uint32_t,uint32_t,uint32_t,uint64_t);
extern const uint32_t tsfg_native_abi_version;
extern uint32_t tsfg_native_invoke_v3(void *,Event,uint32_t,uint32_t,
    const uint8_t *,uint8_t,const Slot *,Slot *);
typedef struct {uint32_t start,end;} Span;
typedef struct {
    uint32_t function,count;uint8_t types[8],result,reason;
    Slot arguments[8];uint64_t expected;uint32_t trap_function,trap_start,trap_end;
} Case;
#include "ordinary-cases.h"
__declspec(dllimport) void __stdcall ExitProcess(uint32_t);
__declspec(dllimport) void *__stdcall GetStdHandle(uint32_t);
__declspec(dllimport) int __stdcall WriteFile(void *,const void *,uint32_t,uint32_t *,void *);
typedef struct {uint32_t trap,bad,events,depth,fuel,trap_function,trap_start,trap_end;} State;
static uint32_t event(void *opaque,uint32_t kind,uint32_t fn,uint32_t start,uint32_t end,uint64_t interval){
    State *s=opaque;++s->events;
    if(fn>=sizeof(functions)/sizeof(functions[0])||interval==0||s->events>1024){s->bad=1;return 0;}
    if(s->trap&&kind!=3&&kind!=8){s->bad=1;return 0;}
    if(kind==8)return s->trap==0&&s->bad==0;
    const Span range=functions[fn];
    if(start<range.start||start>=end||end>range.end){s->bad=1;return 0;}
    if(kind==0){if(s->depth>=64){s->bad=1;return 0;}++s->depth;}
    else if(kind==1){if(s->fuel==0){s->bad=1;return 0;}--s->fuel;}
    else if(kind==3){if(s->depth==0)s->bad=1;else --s->depth;}
    else if(kind>=5&&kind<=7||kind==9||kind==10||kind==11){
        if(!s->trap){s->trap=kind;s->trap_function=fn;s->trap_start=start;s->trap_end=end;}
    }else if(kind!=2&&kind!=4)s->bad=1;
    return s->trap==0&&s->bad==0;
}
static void report(uint32_t n,int good){
    char text[48];uint32_t length=0,written=0;const char *prefix=good?"PASS cases ":"FAIL case ";
    while(*prefix)text[length++]=*prefix++;char digits[12];uint32_t count=0;
    do{digits[count++]=(char)('0'+n%10);n/=10;}while(n);
    while(count)text[length++]=digits[--count];text[length++]='\n';
    WriteFile(GetStdHandle((uint32_t)-11),text,length,&written,0);
}
void mainCRTStartup(void){
    if(tsfg_native_abi_version!=3){report(0,0);ExitProcess(1);}
    for(uint32_t i=0;i<sizeof(cases)/sizeof(cases[0]);++i){
        const Case *row=&cases[i];Slot output={0x12345678,0x87654321};State state;
        state.trap=state.bad=state.events=state.trap_function=state.trap_start=state.trap_end=0;
        state.depth=1;state.fuel=64;
        uint32_t ok=tsfg_native_invoke_v3(&state,event,row->function,row->count,row->types,row->result,row->arguments,&output);
        uint64_t bits=(uint64_t)output.low|((uint64_t)output.high<<32);
        int bad=state.bad;
        if(row->reason==255)bad|=ok!=0||state.events!=0||bits!=UINT64_C(0x8765432112345678);
        else if(row->reason)bad|=ok!=0||state.trap!=row->reason||state.depth!=0||state.trap_function!=row->trap_function
            ||state.trap_start!=row->trap_start||state.trap_end!=row->trap_end||bits!=UINT64_C(0x8765432112345678);
        else bad|=ok!=1||state.trap!=0||state.depth!=0||bits!=row->expected;
        if(bad){report(i,0);ExitProcess(1);}
    }
    report((uint32_t)(sizeof(cases)/sizeof(cases[0])),1);ExitProcess(0);
}
