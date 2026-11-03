// SPDX-License-Identifier: MIT
#pragma once
#include <cstddef>
#include <cstdint>
#include <limits>

namespace tsfg::wire {
inline constexpr size_t maxBytes=8388608,maxWork=100000;
inline constexpr size_t requestHeaderBytes=12,maxRequestPackets=128;
inline constexpr size_t maxRequestContainerBytes=maxBytes+requestHeaderBytes+4*maxRequestPackets;
constexpr bool requestContainerBound(size_t packetBytes,size_t count,size_t &total) {
  if(!count||count>maxRequestPackets||packetBytes>maxBytes||packetBytes<count*80)return false;
  const size_t overhead=requestHeaderBytes+4*count;
  if(packetBytes>std::numeric_limits<size_t>::max()-overhead)return false;
  total=packetBytes+overhead;return true;
}
constexpr bool alignedBound(uint32_t value,uint32_t alignment,uint32_t limit,uint32_t &out) {
  if(!alignment||alignment>8||(alignment&(alignment-1))||value>limit)return false;
  const uint32_t padding=(alignment-value%alignment)%alignment;
  if(padding>limit-value)return false;out=value+padding;return true;
}
constexpr bool fieldBound(uint32_t prior,uint32_t bytes,uint32_t alignment,uint32_t &state,uint32_t &offset,uint32_t &end) {
  if(!alignedBound(prior,2,65536,state)||state>65534||!alignedBound(state+2,alignment,65536,offset)||bytes>65536-offset)return false;
  end=offset+bytes;return true;
}
constexpr bool unionBound(uint32_t payload,uint32_t alignment,uint32_t &bytes) {
  uint32_t offset=0;
  if(payload>65536||!alignedBound(2,alignment,8,offset)||payload>65544-offset)return false;
  return alignedBound(offset+payload,alignment<2?2:alignment,65544,bytes);
}
constexpr bool boundaryContract() {
  size_t size=0;uint32_t state=0,offset=0,end=0,bytes=0;
  return requestContainerBound(8388608,1,size)&&size==8388624&&
    requestContainerBound(8388608,128,size)&&size==8389132&&
    !requestContainerBound(8388609,1,size)&&!requestContainerBound(8388608,129,size)&&
    !requestContainerBound(std::numeric_limits<size_t>::max(),128,size)&&
    fieldBound(0,65528,8,state,offset,end)&&state==0&&offset==8&&end==65536&&
    !fieldBound(65536,0,1,state,offset,end)&&!fieldBound(UINT32_MAX,1,8,state,offset,end)&&
    unionBound(65536,8,bytes)&&bytes==65544&&!unionBound(65537,8,bytes)&&
    !unionBound(65536,3,bytes)&&!unionBound(UINT32_MAX,8,bytes);
}
static_assert(boundaryContract(),"formal packet/transport/storage boundary contract");
} // namespace tsfg::wire
