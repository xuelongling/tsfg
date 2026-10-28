function eq(x:i32|undefined,b:i32):i32{if(typeof x==="undefined"){return b;}return x;}
function ne(x:i32|undefined,b:i32):i32{if(typeof x!=="undefined"){return x;}return b;}
function mirrorEq(x:i32|undefined,b:i32):i32{if("undefined"===typeof x){return b;}return x;}
function mirrorNe(x:i32|undefined,b:i32):i32{if("undefined"!==typeof x){return x;}return b;}
function keepNull(x:i32|null|undefined,b:i32):i32{if(typeof x==="undefined"){return b;}return x??b;}
export function entry(n:i32):i32{return eq(n,n);}
