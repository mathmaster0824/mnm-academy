/* 메모리 Firestore 가짜(운영 Firebase 접속 없음). 시험 전용. */
module.exports = `(function(){
  const store = {};                       // {collection: {id: data}}
  window.__store = store;
  const clone = (o)=>JSON.parse(JSON.stringify(o));
  const col = (c)=> (store[c] = store[c] || {});
  const snapOf = (c,id)=>{ const d=col(c)[id]; return {id, exists:d!==undefined, data:()=>d===undefined?undefined:clone(d), ref:null}; };
  let seq = 0;
  function query(c, filters=[], order=null, lim=null, after=null){
    const q = {
      where:(f,op,v)=>query(c,[...filters,[f,op,v]],order,lim,after),
      orderBy:(f,dir)=>query(c,filters,[f,dir||'asc'],lim,after),
      limit:(n)=>query(c,filters,order,n,after),
      startAfter:(s)=>query(c,filters,order,lim,s),
      get:async()=>{
        let rows = Object.keys(col(c)).map(id=>({id,d:col(c)[id]}));
        for(const [f,op,v] of filters){
          rows = rows.filter(({d})=> op==='==' ? d[f]===v : op==='array-contains' ? Array.isArray(d[f])&&d[f].includes(v) : op==='in' ? v.includes(d[f]) : true);
        }
        if(order) rows.sort((a,b)=> (String(a.d[order[0]]??'')<String(b.d[order[0]]??'')?-1:1)*(order[1]==='desc'?-1:1));
        if(after){ const i=rows.findIndex(r=>r.id===after.id); rows=rows.slice(i+1); }
        if(lim!=null) rows=rows.slice(0,lim);
        const docs=rows.map(r=>snapOf(c,r.id));
        return {docs, size:docs.length, empty:docs.length===0, forEach:(f)=>docs.forEach(f)};
      },
      onSnapshot:()=>()=>{},
    };
    return q;
  }
  const fsdb = {
    collection:(c)=>Object.assign(query(c),{
      doc:(id)=>({
        get:async()=>snapOf(c,id),
        set:async(data,opts)=>{ const cur=col(c)[id]; col(c)[id]=(opts&&opts.merge&&cur)?{...cur,...clone(data)}:clone(data); },
        update:async(data)=>{ if(col(c)[id]===undefined) throw Object.assign(new Error('not-found'),{code:'not-found'}); col(c)[id]={...col(c)[id],...clone(data)}; },
        delete:async()=>{ delete col(c)[id]; },
        onSnapshot:()=>()=>{},
      }),
      add:async(data)=>{ const id='auto'+(++seq); col(c)[id]=clone(data); return {id}; },
    }),
    enablePersistence:()=>Promise.resolve(), settings:()=>{},
  };
  window.firebase={initializeApp:()=>{},app:()=>({functions:()=>({httpsCallable:()=>async()=>({data:{}})})}),auth:()=>({onAuthStateChanged:()=>{},signInAnonymously:()=>Promise.resolve({}),signInWithEmailAndPassword:()=>Promise.resolve({user:{}}),signInWithCustomToken:()=>Promise.resolve({}),signOut:()=>Promise.resolve(),setPersistence:()=>Promise.resolve(),currentUser:null}),
    firestore:Object.assign(()=>fsdb,{FieldPath:{documentId:()=>'__name__'},FieldValue:{serverTimestamp:()=>({}),delete:()=>({}),arrayUnion:(...a)=>({__union:a}),arrayRemove:(...a)=>({__remove:a}),increment:(n)=>({__inc:n})}}),};
  window.firebase.auth.Auth={Persistence:{LOCAL:'local'}};
})();`;
