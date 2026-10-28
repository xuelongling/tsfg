// SPDX-License-Identifier: MIT
#include "finite-array-memory-internal.h"

namespace tsfg::finite {
using memorydetail::ArrayMemory;
bool verifyArrayMemory(ModuleProof &proof,bool compareClaims){return ArrayMemory{proof,compareClaims}.run();}
bool proveArrayExtent(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,ArrayExtent &extent){
  return ArrayMemory{proof,false}.extent(point,receiver,extent);
}
bool proveArrayCell(ModuleProof &proof,mlir::Operation *point,mlir::Value receiver,uint32_t index,ArrayExtent &cell){
  return ArrayMemory{proof,false}.cell(point,receiver,index,cell);
}
bool verifyArrayOverwriteEffects(ModuleProof &proof){return ArrayMemory{proof,false}.overwrites();}
} // namespace tsfg::finite
