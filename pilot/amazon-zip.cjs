'use strict';
// Read ZIP metadata without extracting unrelated Amazon account files.
// Supports standard ZIP and ZIP64 central directories, including archives
// containing thousands of auxiliary files. Size limits stay enforced by
// the caller's bounded decompression and CSV parser.
const MAX_ENTRIES=250000;
function fail(message){throw Error(message)}
function u64(b,at,max,label){
 if(at<0||at+8>b.length)fail('Invalid Amazon ZIP64 '+label);
 const n=b.readBigUInt64LE(at);
 if(n>BigInt(Number.MAX_SAFE_INTEGER)||n>BigInt(max))
  fail('Amazon ZIP64 '+label+' exceeds the safe limit');
 return Number(n);
}
function directory(b){
 if(!Buffer.isBuffer(b)||b.length<22)fail('Invalid Amazon ZIP');
 let end=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--){
  if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){
   end=i;break;
  }
 }
 if(end<0)fail('Invalid Amazon ZIP directory footer');
 const disk=b.readUInt16LE(end+4),diskWithDirectory=b.readUInt16LE(end+6);
 let onDisk=b.readUInt16LE(end+8),count=b.readUInt16LE(end+10),
  size=b.readUInt32LE(end+12),offset=b.readUInt32LE(end+16);
 if(disk!==0||diskWithDirectory!==0)fail('Multi-part Amazon ZIP archives are not supported');
 const hasZip64=end>=20&&b.readUInt32LE(end-20)===0x07064b50;
 if(hasZip64){
  const locator=end-20;
  if(b.readUInt32LE(locator+4)!==0||b.readUInt32LE(locator+16)!==1)
   fail('Multi-part Amazon ZIP64 archives are not supported');
  const at=u64(b,locator+8,b.length,'record offset');
  if(at+56>locator||b.readUInt32LE(at)!==0x06064b50)
   fail('Invalid Amazon ZIP64 directory');
  const recordSize=u64(b,at+4,b.length,'record length');
  if(recordSize<44||at+12+recordSize>locator||
     b.readUInt32LE(at+16)!==0||b.readUInt32LE(at+20)!==0)
   fail('Invalid Amazon ZIP64 record');
  onDisk=u64(b,at+24,MAX_ENTRIES,'entry count');
  count=u64(b,at+32,MAX_ENTRIES,'entry count');
  size=u64(b,at+40,b.length,'directory size');
  offset=u64(b,at+48,b.length,'directory offset');
 }else if(count===0xffff||onDisk===0xffff||
          size===0xffffffff||offset===0xffffffff){
  fail('Amazon ZIP64 directory locator is missing');
 }
 if(count!==onDisk)fail('Invalid Amazon ZIP entry counts');
 if(count>MAX_ENTRIES)fail('Amazon ZIP has too many files');
 if(size> b.length||offset> b.length-size||offset+size>end)
  fail('Invalid Amazon ZIP directory offset');
 if(count>Math.floor(size/46))fail('Invalid Amazon ZIP directory length');
 return {count,offset,end:offset+size};
}
// The extra field contains only values whose 32-bit counterparts are all-ones.
// Their ordering is mandated by the ZIP64 spec.
function zip64Entry(b,start,length,needs){
 let at=start;
 const limit=start+length;
 while(at+4<=limit){
  const tag=b.readUInt16LE(at),len=b.readUInt16LE(at+2);
  at+=4;
  if(at+len>limit)fail('Invalid Amazon ZIP entry extra fields');
  if(tag===0x0001){
   let p=at;
   const take=(maximum,field)=>{
    if(p+8>at+len)fail('Invalid Amazon ZIP64 entry '+field);
    const val=u64(b,p,maximum,field);p+=8;return val;
   };
   let res={};
   if(needs.uncompressed)res.uncompressed=take(384*1024*1024,'uncompressed size');
   if(needs.compressed)res.compressed=take(b.length,'compressed size');
   if(needs.local)res.local=take(b.length,'local entry offset');
   if(needs.disk){
    if(p+4>at+len||b.readUInt32LE(p)!==0)
     fail('Multi-part Amazon ZIP64 entries are not supported');
   }
   return res;
  }
  at+=len;
 }
 fail('Invalid Amazon ZIP64 entry metadata');
}
function selectedEntries(b,accept,{maxSelected=30,maxUncompressed=384*1024*1024}={}){
 const cd=directory(b),files=[];
 let ptr=cd.offset,expanded=0;
 for(let i=0;i<cd.count;i++){
  if(ptr+46>cd.end||b.readUInt32LE(ptr)!==0x02014b50)
   fail('Invalid Amazon ZIP central directory');
  const flags=b.readUInt16LE(ptr+8),method=b.readUInt16LE(ptr+10),
   packed=b.readUInt32LE(ptr+20),unpacked=b.readUInt32LE(ptr+24),
   n=b.readUInt16LE(ptr+28),e=b.readUInt16LE(ptr+30),
   c=b.readUInt16LE(ptr+32),startDisk=b.readUInt16LE(ptr+34),
   relative=b.readUInt32LE(ptr+42),
   next=ptr+46+n+e+c;
  if(next>cd.end)fail('Invalid Amazon ZIP filename metadata');
  const name=b.subarray(ptr+46,ptr+46+n).toString('utf8');
  if(accept(name)){
   if(files.length>=maxSelected)fail('Amazon ZIP has too many matching order-history CSVs');
   const needs={uncompressed:unpacked===0xffffffff,
    compressed:packed===0xffffffff,local:relative===0xffffffff,
    disk:startDisk===0xffff};
   const extra=Object.values(needs).some(Boolean)?
    zip64Entry(b,ptr+46+n,e,needs):{};
   if(startDisk!==0&&startDisk!==0xffff)
    fail('Multi-part Amazon ZIP entries are not supported');
   const uncompressed=extra.uncompressed??unpacked,
    compressed=extra.compressed??packed,
    local=extra.local??relative;
   if(flags&1)fail('Password-protected Amazon ZIP entries are not supported');
   if(method!==0&&method!==8)fail('Unsupported Amazon ZIP compression');
   if(uncompressed>maxUncompressed||expanded+uncompressed>maxUncompressed)
    fail('Amazon ZIP contains too much extracted order history');
   if(local+30>cd.offset||b.readUInt32LE(local)!==0x04034b50)
    fail('Invalid Amazon ZIP local entry');
   const offset=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);
   if(offset>cd.offset||compressed>cd.offset-offset)
    fail('Truncated Amazon ZIP order-history entry');
   files.push({start:offset,compressed,uncompressed,method});
   expanded+=uncompressed;
  }
  ptr=next;
 }
 if(ptr!==cd.end)fail('Invalid Amazon ZIP directory length');
 return files;
}
module.exports={selectedEntries};
