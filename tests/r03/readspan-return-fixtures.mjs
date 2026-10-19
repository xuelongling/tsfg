// SPDX-License-Identifier: MIT
// Only exact independently prepared whole data; actual Source captures are bound separately.
import { oracle } from './readspan-return-test-helpers.mjs';
const pins=[
  {
    "file": "./readspan-return-first-oracle-v7.json",
    "bytes": 299582,
    "sha256": "0906ea73e5650f5b146861e46ffa0dd3ffc11e5f3150ae6583527951d489d748"
  },
  {
    "file": "./readspan-return-adjacent-part1-oracle-v7.json",
    "bytes": 568554,
    "sha256": "1c1c1824c32f102c15b0b5a276a825f76d058d353f3e83ad6cebf5a6986ebb21"
  },
  {
    "file": "./readspan-return-adjacent-part2-oracle-v7.json",
    "bytes": 494315,
    "sha256": "2c48bfadf15abc91a4cd158ca0c5c3e6246954f955109f51cd10650feda4e25d"
  },
  {
    "file": "./readspan-return-events-oracle-v7.json",
    "bytes": 1242071,
    "sha256": "aef65f0ddcb89a9e4c6ca35cbf64c3d742557346510592c20c562a4f7b71aa28"
  },
  {
    "file": "./readspan-return-family-uses-oracle-v7.json",
    "bytes": 1178700,
    "sha256": "e514d000e71016144fa1a2e2896ac30a676439dd9ab3f9089a0424380ce8ee58"
  },
  {
    "file": "./readspan-return-global-1024-oracle-v7.json",
    "bytes": 8983300,
    "sha256": "c7c846b4e5e296134115528eaa93c2b9de0b4f8d8d830c43dd53b1f8e2b15624"
  },
  {
    "file": "./readspan-return-global-1025-oracle-v7.json",
    "bytes": 5590437,
    "sha256": "66e13e9c6947165dcb8ad23910a94419e7acdbd9d61297fad6a234b05f7dda79"
  },
  {
    "file": "./readspan-return-cold-oracle-v7.json",
    "bytes": 1205264,
    "sha256": "70298c9d5aac8b983d80be0a02e89f03f08a1e4c8b86fbfa4158da390eb1f349"
  },
  {
    "file": "./readspan-return-lowercore-oracle-v7.json",
    "bytes": 19584,
    "sha256": "e94ce6a83661e649211d92e3433942a6a41272e2ce640f9408898bad16fbdec2"
  }
];
const data=Promise.all(pins.map(oracle));
/** @returns {Promise<any[]>} */
export async function returnRows() {
  const [first,part1,part2,events,family,lower,upper]=await data;
  return [...first.firstCases,...part1.cases,...part2.cases,...events.cases,...family.cases,lower.case,upper.case];
}
/** @returns {Promise<any[]>} */
export async function returnContextControls() { return (await data)[1].contextOnlyControls; }
/** @returns {Promise<any>} */
export async function returnColdOracle() { return (await data)[7]; }
/** @returns {Promise<Record<string,any>>} */
export async function returnCoreDiagnostics() {
  return Object.fromEntries((await data)[8].cases.map(row=>[row.name,row.expectedDiagnostic]));
}

const syntheticPins=[
  {
    "file": "./readspan-return-synthetic-events101-v7.json",
    "bytes": 364592,
    "sha256": "53f08aab9afa98dd27e70224b4f81dd0c126f9387c619f597b120c301914e71b"
  },
  {
    "file": "./readspan-return-synthetic-family-uses51-v7.json",
    "bytes": 351052,
    "sha256": "11a4829a4a08d754c607430d09f15c8bfc355f4457721e9ad5789458276ed4ad"
  },
  {
    "file": "./readspan-return-synthetic-return-global-1025-v7.json",
    "bytes": 4447647,
    "sha256": "698badf58e6aba26b8aae3e95358875f62a767ee45e4de3b2c4ad38f45189895"
  }
];
/** Synthetic inputs trigger reconstruction; they never claim an upper published HIR.
 * @returns {Promise<Map<string,any>>} */
export async function returnSyntheticInputs() {
  return new Map((await Promise.all(syntheticPins.map(oracle))).map(row=>[row.name,row]));
}
