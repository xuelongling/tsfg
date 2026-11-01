// SPDX-License-Identifier: MIT
// The five ordinary test entry points are renamed per TU with -Dmain=... .
// Helpers stay in each source's anonymous namespace; no source is included here.
#include <cstdio>
int tsfg_context_slots_tests();
int tsfg_receiver_slots_tests();
int tsfg_reconcile_slots_tests();
int tsfg_owned_slots_tests();
int tsfg_seed_tag_view_tests();
int main(){
  const struct {const char *name;int(*run)();} components[]={
    {"original context interner5",tsfg_context_slots_tests},
    {"receiver edge-store12",tsfg_receiver_slots_tests},
    {"receiverReconcile1",tsfg_reconcile_slots_tests},
    {"owned physical field-slot1",tsfg_owned_slots_tests},
    {"seed tag-view6",tsfg_seed_tag_view_tests}
  };
  for(const auto &component:components){const auto result=component.run();if(result){std::fprintf(stderr,"FAIL component: %s (%d)\n",component.name,result);return result;}std::fprintf(stderr,"PASS component: %s\n",component.name);}
  std::fputs("PASS combined 5+12+1+1+6 groups; complete Source820b remains independent\n",stderr);return 0;
}
