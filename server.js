import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import pdfParse from 'pdf-parse';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 8787);
const HARTI_DAILY_URL = process.env.HARTI_DAILY_URL || 'https://www.harti.gov.lk/daily-price.php';
const db = new Database('waga_maga_prices.db');

db.exec(`
CREATE TABLE IF NOT EXISTS prices (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 crop TEXT NOT NULL,
 crop_si TEXT,
 market TEXT NOT NULL,
 price REAL NOT NULL,
 unit TEXT DEFAULT 'kg',
 price_type TEXT DEFAULT 'wholesale',
 price_date TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'HARTI',
 source_url TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(crop, market, price_date, price, unit)
);
CREATE INDEX IF NOT EXISTS idx_prices_crop_date ON prices(crop, price_date);
CREATE INDEX IF NOT EXISTS idx_prices_market_date ON prices(market, price_date);
`);

const MARKETS = ['Pettah','Kandy','Dambulla','Meegoda','Norochcholai','Thabuthegama','Nuwara Eliya','Kappetipola'];

app.get('/api/health', (req,res)=>res.json({ok:true, service:'Waga Maga HARTI Backend', source:HARTI_DAILY_URL}));
app.get('/api/markets', (req,res)=>res.json({source:'HARTI', markets:MARKETS}));

app.get('/api/prices', (req,res)=>{
  const {crop, market, from, to, limit='500'} = req.query;
  let sql = 'SELECT crop,crop_si,market,price,unit,price_type,price_date,source,source_url FROM prices WHERE 1=1';
  const params=[];
  if(crop){sql+=' AND (lower(crop)=lower(?) OR lower(crop_si)=lower(?))'; params.push(crop,crop);}
  if(market){sql+=' AND lower(market)=lower(?)'; params.push(market);}
  if(from){sql+=' AND price_date>=?'; params.push(from);}
  if(to){sql+=' AND price_date<=?'; params.push(to);}
  sql+=' ORDER BY price_date DESC, market ASC LIMIT ?'; params.push(Math.min(Number(limit)||500,5000));
  res.json({source:'HARTI',count:db.prepare(sql).all(...params).length,data:db.prepare(sql).all(...params)});
});

function parseMoney(s){
  const n=String(s).replace(/,/g,'').match(/\d+(?:\.\d+)?/g);
  return n ? Number(n[n.length-1]) : null;
}

function parsePdfText(text, date, sourceUrl){
  // Conservative parser: only emits rows that contain a known HARTI market and a numeric price.
  // The exact PDF table layout must be confirmed before enabling broad automatic extraction.
  const rows=[];
  const lines=text.split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  for(const line of lines){
    const market=MARKETS.find(m=>line.toLowerCase().includes(m.toLowerCase()));
    if(!market) continue;
    const nums=line.match(/(?:Rs\.?\s*)?\d{2,6}(?:\.\d+)?/g);
    if(!nums?.length) continue;
    const price=parseMoney(nums[nums.length-1]);
    if(!price || price<1 || price>1000000) continue;
    const idx=line.toLowerCase().indexOf(market.toLowerCase());
    const crop=line.slice(0,idx).replace(/[^\p{L}\p{N} .()\-/]/gu,' ').trim();
    if(!crop || crop.length<2 || crop.length>120) continue;
    rows.push({crop,market,price,unit:'kg',price_type:'wholesale',price_date:date,source:'HARTI',source_url:sourceUrl});
  }
  return rows;
}

async function discoverDailyLinks(){
  const r=await fetch(HARTI_DAILY_URL,{headers:{'User-Agent':'WagaMaga-HARTI-Backend/1.0'}});
  if(!r.ok) throw new Error(`HARTI page HTTP ${r.status}`);
  const html=await r.text();
  const $=cheerio.load(html); const links=[];
  $('a').each((_,a)=>{
    const href=$(a).attr('href'); const txt=$(a).text().trim();
    const date=(txt.match(/\d{4}-\d{2}-\d{2}/)||[])[0];
    if(href && date) links.push({date,url:new URL(href,HARTI_DAILY_URL).href});
  });
  return links;
}

async function syncLatest(){
  const links=await discoverDailyLinks();
  if(!links.length) throw new Error('No HARTI daily bulletin links found. HARTI page structure may have changed or access is blocked.');
  const latest=links.sort((a,b)=>b.date.localeCompare(a.date))[0];
  const r=await fetch(latest.url,{headers:{'User-Agent':'WagaMaga-HARTI-Backend/1.0'}});
  if(!r.ok) throw new Error(`HARTI bulletin HTTP ${r.status}`);
  const buf=Buffer.from(await r.arrayBuffer());
  const pdf=await pdfParse(buf);
  const rows=parsePdfText(pdf.text,latest.date,latest.url);
  const insert=db.prepare(`INSERT OR IGNORE INTO prices(crop,crop_si,market,price,unit,price_type,price_date,source,source_url) VALUES(?,?,?,?,?,?,?,?,?)`);
  const tx=db.transaction(items=>{for(const x of items) insert.run(x.crop,null,x.market,x.price,x.unit,x.price_type,x.price_date,x.source,x.source_url);});
  tx(rows);
  return {bulletin:latest,extracted:rows.length};
}

app.post('/api/sync',async(req,res)=>{
  try { const result=await syncLatest(); res.json({ok:true,...result}); }
  catch(e){ res.status(502).json({ok:false,error:e.message,source:HARTI_DAILY_URL}); }
});

app.listen(PORT,()=>console.log(`Waga Maga HARTI Backend running on http://localhost:${PORT}`));
