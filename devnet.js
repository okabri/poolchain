const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } = await import('https://esm.sh/@solana/web3.js@1.98.4');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getMint, createAssociatedTokenAccountIdempotentInstruction } = await import('https://esm.sh/@solana/spl-token@0.4.14?external=@solana/web3.js');

const RPC='https://api.devnet.solana.com';
const DEFAULT_PROGRAM_ID='BpJYTgPV7xHj6X332MWvdP8pMiTpRaWTnCZXMKDneKPz';
const POOL_SIZE=368;
const enc=new TextEncoder(), dec=new TextDecoder();
const utf8=s=>enc.encode(s);
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out};
const u64=n=>{let x=BigInt(n),a=new Uint8Array(8);for(let i=0;i<8;i++){a[i]=Number(x&255n);x>>=8n}return a};
const u32=n=>new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
const string=s=>{const b=utf8(s);return concat(u32(b.length),b)};
const disc=async name=>new Uint8Array(await crypto.subtle.digest('SHA-256',utf8(`global:${name}`))).slice(0,8);
const key=()=>new PublicKey(localStorage.getItem('poolchain_program_id')||DEFAULT_PROGRAM_ID);
const conn=()=>new Connection(RPC,'confirmed');
const addr=p=>p.toBase58();
function parsePool(account,address){
  const b=account.data, view=new DataView(b.buffer,b.byteOffset,b.byteLength);let o=8;
  const creator=new PublicKey(b.slice(o,o+32));o+=32;
  const poolId=readU64(b,o);o+=8;const mint=new PublicKey(b.slice(o,o+32));o+=32;
  const amount=readU64(b,o);o+=8;const decimals=b[o++],isSol=b[o++]===1,slots=b[o++];
  const applicants=view.getUint16(o,true);o+=2;const selected=b[o++],status=b[o++];
  const createdAt=Number(readI64(b,o));o+=8;o++;
  const name=readString(b,view,()=>o);o=name.next;
  const description=readString(b,view,()=>o);o=description.next;
  const category=readString(b,view,()=>o);
  const factor=10**decimals;
  return {id:address,chain:true,address,owner:addr(creator),ownerDisplay:`${addr(creator).slice(0,4)}...${addr(creator).slice(-4)}`,poolId:poolId.toString(),mint:addr(mint),asset:isSol?'SOL':addr(mint)==='4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'?'USDC':'SPL',amount:Number(amount)/factor,rawAmount:amount.toString(),decimals,slots,selected,applicants,distributed:status===1,desc:description.value,name:name.value,category:category.value,createdAt:createdAt*1000};
}
function readString(b,v,offset){let o=offset();const len=v.getUint32(o,true);o+=4;const value=dec.decode(b.slice(o,o+len));return {value,next:o+len}}
function readU64(b,o){let n=0n;for(let i=7;i>=0;i--)n=(n<<8n)|BigInt(b[o+i]);return n}
function readI64(b,o){const n=readU64(b,o);return n>=(1n<<63n)?n-(1n<<64n):n}
function parseApp(account,address){const b=account.data,view=new DataView(b.buffer,b.byteOffset,b.byteLength);let o=8;const pool=new PublicKey(b.slice(o,o+32));o+=32;const applicant=new PublicKey(b.slice(o,o+32));o+=32;const status=b[o++],message=dec.decode(b.slice(o+4,o+4+view.getUint32(o,true)));return {address, pool:addr(pool),wallet:addr(applicant),message,status,selected:status===1}}
async function send(ixs,provider){if(!provider?.publicKey)throw Error('Önce Phantom veya Solflare cüzdanını bağla.');const c=conn(),latest=await c.getLatestBlockhash('confirmed'),tx=new Transaction();tx.add(...ixs);tx.feePayer=provider.publicKey;tx.recentBlockhash=latest.blockhash;const signed=await provider.signTransaction(tx);const sig=await c.sendRawTransaction(signed.serialize(),{skipPreflight:false});await c.confirmTransaction({signature:sig,...latest},'confirmed');return sig}
async function poolPda(owner,poolId,program){return PublicKey.findProgramAddressSync([utf8('pool'),owner.toBytes(),u64(poolId)],program)}
async function appPda(pool,applicant,program){return PublicKey.findProgramAddressSync([utf8('application'),pool.toBytes(),applicant.toBytes()],program)}
async function createPool(input,provider){
  const program=key(),owner=provider?.publicKey;if(!owner)throw Error('Önce cüzdanını bağla.');
  const isSol=input.asset==='SOL';let mint,decimals=9,amount;
  if(isSol){amount=toUnits(input.amount,9)}else{if(!input.mint)throw Error('Devnet token mint adresini gir.');mint=new PublicKey(input.mint);decimals=(await getMint(conn(),mint,'confirmed',TOKEN_PROGRAM_ID)).decimals;amount=toUnits(input.amount,decimals)}
  const poolId=BigInt(Date.now())*1000n+BigInt(Math.floor(Math.random()*999));const [pool]=await poolPda(owner,poolId,program);
  if(amount%BigInt(input.slots)!==0n)throw Error('Toplam tutar en küçük token biriminde katılımcı sayısına tam bölünmeli.');
  const ixData=concat(await disc(isSol?'create_sol_pool':'create_token_pool'),u64(poolId),u64(amount),new Uint8Array([input.slots]),string(input.name),string(input.desc),string(input.category));
  let keys;
  if(isSol)keys=[{pubkey:owner,isSigner:true,isWritable:true},{pubkey:pool,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}];
  else{const creatorToken=await getAssociatedTokenAddress(mint,owner);const vault=await getAssociatedTokenAddress(mint,pool,true);keys=[{pubkey:owner,isSigner:true,isWritable:true},{pubkey:mint,isSigner:false,isWritable:false},{pubkey:creatorToken,isSigner:false,isWritable:true},{pubkey:pool,isSigner:false,isWritable:true},{pubkey:vault,isSigner:false,isWritable:true},{pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},{pubkey:ASSOCIATED_TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:(await import('https://esm.sh/@solana/web3.js@1.98.4')).SYSVAR_RENT_PUBKEY,isSigner:false,isWritable:false}]}
  const sig=await send([new TransactionInstruction({programId:program,keys,data:ixData})],provider);return {sig,pool:addr(pool)};
}
function toUnits(value,decimals){const s=String(value).trim();if(!/^\d+(\.\d+)?$/.test(s))throw Error('Geçerli bir miktar yaz.');const [whole,frac='']=s.split('.');if(frac.length>decimals)throw Error(`Bu varlık en fazla ${decimals} ondalık basamak destekliyor.`);return BigInt(whole)*10n**BigInt(decimals)+BigInt((frac+'0'.repeat(decimals)).slice(0,decimals)||'0')}
async function listPools(){const program=key(),c=conn();const all=await c.getProgramAccounts(program,{filters:[{dataSize:POOL_SIZE}]});return all.map(x=>parsePool(x.account,addr(x.pubkey))).sort((a,b)=>b.createdAt-a.createdAt)}
async function listApplications(poolAddress){const program=key(),c=conn(),pool=new PublicKey(poolAddress);const rows=await c.getProgramAccounts(program,{filters:[{dataSize:317},{memcmp:{offset:8,bytes:addr(pool)}}]});return rows.map(x=>parseApp(x.account,addr(x.pubkey))).filter(x=>x.pool===addr(pool)).sort((a,b)=>a.address.localeCompare(b.address))}
async function apply(poolAddress,message,provider){if(utf8(message).length>240)throw Error('Başvuru mesajı 240 bayt sınırını aşıyor.');const program=key(),pool=new PublicKey(poolAddress),owner=provider?.publicKey;if(!owner)throw Error('Önce cüzdanını bağla.');const [application]=await appPda(pool,owner,program);const data=concat(await disc('apply'),string(message));const ix=new TransactionInstruction({programId:program,keys:[{pubkey:pool,isSigner:false,isWritable:true},{pubkey:application,isSigner:false,isWritable:true},{pubkey:owner,isSigner:true,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}],data});return send([ix],provider)}
async function selectApplicant(poolAddress,applicationAddress,provider){const program=key(),pool=new PublicKey(poolAddress),app=new PublicKey(applicationAddress),owner=provider.publicKey;const ix=new TransactionInstruction({programId:program,keys:[{pubkey:pool,isSigner:false,isWritable:true},{pubkey:owner,isSigner:true,isWritable:false},{pubkey:app,isSigner:false,isWritable:true}],data:await disc('select_applicant')});return send([ix],provider)}
async function distribute(poolData,apps,provider){const program=key(),pool=new PublicKey(poolData.address),owner=provider.publicKey;let keys=[{pubkey:pool,isSigner:false,isWritable:true},{pubkey:owner,isSigner:true,isWritable:true}];
  if(poolData.asset==='SOL')keys.push({pubkey:program,isSigner:false,isWritable:false},{pubkey:program,isSigner:false,isWritable:false},{pubkey:program,isSigner:false,isWritable:false});
  else{const mint=new PublicKey(poolData.mint),vault=await getAssociatedTokenAddress(mint,pool,true);keys.push({pubkey:mint,isSigner:false,isWritable:false},{pubkey:vault,isSigner:false,isWritable:true},{pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false});}
  keys.push({pubkey:SystemProgram.programId,isSigner:false,isWritable:false});const ixs=[];
  for(const app of apps){const appKey=new PublicKey(app.address),recipient=new PublicKey(app.wallet);keys.push({pubkey:appKey,isSigner:false,isWritable:false},{pubkey:recipient,isSigner:false,isWritable:true});if(poolData.asset!=='SOL'){const mint=new PublicKey(poolData.mint),ata=await getAssociatedTokenAddress(mint,recipient);const exists=await conn().getAccountInfo(ata);if(!exists)ixs.push(createAssociatedTokenAccountIdempotentInstruction(owner,ata,recipient,mint));keys.push({pubkey:ata,isSigner:false,isWritable:true});}}
  ixs.push(new TransactionInstruction({programId:program,keys,data:await disc('approve_and_distribute')}));return send(ixs,provider)}
function setProgramId(value){const p=new PublicKey(value.trim());localStorage.setItem('poolchain_program_id',p.toBase58());return p.toBase58()}
window.PoolchainDevnet={rpc:RPC,programId:DEFAULT_PROGRAM_ID,configured:()=>{try{key();return true}catch{return false}},setProgramId,createPool,listPools,listApplications,apply,selectApplicant,distribute};
window.dispatchEvent(new Event('poolchain-devnet-ready'));

