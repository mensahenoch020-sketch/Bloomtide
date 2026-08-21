const express=require('express');
const session=require('express-session');
const pgSession=require('connect-pg-simple')(session);
const {Pool}=require('pg');
const bcrypt=require('bcryptjs');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const path=require('path');

if(!process.env.DATABASE_URL){throw new Error('DATABASE_URL is required');}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false});
const app=express();
const PORT=process.env.PORT||3000;
const SESSION_SECRET=process.env.SESSION_SECRET||'change-me-in-railway';

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));
app.use('/api/',rateLimit({windowMs:15*60*1000,limit:250}));
app.use(session({
  store:new pgSession({pool,tableName:'user_sessions',createTableIfMissing:true}),
  secret:SESSION_SECRET,
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}
}));

async function initDb(){
  await pool.query(`
    create table if not exists admins(
      id bigserial primary key,
      email text unique not null,
      password_hash text not null,
      created_at timestamptz default now()
    );
    create table if not exists appraisal_requests(
      id bigserial primary key,
      name text not null,
      email text not null,
      phone text not null,
      property_address text not null,
      property_type text,
      purpose text,
      preferred_inspection_date date,
      message text,
      fee numeric(12,2),
      status text not null default 'new',
      created_at timestamptz default now()
    );
    create table if not exists jobs(
      id bigserial primary key,
      title text not null,
      location text,
      department text,
      employment_type text,
      salary_range text,
      description text not null,
      requirements text,
      closing_date date,
      published boolean not null default false,
      created_at timestamptz default now()
    );
    create table if not exists job_applications(
      id bigserial primary key,
      job_id bigint references jobs(id) on delete cascade,
      name text not null,
      email text not null,
      phone text,
      linkedin_url text,
      cover_letter text,
      status text not null default 'new',
      created_at timestamptz default now()
    );
    create table if not exists licenses(
      id bigserial primary key,
      state text not null,
      license_type text,
      license_number text,
      expires_on date,
      active boolean not null default true,
      created_at timestamptz default now()
    );
  `);
  if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD){
    const existing=await pool.query('select id from admins where lower(email)=lower($1)',[process.env.ADMIN_EMAIL]);
    if(!existing.rowCount){
      const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12);
      await pool.query('insert into admins(email,password_hash) values($1,$2)',[process.env.ADMIN_EMAIL,hash]);
      console.log('Initial Bloomtide admin created');
    }
  }
}

function requireAdmin(req,res,next){if(req.session?.adminId)return next();res.status(401).json({error:'Unauthorized'});}
const safe=(v,max=5000)=>typeof v==='string'?v.trim().slice(0,max):v;

app.get('/api/health',async(req,res)=>{try{await pool.query('select 1');res.json({ok:true});}catch(e){res.status(500).json({ok:false});}});
app.post('/api/appraisals',async(req,res)=>{
  const {name,email,phone,property_address,property_type,purpose,preferred_inspection_date,message}=req.body;
  if(!name||!email||!phone||!property_address)return res.status(400).json({error:'Required fields are missing'});
  const q=`insert into appraisal_requests(name,email,phone,property_address,property_type,purpose,preferred_inspection_date,message) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,status`;
  const r=await pool.query(q,[safe(name,150),safe(email,200),safe(phone,80),safe(property_address,400),safe(property_type,120),safe(purpose,200),preferred_inspection_date||null,safe(message)]);
  res.status(201).json(r.rows[0]);
});
app.get('/api/jobs',async(req,res)=>{const r=await pool.query(`select id,title,location,department,employment_type,salary_range,description,requirements,closing_date,created_at from jobs where published=true and (closing_date is null or closing_date>=current_date) order by created_at desc`);res.json(r.rows);});
app.post('/api/applications',async(req,res)=>{
  const {job_id,name,email,phone,linkedin_url,cover_letter}=req.body;
  if(!job_id||!name||!email)return res.status(400).json({error:'Job, name and email are required'});
  const r=await pool.query(`insert into job_applications(job_id,name,email,phone,linkedin_url,cover_letter) values($1,$2,$3,$4,$5,$6) returning id,status`,[job_id,safe(name,150),safe(email,200),safe(phone,80),safe(linkedin_url,500),safe(cover_letter,10000)]);
  res.status(201).json(r.rows[0]);
});
app.post('/api/admin/login',async(req,res)=>{const {email,password}=req.body;const r=await pool.query('select * from admins where lower(email)=lower($1)',[email||'']);if(!r.rowCount||!(await bcrypt.compare(password||'',r.rows[0].password_hash)))return res.status(401).json({error:'Invalid email or password'});req.session.adminId=r.rows[0].id;req.session.adminEmail=r.rows[0].email;res.json({ok:true,email:r.rows[0].email});});
app.post('/api/admin/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/session',(req,res)=>res.json({authenticated:!!req.session?.adminId,email:req.session?.adminEmail||null}));
app.get('/api/admin/appraisals',requireAdmin,async(req,res)=>{const r=await pool.query('select * from appraisal_requests order by created_at desc');res.json(r.rows);});
app.patch('/api/admin/appraisals/:id',requireAdmin,async(req,res)=>{const {status,fee}=req.body;await pool.query('update appraisal_requests set status=$1,fee=$2 where id=$3',[safe(status,80),fee===''||fee==null?null:Number(fee),req.params.id]);res.json({ok:true});});
app.get('/api/admin/jobs',requireAdmin,async(req,res)=>{const r=await pool.query('select * from jobs order by created_at desc');res.json(r.rows);});
app.post('/api/admin/jobs',requireAdmin,async(req,res)=>{const d=req.body;const r=await pool.query(`insert into jobs(title,location,department,employment_type,salary_range,description,requirements,closing_date,published) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[safe(d.title,200),safe(d.location,200),safe(d.department,150),safe(d.employment_type,100),safe(d.salary_range,150),safe(d.description,10000),safe(d.requirements,10000),d.closing_date||null,!!d.published]);res.status(201).json(r.rows[0]);});
app.patch('/api/admin/jobs/:id',requireAdmin,async(req,res)=>{if(typeof req.body.published==='boolean'){await pool.query('update jobs set published=$1 where id=$2',[req.body.published,req.params.id]);}res.json({ok:true});});
app.get('/api/admin/applications',requireAdmin,async(req,res)=>{const r=await pool.query(`select a.*,j.title as job_title from job_applications a left join jobs j on j.id=a.job_id order by a.created_at desc`);res.json(r.rows);});
app.get('/api/admin/licenses',requireAdmin,async(req,res)=>{const r=await pool.query('select * from licenses order by state');res.json(r.rows);});
app.post('/api/admin/licenses',requireAdmin,async(req,res)=>{const d=req.body;const r=await pool.query(`insert into licenses(state,license_type,license_number,expires_on,active) values($1,$2,$3,$4,$5) returning *`,[safe(d.state,80),safe(d.license_type,200),safe(d.license_number,200),d.expires_on||null,d.active!==false]);res.status(201).json(r.rows[0]);});

app.use(express.static(path.join(__dirname)));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));

initDb().then(()=>app.listen(PORT,()=>console.log(`Bloomtide listening on ${PORT}`))).catch(err=>{console.error(err);process.exit(1);});
