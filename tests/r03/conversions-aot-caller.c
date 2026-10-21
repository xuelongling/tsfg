// SPDX-License-Identifier: MIT
// Fixed typed caller for the complete conversion table emitted by the real
// ordinary Core CLI. No bytecode/descriptor loader, guest interpreter or input.
#include <stdint.h>
#include <stddef.h>
typedef struct { uint32_t low, high; } Slot;
typedef uint32_t (*Event)(void *,uint32_t,uint32_t,uint32_t,uint32_t,uint64_t);
extern const uint32_t tsfg_native_abi_version;
extern uint32_t tsfg_native_invoke_v3(void *,Event,uint32_t,uint32_t,
    const uint8_t *,uint8_t,const Slot *,Slot *);
typedef struct { uint32_t function; uint8_t from,to,reason; uint64_t input,expected; } Case;
// Literal projection of the separately frozen independent mathematical oracle.
#include "conversion-cases.h"
__declspec(dllimport) void __stdcall ExitProcess(uint32_t);
__declspec(dllimport) void *__stdcall GetStdHandle(uint32_t);
__declspec(dllimport) int __stdcall WriteFile(void *,const void *,uint32_t,uint32_t *,void *);
typedef struct { uint32_t function,trap,bad,count; uint8_t events[12]; } State;
static uint32_t event(void *opaque,uint32_t kind,uint32_t fn,uint32_t start,uint32_t end,uint64_t interval) {
    State *s=opaque;
    if (s->count>=12 || fn!=s->function || interval==0) {s->bad=1;return 0;}
    s->events[s->count++]=(uint8_t)kind;
    if (kind==1) {if(start!=0||end!=100)s->bad=1;}
    else if (kind==8) {if(start!=0||end!=0)s->bad=1;return s->trap==0&&s->bad==0;}
    else if (kind==3) {if(s->trap ? start!=0||end!=100 : start!=10||end!=20)s->bad=1;}
    else if (kind==2||kind==4||kind==9||kind==10) {if(start!=10||end!=20)s->bad=1;}
    else s->bad=1;
    if(kind==9||kind==10)s->trap=kind==9?1:2;
    return s->bad==0;
}
static void report(uint32_t n,int good) {
    char text[48];uint32_t length=0,written=0;
    const char *prefix=good?"PASS cases ":"FAIL case ";
    while(*prefix)text[length++]=*prefix++;
    char digits[12];uint32_t count=0;
    do {digits[count++]=(char)('0'+n%10);n/=10;}while(n);
    while(count)text[length++]=digits[--count];text[length++]='\n';
    WriteFile(GetStdHandle((uint32_t)-11),text,length,&written,0);
}
void mainCRTStartup(void) {
    if(tsfg_native_abi_version!=3){report(0,0);ExitProcess(1);}
    for(uint32_t i=0;i<sizeof(cases)/sizeof(cases[0]);++i){
        const Case *row=&cases[i];
        Slot input={(uint32_t)row->input,(uint32_t)(row->input>>32)};
        Slot output={0x12345678,0x87654321};
        State state;state.function=row->function;state.trap=state.bad=state.count=0;
        uint32_t ok=tsfg_native_invoke_v3(&state,event,row->function,1,&row->from,row->to,&input,&output);
        uint64_t bits=(uint64_t)output.low|((uint64_t)output.high<<32);
        const uint8_t success[]={1,2,2,4,3,8};
        const uint8_t failed[]={1,2,(uint8_t)(row->reason==1?9:10),3,8};
        const uint8_t *expected=row->reason?failed:success;
        uint32_t count=row->reason?5:6;
        int bad=state.bad||state.trap!=row->reason||state.count!=count;
        for(uint32_t e=0;e<count&&!bad;++e)bad=state.events[e]!=expected[e];
        if(row->reason)bad|=ok!=0||bits!=UINT64_C(0x8765432112345678);
        else bad|=ok!=1||bits!=row->expected;
        if(bad){report(i,0);ExitProcess(1);}
    }
    report((uint32_t)(sizeof(cases)/sizeof(cases[0])),1);ExitProcess(0);
}
