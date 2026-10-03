const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fixture=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/ingredients-request.json'),'utf8'));
const api=import('../src/providers/google-flow/ingredients-ui.js');
const req={prompt:fixture[0][0][0][2][0][0][0],project_id:fixture[1][5],provider_model_id:'abra_r2v_10s',aspect_ratio:'9:16'};
const ids=['ref-1','ref-2','ref-3'];
const body=(p,rpc='MZZa6b')=>new URLSearchParams({'f.req':JSON.stringify([[[rpc,JSON.stringify(p),null,'generic']]])}).toString();
test('real HAR Ingredients shape accepts all three references',async()=>{
 assert.deepEqual((await api).matchIngredientRequest(body(fixture),req,ids),{rpc:'MZZa6b',actualModelId:'abra_r2v_10s'});
});
test('one or two references and landscape are supported without frame conversion',async()=>{
 for(const n of [1,2]){const p=structuredClone(fixture);p[0][0][1]=p[0][0][1].slice(0,n);p[0][0][3]=2;
 assert.ok((await api).matchIngredientRequest(body(p),{...req,aspect_ratio:'16:9'},ids.slice(0,n)));}
});
test('reject missing third image, swapped references, wrong model, aspect and output count',async()=>{
 for(const change of [p=>p[0][0][1].pop(),p=>p[0][0][1].reverse(),p=>p[0][0][2]='abra_i2v_10s',p=>p[0][0][3]=2,p=>p[0].push(p[0][0])]){
 const p=structuredClone(fixture);change(p);assert.throws(()=>(apiValue.matchIngredientRequest(body(p),req,ids)),/different ingredient/);
 }
});
let apiValue;
test.before(async()=>{apiValue=await api;});
test('ignore Frames RPC and unrelated project/prompt',async()=>{
 assert.equal((await api).matchIngredientRequest(body(fixture,'nprQif'),req,ids),null);
 assert.equal((await api).matchIngredientRequest(body(fixture),{...req,project_id:'other'},ids),null);
 assert.equal((await api).matchIngredientRequest(body(fixture),{...req,prompt:'other'},ids),null);
});
test('ignore malformed network payload',async()=>{
 for(const b of ['', 'f.req=null', 'f.req=[null]', 'f.req=[[null]]'])assert.equal((await api).matchIngredientRequest(b,req,ids),null);
});
