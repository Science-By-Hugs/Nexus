const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript')
function load(file,extras={}) {
 const context={exports:{},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},...extras}
 const source=fs.readFileSync('src/services/'+file,'utf8').replace(/^import .*$/gm,'')
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
 return context.exports
}
test('unknown and exhausted stock cannot enter cart; refreshed catalog removes unpublished products and updates prices',()=>{
 const c=load('cart.ts'), p={id:'p',name:'P',price:12,available_to_sell:null}
 assert.equal(c.addProduct([],p).length,0)
 let cart=c.addProduct([],{...p,available_to_sell:1})
 assert.equal(c.addProduct(cart,{...p,available_to_sell:1})[0].quantity,1)
 cart=c.reconcileCart([{...cart[0],quantity:7}], [{...p,price:15,available_to_sell:2}])
 assert.equal(cart[0].quantity,2);assert.equal(cart[0].price,15)
 assert.equal(c.reconcileCart(cart,[]).length,0)
})
test('sandbox order sends expected price and idempotency to server, never calls payment provider',async()=>{
 const calls=[],api=load('checkout.ts',{supabase:{async rpc(name,body){calls.push({name,body});return {data:{id:'order',order_number:'STG-order',total:24,sandbox:true},error:null}}}})
 await api.submitSandboxOrder([{id:'p',quantity:2,price:12}],{city:'Henderson',idempotencyKey:'key'})
 assert.equal(calls[0].name,'staging_submit_order');assert.equal(calls[0].body.p_items[0].unit_price,12)
 assert.equal(calls[0].body.p_idempotency_key,'key')
 await api.cancelSandboxOrder('order');assert.equal(calls[1].name,'staging_cancel_order')
})
test('sandbox order errors are surfaced and empty cart does not call backend',async()=>{
 let calls=0;const api=load('checkout.ts',{supabase:{async rpc(){calls++;return {error:{message:'Price changed; review your cart'}}}}})
 await assert.rejects(api.submitSandboxOrder([],{city:'Henderson',idempotencyKey:'key'}),/empty/);assert.equal(calls,0)
 await assert.rejects(api.submitSandboxOrder([{id:'p',quantity:1,price:1}],{city:'Henderson',idempotencyKey:'key'}),/Price changed/)
})
