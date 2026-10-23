const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
test('quantity changes survive reload and removal preserves other cart lines and totals',()=>{
 const pricing=require('./helpers/load-ts.cjs').loadShared()
 const values=new Map(),context={exports:{},require:specifier=>{assert.match(specifier,/_shared\/pricing\.ts$/);return pricing},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/cart.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context)
 const c=context.exports
 let cart=c.addProduct([],{id:'a',name:'A',price:40,shipping_from:'Shipping Gigi'})
 cart=c.addProduct(cart,{id:'b',name:'B',price:20,shipping_from:'Shipping Gigi'})
 cart=c.changeQuantity(cart,'a',1)
 assert.equal(c.loadCart().find(x=>x.id==='a').quantity,2)
 assert.equal(c.calculateCart(cart,false).subtotal,100)
 cart=cart.filter(x=>x.id!=='a');c.saveCart(cart)
 assert.equal(c.loadCart().length,1);assert.equal(c.loadCart()[0].id,'b')
 assert.equal(c.calculateCart(c.loadCart(),false).total,41.6)
 c.changeQuantity(cart,'b',-1);assert.equal(c.loadCart().length,0)
})
test('cart quantities stop at the checkout limit of 99 per product',()=>{
 const pricing=require('./helpers/load-ts.cjs').loadShared()
 const values=new Map(),context={exports:{},require:()=>pricing,localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/cart.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context)
 const c=context.exports
 let cart=c.addProduct([],{id:'a',name:'A',price:1,shipping_from:''})
 cart=c.changeQuantity(cart,'a',150);assert.equal(cart[0].quantity,99)
 cart=c.addProduct(cart,{id:'a',name:'A',price:1,shipping_from:''});assert.equal(cart[0].quantity,99)
 assert.equal(c.MAX_LINE_QUANTITY,99)
})
