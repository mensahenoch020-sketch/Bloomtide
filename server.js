const express=require('express');
const session=require('express-session');
const {Pool}=require('pg');
const bcrypt=require('bcryptjs');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const path=require('path');

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false});
const app=express();
const PORT=process.env.PORT||3000;
const SESSION_SECRET=process.env.SESSION_SECRET||'development-only-secret';
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));
app.use('/api/',rateLimit({windowMs:15*60*1000,limit:300}));
app.use(session({secret:SESSION_SECRET,resave:false,saveUninitialized:false,proxy:true,cookie:{httpOnly:true,sameSite:'lax',secure:false,maxAge:8*60*60*1000}}));

function calculateFee(propertyType='',purpose=''){
  const base={
    'Single-family home':450,
    'Condominium':400,
    'Townhome':425,
    'Multifamily':700,
    'Commercial':950,
    'Land / vacant property':500,
    'Other':550
  }[propertyType]||0;
  const purposeAdd={
    'Purchase / sale':0,
    'Estate / probate':100,
    'Divorce / legal':150,
    'Investment analysis':100,
    'Tax / assessment review':75,
    'Retrospective valuation':200,
    'Other':100
  }[purpose]||0;
  return base?base+purposeAdd:0;
}

async function initDb(){
  await pool.query(`
    create table if not exists admins(id bigserial primary key,email text unique not null,password_hash text not null,created_at timestamptz default now());
    create table if not exists appraisal_requests(id bigserial primary key,name text not null,email text not null,phone text not null,property_address text not null,property_type text,purpose text,preferred_inspection_date date,message text,estimated_fee numeric(12,2),fee numeric(12,2),status text not null default 'new',created_at timestamptz default now());
    alter table appraisal_requests add column if not exists estimated_fee numeric(12,2);
    create table if not exists jobs(id bigserial primary key,title text not null,location text,department text,employment_type text,salary_range text,description text not null,requirements text,closing_date date,published boolean not null default false,created_at timestamptz default now());
    create table if not exists job_applications(id bigserial primary key,job_id bigint references jobs(id) on delete cascade,name text not null,email text not null,phone text,linkedin_url text,resume_url text,cover_letter text,status text not null default 'new',created_at timestamptz default now());
    alter table job_applications add column if not exists resume_url text;
    create table if not exists licenses(id bigserial primary key,state text not null,license_type text,license_number text,expires_on date,active boolean not null default true,created_at timestamptz default now());
  `);
  if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD){
    const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12);
    await pool.query(`insert into admins(email,password_hash) values($1,$2) on conflict(email) do update set password_hash=excluded.password_hash`,[process.env.ADMIN_EMAIL.toLowerCase().trim(),hash]);
  }
  const job={title:'Customer Service Representative',location:'Remote · United States',department:'Client Services',employment_type:'Full-time',salary_range:'',description:'Bloomtide is seeking a professional and dependable Customer Service Representative to support clients throughout the appraisal process. This role responds to inquiries, helps clients provide property information, coordinates communication around inspections and appraisal requests, shares status updates, and ensures each interaction reflects Bloomtide’s standard of clarity and professionalism.',requirements:'Strong written and verbal communication skills\nProfessional and courteous client service\nComfort working with phone, email and web-based systems\nStrong organization and attention to detail\nAbility to manage multiple client requests responsibly\nReal estate, appraisal, mortgage or related customer-service experience is helpful but not required'};
  const existing=await pool.query(`select id from jobs where lower(title)=lower($1) order by id asc limit 1`,[job.title]);
  if(existing.rowCount) await pool.query(`update jobs set location=$1,department=$2,employment_type=$3,salary_range=$4,description=$5,requirements=$6,published=true,closing_date=null where id=$7`,[job.location,job.department,job.employment_type,job.salary_range,job.description,job.requirements,existing.rows[0].id]);
  else await pool.query(`insert into jobs(title,location,department,employment_type,salary_range,description,requirements,published) values($1,$2,$3,$4,$5,$6,$7,true)`,[job.title,job.location,job.department,job.employment_type,job.salary_range,job.description,job.requirements]);
}

function requireAdmin(req,res,next){if(req.session?.adminId)return next();res.status(401).json({error:'Admin session expired. Please sign in again.'});}
const safe=(v,max=5000)=>typeof v==='string'?v.trim().slice(0,max):v;
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const allowedStatuses=new Set(['new','contacted','inspection_scheduled','in_progress','report_ready','completed']);
app.use('/admin.html',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.use('/app.js',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.get('/api/health',asyncRoute(async(req,res)=>{await pool.query('select 1');res.json({ok:true});}));
app.get('/api/address-suggestions',asyncRoute(async(req,res)=>{const q=safe(req.query.q||'',180);if(q.length<3)return res.json([]);const url=new URL('https://nominatim.openstreetmap.org/search');url.searchParams.set('q',q);url.searchParams.set('format','jsonv2');url.searchParams.set('addressdetails','1');url.searchParams.set('countrycodes','us');url.searchParams.set('limit','5');const r=await fetch(url,{headers:{'User-Agent':'Bloomtide/1.0 (charlierob1225@gmail.com)','Accept-Language':'en-US,en'}});if(!r.ok)return res.json([]);const data=await r.json();res.json(data.map(x=>({label:x.display_name,value:x.display_name})).slice(0,5));}));
app.get('/api/fee-estimate',(req,res)=>{const propertyType=safe(req.query.property_type||'',120);const purpose=safe(req.query.purpose||'',200);const estimatedFee=calculateFee(propertyType,purpose);res.json({estimated_fee:estimatedFee||null,currency:'USD',note:'Preliminary estimate. Bloomtide may confirm or adjust the final fee after reviewing the assignment.'});});
app.post('/api/appraisals',asyncRoute(async(req,res)=>{const {name,email,phone,property_address,property_type,purpose,preferred_inspection_date,message}=req.body;if(!name||!email||!phone||!property_address||!property_type||!purpose)return res.status(400).json({error:'Please complete all required fields.'});const estimatedFee=calculateFee(property_type,purpose)||null;const r=await pool.query(`insert into appraisal_requests(name,email,phone,property_address,property_type,purpose,preferred_inspection_date,message,estimated_fee,fee) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) returning id,status,estimated_fee,fee`,[safe(name,150),safe(email,200),safe(phone,80),safe(property_address,400),safe(property_type,120),safe(purpose,200),preferred_inspection_date||null,safe(message),estimatedFee]);res.status(201).json(r.rows[0]);}));
app.get('/api/jobs',asyncRoute(async(req,res)=>{const r=await pool.query(`select id,title,location,department,employment_type,salary_range,description,requirements,closing_date,created_at from jobs where published=true and (closing_date is null or closing_date>=current_date) order by created_at desc`);res.json(r.rows);}));
app.post('/api/applications',asyncRoute(async(req,res)=>{const {job_id,name,email,phone,linkedin_url,resume_url,cover_letter}=req.body;if(!job_id||!name||!email)return res.status(400).json({error:'Job, name and email are required.'});const r=await pool.query(`insert into job_applications(job_id,name,email,phone,linkedin_url,resume_url,cover_letter) values($1,$2,$3,$4,$5,$6,$7) returning id,status`,[job_id,safe(name,150),safe(email,200),safe(phone,80),safe(linkedin_url,500),safe(resume_url,1000),safe(cover_letter,10000)]);res.status(201).json(r.rows[0]);}));
app.post('/api/admin/login',asyncRoute(async(req,res)=>{const email=safe(req.body.email||'',200).toLowerCase();const password=String(req.body.password||'');const r=await pool.query('select * from admins where lower(email)=lower($1)',[email]);if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'Invalid admin email or password.'});req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Could not start admin session.'});req.session.adminId=r.rows[0].id;req.session.adminEmail=r.rows[0].email;req.session.save(saveErr=>saveErr?res.status(500).json({error:'Could not save admin session.'}):res.json({ok:true,email:r.rows[0].email}));});}));
app.post('/api/admin/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/session',(req,res)=>{res.set('Cache-Control','no-store');res.json({authenticated:!!req.session?.adminId,email:req.session?.adminEmail||null});});
app.get('/api/admin/appraisals',requireAdmin,asyncRoute(async(req,res)=>{const r=await pool.query('select * from appraisal_requests order by created_at desc');res.json(r.rows);}));
app.patch('/api/admin/appraisals/:id',requireAdmin,asyncRoute(async(req,res)=>{const status=safe(req.body.status||'',80);const rawFee=req.body.fee;const fee=rawFee===''||rawFee==null?null:Number(rawFee);if(!allowedStatuses.has(status))return res.status(400).json({error:'Invalid appraisal status.'});if(fee!==null&&(!Number.isFinite(fee)||fee<0))return res.status(400).json({error:'Enter a valid fee.'});const r=await pool.query('update appraisal_requests set status=$1,fee=$2 where id=$3 returning id,status,fee,estimated_fee',[status,fee,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Appraisal request not found.'});res.json(r.rows[0]);}));
app.get('/api/admin/jobs',requireAdmin,asyncRoute(async(req,res)=>{const r=await pool.query('select * from jobs order by created_at desc');res.json(r.rows);}));
app.post('/api/admin/jobs',requireAdmin,asyncRoute(async(req,res)=>{const d=req.body;const r=await pool.query(`insert into jobs(title,location,department,employment_type,salary_range,description,requirements,closing_date,published) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[safe(d.title,200),safe(d.location,200),safe(d.department,150),safe(d.employment_type,100),safe(d.salary_range,150),safe(d.description,10000),safe(d.requirements,10000),d.closing_date||null,!!d.published]);res.status(201).json(r.rows[0]);}));
app.patch('/api/admin/jobs/:id',requireAdmin,asyncRoute(async(req,res)=>{if(typeof req.body.published==='boolean')await pool.query('update jobs set published=$1 where id=$2',[req.body.published,req.params.id]);res.json({ok:true});}));
app.get('/api/admin/applications',requireAdmin,asyncRoute(async(req,res)=>{const r=await pool.query(`select a.*,j.title as job_title from job_applications a left join jobs j on j.id=a.job_id order by a.created_at desc`);res.json(r.rows);}));
app.get('/api/admin/licenses',requireAdmin,asyncRoute(async(req,res)=>{const r=await pool.query('select * from licenses order by state');res.json(r.rows);}));
app.post('/api/admin/licenses',requireAdmin,asyncRoute(async(req,res)=>{const d=req.body;const r=await pool.query(`insert into licenses(state,license_type,license_number,expires_on,active) values($1,$2,$3,$4,$5) returning *`,[safe(d.state,80),safe(d.license_type,200),safe(d.license_number,200),d.expires_on||null,d.active!==false]);res.status(201).json(r.rows[0]);}));

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'home.html')));
app.use(express.static(path.join(__dirname),{extensions:['html'],maxAge:0,etag:true,index:false}));
app.use((err,req,res,next)=>{console.error(err);if(req.path.startsWith('/api/'))return res.status(500).json({error:'Something went wrong. Please try again.'});res.status(500).send('Something went wrong.');});
initDb().then(()=>app.listen(PORT,()=>console.log(`Bloomtide listening on ${PORT}`))).catch(err=>{console.error(err);process.exit(1);});