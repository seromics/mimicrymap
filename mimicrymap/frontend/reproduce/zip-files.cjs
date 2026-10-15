'use strict';
// Streaming ZIP64/DEFLATE for large mapping and CSV downloads. No Python or
// archive-sized buffer is required by the portable Node.js runner.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
async function write(file,entries,report=()=>{}){
 const pending=file+'.partial';if(fs.existsSync(file)||fs.existsSync(pending))throw Error('Archive destination already exists');
 const fd=fs.openSync(pending,'wx'),central=[];let offset=0;
 const put=b=>{fs.writeSync(fd,b);offset+=b.length;};
 try{
  for(const [name,source]of entries){
   if(!name||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid archive entry');
   const label=Buffer.from(name),start=offset;let size=0,compressed=0,crc=0;
   if(label.length>65535)throw Error('Archive entry name is too long');
   const h=Buffer.alloc(30+label.length+20);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(45,4);h.writeUInt16LE(0x808,6);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);h.writeUInt32LE(0xffffffff,18);h.writeUInt32LE(0xffffffff,22);h.writeUInt16LE(label.length,26);h.writeUInt16LE(20,28);label.copy(h,30);h.writeUInt16LE(1,30+label.length);h.writeUInt16LE(16,32+label.length);put(h);
   const counter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;crc=zlib.crc32(chunk,crc);callback(null,chunk);}}),deflate=zlib.createDeflateRaw({level:6});
   const feeding=pipeline(fs.createReadStream(source),counter,deflate);feeding.catch(()=>{});
   try{for await(const chunk of deflate){put(chunk);compressed+=chunk.length;}await feeding;}catch(error){deflate.destroy();await feeding.catch(()=>{});throw error;}
   const d=Buffer.alloc(24);d.writeUInt32LE(0x08074b50);d.writeUInt32LE(crc,4);d.writeBigUInt64LE(BigInt(compressed),8);d.writeBigUInt64LE(BigInt(size),16);put(d);
   const c=Buffer.alloc(46+label.length+28);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(45,4);c.writeUInt16LE(45,6);c.writeUInt16LE(0x808,8);c.writeUInt16LE(8,10);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(0xffffffff,20);c.writeUInt32LE(0xffffffff,24);c.writeUInt16LE(label.length,28);c.writeUInt16LE(28,30);c.writeUInt32LE(0xffffffff,42);label.copy(c,46);const at=46+label.length;c.writeUInt16LE(1,at);c.writeUInt16LE(24,at+2);c.writeBigUInt64LE(BigInt(size),at+4);c.writeBigUInt64LE(BigInt(compressed),at+12);c.writeBigUInt64LE(BigInt(start),at+20);central.push(c);
   report({phase:'Compressing '+name,done:offset,total:0});
  }
  const start=offset;for(const row of central)put(row);const length=offset-start,endOffset=offset;
  const end=Buffer.alloc(56);end.writeUInt32LE(0x06064b50);end.writeBigUInt64LE(44n,4);end.writeUInt16LE(45,12);end.writeUInt16LE(45,14);end.writeBigUInt64LE(BigInt(central.length),24);end.writeBigUInt64LE(BigInt(central.length),32);end.writeBigUInt64LE(BigInt(length),40);end.writeBigUInt64LE(BigInt(start),48);put(end);
  const locator=Buffer.alloc(20);locator.writeUInt32LE(0x07064b50);locator.writeBigUInt64LE(BigInt(endOffset),8);locator.writeUInt32LE(1,16);put(locator);
  const tail=Buffer.alloc(22);tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(65535,8);tail.writeUInt16LE(65535,10);tail.writeUInt32LE(0xffffffff,12);tail.writeUInt32LE(0xffffffff,16);put(tail);
 }catch(error){fs.closeSync(fd);fs.unlinkSync(pending);throw error;}
 fs.closeSync(fd);fs.renameSync(pending,file);return {file,bytes:offset};
}
module.exports={write};
