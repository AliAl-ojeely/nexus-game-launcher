'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { parseLabel, editionEvidence, relatedCandidates } = require('../modules/asset-edition-v064.cjs');
const { chooseRawg, chooseBaseArtwork, queryVariants } = require('../modules/asset-search-identity-v063.cjs');
const demons = "Demon's Souls";
const zelda = 'The Legend of Zelda: Ocarina of Time';
const raw = (id,name,year,desc='') => ({id,name,released:year?`${year}-11-12`:null,description_raw:desc,background_image:'https://media.rawg.io/media/test/hero.jpg'});
const grid = (id,name,year) => ({id,name,release_date:year?`${year}-11-12`:null,types:['game'],verified:true});
const oldD = raw(101,demons,2009,'A dark fantasy action role-playing game.');
const newD = raw(102,demons,2020,'From PlayStation Studios and Bluepoint Games comes a remake of the PlayStation classic, Demon’s Souls. Entirely rebuilt from the ground up.');
const oldZ = raw(201,zelda,1998,'The original adventure.');
const newZ = raw(202,zelda,2026,'A remake of The Legend of Zelda: Ocarina of Time.');
const oldDG=grid(37584,demons,2009),newDG=grid(5270663,demons,2020);
const oldZG=grid(21202,zelda,1998),newZG=grid(5532594,zelda,2026);
function load() {
    const restore=Module._load;
    const modules=['asset-pipeline.js','metadata.js','rawg-api.js','steamGrid-api.js'];
    for(const n of modules) delete require.cache[require.resolve('../modules/'+n)];
    try {
        Module._load=function(id,parent,isMain){
            if(id==='axios') return {get:async()=>{throw Error('LIVE_HTTP_BLOCKED');}};
            if(id==='./provider-credentials') return {};
            if(['./steam-api','./steam-artwork','./youtube-api'].includes(id)) return {};
            if(id==='./assets') return {downloadGameAssets:()=>{throw Error('USER_DATA_BLOCKED');}};
            return restore.call(this,id,parent,isMain);
        };
        return {rawg:require('../modules/rawg-api'),sgdb:require('../modules/steamGrid-api'),pipeline:require('../modules/asset-pipeline')};
    } finally { Module._load=restore; }
}
function fixture({rawRows=[oldD,newD],gridRows=[oldDG,newDG],failDetail=null,rawKey='test',gridKey='test',steam=null}={}) {
    const {rawg,sgdb,pipeline}=load();
    const calls={rawg:[],grid:[],steam:[],library:[],youtube:[]};
    const rawHttp={get:async(url,cfg)=>{
        calls.rawg.push({url,query:cfg.params?.search});assert.equal(cfg.maxRedirects,0);
        if(url.endsWith('/games')) return {data:{results:rawRows.map(({description_raw,...row})=>row)}};
        const id=Number(url.split('/').pop());
        if(id===failDetail) throw Object.assign(Error('private credential'),{code:'ETIMEDOUT'});
        const found=rawRows.find(x=>x.id===id); if(!found) throw Error('unexpected RAWG ID');
        return {data:found};
    }};
    const gridHttp={get:async(url,cfg)=>{
        calls.grid.push(url);assert.equal(cfg.maxRedirects,0);
        if(url.includes('/search/autocomplete/')) return {data:{success:true,data:gridRows}};
        if(url.includes('/games/id/')) {const found=gridRows.find(x=>String(x.id)===url.split('/').pop());return {data:{success:true,data:found}};}
        if(url.includes('/games/steam/')&&steam) return {data:{success:true,data:{id:steam.gridId||90001,name:steam.name}}};
        const m=/\/(grids|heroes|logos|icons)\/game\/(\d+)/.exec(url);if(!m)throw Error('unexpected grid request');
        return {data:{data:[{url:`https://cdn2.steamgriddb.com/test/${m[2]}-${m[1]}.png`,width:m[1]==='grids'?600:1000,height:m[1]==='grids'?900:500}]}};
    }};
    const providers={rawg:{fetchGameDetails:(name,cfg)=>rawg.fetchGameDetails(name,{...cfg,http:rawHttp,apiKey:rawKey})},grid:{fetchGameAssets:(name,id,cfg)=>sgdb.fetchGameAssets(name,id,{...cfg,http:gridHttp,apiKey:gridKey})},steam:{searchAppId:async name=>{calls.steam.push(name);return steam?.appid||null;},fetchGameDetails:async id=>{calls.steam.push(id);return steam;}},library:{fetchSteamArtwork:async id=>{calls.library.push(id);return{};}},youtube:{getTrailerData:async name=>{calls.youtube.push(name);return {videoId:'wrong-video',thumbnail:''};}}};
    return {pipeline,calls,providers,rawg,sgdb,rawHttp,gridHttp};
}

test('parse explicit suffixes in either order and keep year out of game name',()=>{
    for(const label of [`${demons} Remake`,`${demons} (Remake)`,`${demons} - Remake`,`${demons} (2020) (Remake)`,`${demons} (Remake) (2020)`]){const p=parseLabel(label);assert.equal(p.base,demons);assert.equal(p.edition,'remake');}
    assert.equal(parseLabel(`${demons} Remastered`).edition,'remaster');assert.equal(parseLabel(`${demons} (Original)`).edition,'original');assert.equal(parseLabel(`${zelda} (2026) PC Port`).port,true);
});
test('real sequel and title numbers stay intact; conflicting intent refuses selection',()=>{
    for(const name of ['Jazz Jackrabbit 2','FIFA 2005','Cyberpunk 2077','The Order: 1886','Silent Hill 2','Remake of a Game']) assert.equal(parseLabel(name).base,name);
    assert.equal(parseLabel(`${demons} (Remake) (Original)`).conflict,true);
    assert.equal(parseLabel(`${demons} (2020) (2009)`).conflict,true);
    assert.equal(chooseRawg(`${demons} (Remake) (Original)`,[newD]),null);
});
test('edition detection needs same-title explicit self-description, not a newer date',()=>{
    assert.equal(editionEvidence(newD,demons),'remake');assert.equal(editionEvidence(oldD,demons),null);
    for(const d of ['This is not a remake of Demon’s Souls.','Inspired by a remake of Demon’s Souls.','This is a remake of another game.','This is a remake of Demon’s Souls 2.'])assert.equal(editionEvidence(raw(1,demons,2020,d),demons),null,d);
    assert.equal(chooseRawg(`${demons} Remake`,[oldD,{...newD,description_raw:'A new adventure.'}]),null);
});
test('explicit original can be distinguished from a confirmed later remake',()=>{
    assert.equal(chooseRawg(`${demons} (Original)`,[oldD,newD]).id,'101');
    assert.equal(chooseRawg(`${demons} (Original)`,[oldD,{...newD,description_raw:''}]),null);
    assert.equal(chooseRawg(`${demons} (2020) (Original)`,[oldD,newD]),null);
});
test('actual titled Remake and Remaster are distinct from base and from each other',()=>{
    const base=raw(1,'Example Quest',1990), remake=raw(2,'Example Quest Remake',2010),remaster=raw(3,'Example Quest Remastered',2015);
    assert.equal(chooseRawg('Example Quest Remake',[base,remake,remaster]).id,'2');
    assert.equal(chooseRawg('Example Quest Remastered',[base,remake,remaster]).id,'3');
    assert.equal(chooseRawg('Example Quest',[base,remake,remaster]).id,'1');
});
test('multiple equally proven remake records remain unbound',()=>{
    assert.equal(chooseRawg(`${demons} Remake`,[oldD,newD,{...newD,id:103,released:'2021-01-01'}]),null);
    assert.equal(chooseRawg(`${demons} Remake`,[newD],false),null);
});
test('explicit PC Port prefers unique earlier catalog entry over same-year new release',()=>{
    const name=`${zelda} (2026) (PC Port)`;
    const found=chooseRawg(name,[oldZ,newZ]);assert.equal(found.id,'201');assert.equal(found.relation,'base_game');
    assert.equal(chooseRawg(name,[newZ]),null);
    assert.equal(chooseRawg(name,[oldZ,newZ,raw(203,zelda,2018)]),null);
    assert.equal(chooseRawg(`${zelda} (PC Port)`,[oldZ,newZ]),null);
    assert.equal(chooseRawg(zelda+' (2026)',[oldZ,newZ]).id,'202');
});
test('same-title edition discovery keeps exact and base queries bounded',()=>{
    const qs=queryVariants(`${demons} (Remake)`,[`${demons} (2020)`]);assert.ok(qs.includes(demons));assert.ok(qs.includes(`${demons} (Remake)`));assert.ok(qs.includes(`${demons} (2020)`));assert.ok(qs.length<=5);
});
test('Jazz Jackrabbit related subtitle and compound spacing are suggestions, not identity',()=>{
    const q=parseLabel('Jazz Jackrabbit 2');const rows=[grid(5247060,'Jazz Jackrabbit 2: The Secret Files',1999),grid(6,'Jazz Jack Rabbit 2',1998),grid(7,'Jazz Jackrabbit 2: Soundtrack',1998),grid(8,'Jazz Jackrabbit 3',2001),{...grid(9,'Jazz Jackrabbit 2',1998),types:['movie']}];
    const suggestions=relatedCandidates(q,rows);assert.equal(suggestions[0].reason,'related_subtitle');assert.equal(suggestions[1].reason,'compound_spacing');assert.ok(!suggestions.some(x=>x.id==='7'||x.id==='8'||x.id==='9'));assert.equal(chooseRawg(q.original,rows),null);
});
test('full pipeline: Demons Souls Remake hydrates both editions and resolves matching SGDB year',async()=>{
    const x=fixture();const result=await x.pipeline.collectMetadata(`${demons} Remake`,{providers:x.providers});
    assert.equal(result.metadata.name,`${demons} Remake`);assert.equal(result.metadata.releaseDate,'2020-11-12');assert.equal(result.metadata.assetSearch.metadataIdentity.edition,'remake');assert.equal(result.metadata.assetSearch.artworkIdentity.id,'5270663');
    for(const k of ['poster','background','logo','icon'])assert.ok(result.rawAssets[k].some(a=>a.url.includes('5270663')));
    assert.ok(x.calls.rawg.some(c=>c.url.endsWith('/101')));assert.equal(x.calls.rawg.filter(c=>c.url.endsWith('/102')).length,1);
    assert.ok(x.calls.grid.every(u=>!u.includes('/game/37584')));assert.deepEqual(x.calls.youtube,[]);
});
test('full pipeline: explicit Zelda PC Port uses 1998 despite real same-name 2026 entry',async()=>{
    const x=fixture({rawRows:[oldZ,newZ],gridRows:[oldZG,newZG]});const label=`${zelda} (2026) (PC Port)`;
    const result=await x.pipeline.collectMetadata(label,{providers:x.providers,steamAppId:'1234',trustedSteamAppId:true});
    assert.equal(result.metadata.name,label);assert.equal(result.metadata.releaseDate,'1998-11-12');assert.equal(result.metadata.steamAppId,null);assert.equal(result.metadata.assetSearch.artworkIdentity.id,'21202');
    assert.deepEqual(x.calls.steam,[]);assert.deepEqual(x.calls.youtube,[]);assert.ok(x.calls.grid.every(u=>!u.includes('/game/5532594')));
});
test('plain 2026 remains an explicit catalog year when no port marker is present',async()=>{
    const x=fixture({rawRows:[oldZ,newZ],gridRows:[oldZG,newZG]});const result=await x.pipeline.collectMetadata(`${zelda} (2026)`,{providers:x.providers,includeMedia:false});
    assert.equal(result.metadata.releaseDate,'2026-11-12');assert.equal(result.metadata.assetSearch.artworkIdentity.id,'5532594');
});
test('failed edition detail hydration cannot select by newest release or attach generic trailer',async()=>{
    const x=fixture({failDetail:101});const r=await x.pipeline.collectMetadata(`${demons} Remake`,{providers:x.providers});
    assert.equal(r.metadata.assetSearch.metadataIdentity,null);assert.equal(r.metadata.assetSearch.artworkIdentity,null);assert.equal(r.rawAssets.poster.length,0);assert.deepEqual(x.calls.youtube,[]);assert.ok(x.calls.grid.every(u=>!u.includes('/grids/game/')));
});
test('same-title same-year SGDB ambiguity does not pick arbitrary ID',async()=>{
    const x=fixture({gridRows:[oldDG,newDG,grid(888,demons,2020)]});const r=await x.pipeline.collectMetadata(`${demons} Remake`,{providers:x.providers});
    assert.equal(r.metadata.assetSearch.metadataIdentity.id,'102');assert.equal(r.metadata.assetSearch.artworkIdentity,null);assert.ok(x.calls.grid.every(u=>!u.includes('/grids/game/')));
});
test('explicit port without RAWG selects unique earlier verified artwork, not same-year remake',async()=>{
    const x=fixture({rawKey:'',rawRows:[oldZ,newZ],gridRows:[oldZG,newZG]});const r=await x.pipeline.collectMetadata(`${zelda} (2026) (PC Port)`,{providers:x.providers});
    assert.equal(r.metadata.assetSearch.artworkIdentity.id,'21202');assert.equal(r.metadata.assetSearch.metadataIdentity,null);assert.deepEqual(x.calls.youtube,[]);
});
test('Jazz subtitle candidates are surfaced through real pipeline diagnostics without fetching wrong artwork',async()=>{
    const name='Jazz Jackrabbit 2';const x=fixture({rawRows:[raw(500,name,1998)],gridRows:[grid(5247060,`${name}: The Secret Files`,1999)]});const r=await x.pipeline.collectMetadata(name,{providers:x.providers,includeMedia:false});
    const d=r.metadata.assetSearch.diagnostics.find(x=>x.provider==='SteamGridDB'&&Array.isArray(x.candidates));assert.ok(d.candidates.some(x=>x.id==='5247060'&&x.reason==='related_subtitle'));assert.equal(r.rawAssets.poster.length,0);assert.equal(r.metadata.assetSearch.metadataIdentity.id,'500');
});
test('no-year Demons Souls ambiguity remains pending and suppresses arbitrary video',async()=>{
    const x=fixture();const r=await x.pipeline.collectMetadata(demons,{providers:x.providers});assert.equal(r.metadata.assetSearch.artworkIdentity,null);assert.equal(r.metadata.assetSearch.metadataIdentity,null);assert.deepEqual(x.calls.youtube,[]);
    assert.ok(r.metadata.assetSearch.diagnostics.some(d=>d.candidates?.length===2));
});
test('a real Steam title ending in Remake can still resolve through verified store evidence',async()=>{
    const name='Example Quest Remake';const x=fixture({rawRows:[raw(700,name,2020)],gridRows:[],steam:{appid:'12345',name,releaseDate:'Nov 12, 2020',gridId:90001}});const r=await x.pipeline.collectMetadata(name,{providers:x.providers,includeMedia:false});
    assert.equal(r.metadata.steamAppId,'12345');assert.equal(r.metadata.assetSearch.artworkIdentity.id,'90001');assert.deepEqual(x.calls.library,['12345']);
});
test('wrong edition Steam ID never overrides corroborated remake',async()=>{
    const x=fixture({steam:{appid:'12345',name:demons,releaseDate:'Nov 12, 2009'}});const r=await x.pipeline.collectMetadata(`${demons} Remake`,{providers:x.providers,steamAppId:'12345',includeMedia:false});assert.equal(r.metadata.steamAppId,null);assert.equal(r.metadata.assetSearch.artworkIdentity.id,'5270663');assert.deepEqual(x.calls.library,[]);
});
