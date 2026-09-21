import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const app=express();
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:false});
const uploads=process.env.UPLOAD_DIR||"./uploads"; fs.mkdirSync(uploads,{recursive:true});
const upload=multer({dest:uploads,limits:{fileSize:15*1024*1024}});
app.use(cors({origin:process.env.FRONTEND_URL?.split(",")||true}));
app.use(express.json());
app.use("/uploads",express.static(path.resolve(uploads)));

await pool.query(`
CREATE TABLE IF NOT EXISTS users(
 id SERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('ADMIN','OPERACIONES','CLIENTE')),active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS warehouses(
 id SERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,address TEXT NOT NULL DEFAULT '',
 open_hour INT NOT NULL DEFAULT 8,close_hour INT NOT NULL DEFAULT 18,active BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS reservations(
 id SERIAL PRIMARY KEY,client_id INT NOT NULL REFERENCES users(id),warehouse_id INT NOT NULL REFERENCES warehouses(id),
 operation TEXT NOT NULL CHECK(operation IN ('RETIRO','ENTREGA')),reservation_date DATE NOT NULL,
 start_hour INT NOT NULL,end_hour INT NOT NULL,company TEXT NOT NULL,work_name TEXT NOT NULL,
 material_detail TEXT NOT NULL,driver_name TEXT NOT NULL,driver_rut TEXT NOT NULL,
 driver_phone TEXT NOT NULL,vehicle_plate TEXT NOT NULL,file_name TEXT,file_path TEXT,
 status TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK(status IN ('PENDIENTE','ACEPTADA','RECHAZADA','REAGENDADA','CANCELADA')),
 operations_note TEXT NOT NULL DEFAULT '',resolved_by INT REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_reservations_slot ON reservations(warehouse_id,reservation_date,start_hour,end_hour);
CREATE TABLE IF NOT EXISTS reservation_events(
 id SERIAL PRIMARY KEY,reservation_id INT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
 user_id INT REFERENCES users(id),event_type TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());`);

const adminEmail=(process.env.ADMIN_EMAIL||"admin@atpac.com").toLowerCase();
const exists=await pool.query("SELECT id FROM users WHERE email=$1",[adminEmail]);
if(!exists.rowCount){const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD||"Cambiar123!",12);await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'ADMIN')",["Administrador AT-PAC",adminEmail,hash]);}
for(const [name,address] of [["Bodega Quilicura","Santiago"],["Bodega Antofagasta","Antofagasta"],["Bodega Concepción","Concepción"]]) await pool.query("INSERT INTO warehouses(name,address) VALUES($1,$2) ON CONFLICT(name) DO NOTHING",[name,address]);

const auth=(roles=[])=>async(req,res,next)=>{try{const token=req.headers.authorization?.replace("Bearer ","");const data=jwt.verify(token,process.env.JWT_SECRET);const user=(await pool.query("SELECT id,name,email,role,active FROM users WHERE id=$1",[data.id])).rows[0];if(!user?.active||roles.length&&!roles.includes(user.role))return res.status(403).json({error:"Acceso no autorizado"});req.user=user;next();}catch{return res.status(401).json({error:"Sesión inválida"})}};

app.get("/api/health",(_,res)=>res.json({ok:true}));
app.post("/api/auth/login",async(req,res)=>{const email=String(req.body.email||"").toLowerCase().trim();const user=(await pool.query("SELECT * FROM users WHERE email=$1 AND active=true",[email])).rows[0];if(!user||!await bcrypt.compare(req.body.password||"",user.password_hash))return res.status(401).json({error:"Correo o contraseña incorrectos"});const token=jwt.sign({id:user.id},process.env.JWT_SECRET,{expiresIn:"8h"});res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role}})});

app.get("/api/users",auth(["ADMIN"]),async(_,res)=>res.json((await pool.query("SELECT id,name,email,role,active,created_at FROM users ORDER BY name")).rows));
app.post("/api/users",auth(["ADMIN"]),async(req,res)=>{try{const {name,email,password,role}=req.body;if(!["ADMIN","OPERACIONES","CLIENTE"].includes(role))return res.status(400).json({error:"Rol inválido"});const hash=await bcrypt.hash(password,12);const row=(await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active",[name,email.toLowerCase(),hash,role])).rows[0];res.status(201).json(row)}catch(e){res.status(400).json({error:e.code==="23505"?"El correo ya existe":"No fue posible crear el usuario"})}});
app.get("/api/warehouses",auth(),async(_,res)=>res.json((await pool.query("SELECT * FROM warehouses WHERE active=true ORDER BY name")).rows));
app.post("/api/warehouses",auth(["ADMIN"]),async(req,res)=>{const {name,address,openHour=8,closeHour=18}=req.body;const row=(await pool.query("INSERT INTO warehouses(name,address,open_hour,close_hour) VALUES($1,$2,$3,$4) RETURNING *",[name,address,openHour,closeHour])).rows[0];res.status(201).json(row)});

app.get("/api/availability",auth(),async(req,res)=>{const {warehouseId,date}=req.query;const wh=(await pool.query("SELECT * FROM warehouses WHERE id=$1",[warehouseId])).rows[0];if(!wh)return res.status(404).json({error:"Bodega no encontrada"});const rows=(await pool.query("SELECT start_hour,end_hour FROM reservations WHERE warehouse_id=$1 AND reservation_date=$2 AND status NOT IN ('RECHAZADA','CANCELADA')",[warehouseId,date])).rows;const slots=[];for(let hour=wh.open_hour;hour+3<=wh.close_hour;hour++)slots.push({hour,available:!rows.some(r=>hour<r.end_hour&&hour+3>r.start_hour)});res.json(slots)});
app.get("/api/reservations",auth(),async(req,res)=>{const where=req.user.role==="CLIENTE"?"WHERE r.client_id=$1":"";const values=req.user.role==="CLIENTE"?[req.user.id]:[];const sql=`SELECT r.*,w.name warehouse_name,u.name client_name FROM reservations r JOIN warehouses w ON w.id=r.warehouse_id JOIN users u ON u.id=r.client_id ${where} ORDER BY r.reservation_date DESC,r.start_hour`;res.json((await pool.query(sql,values)).rows)});
app.post("/api/reservations",auth(["CLIENTE"]),upload.single("file"),async(req,res)=>{const c=await pool.connect();try{await c.query("BEGIN");const {warehouseId,date,startHour,operation,company,workName,materialDetail,driverName,driverRut,driverPhone,vehiclePlate}=req.body;const start=Number(startHour),end=start+3;const wh=(await c.query("SELECT * FROM warehouses WHERE id=$1 AND active=true",[warehouseId])).rows[0];if(!wh||start<wh.open_hour||end>wh.close_hour)throw new Error("Horario fuera de jornada");const clash=await c.query("SELECT id FROM reservations WHERE warehouse_id=$1 AND reservation_date=$2 AND status NOT IN ('RECHAZADA','CANCELADA') AND $3<end_hour AND $4>start_hour FOR UPDATE",[warehouseId,date,start,end]);if(clash.rowCount)throw new Error("El horario ya no está disponible");const row=(await c.query(`INSERT INTO reservations(client_id,warehouse_id,operation,reservation_date,start_hour,end_hour,company,work_name,material_detail,driver_name,driver_rut,driver_phone,vehicle_plate,file_name,file_path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[req.user.id,warehouseId,operation,date,start,end,company,workName,materialDetail,driverName,driverRut,driverPhone,vehiclePlate,req.file?.originalname||null,req.file?.filename||null])).rows[0];await c.query("INSERT INTO reservation_events(reservation_id,user_id,event_type,detail) VALUES($1,$2,'CREADA','Solicitud enviada a Operaciones')",[row.id,req.user.id]);await c.query("COMMIT");res.status(201).json(row)}catch(e){await c.query("ROLLBACK");if(req.file)fs.unlink(req.file.path,()=>{});res.status(409).json({error:e.message})}finally{c.release()}});
app.patch("/api/reservations/:id/resolve",auth(["OPERACIONES","ADMIN"]),async(req,res)=>{const {status,note,startHour}=req.body;if(!["ACEPTADA","RECHAZADA","REAGENDADA"].includes(status))return res.status(400).json({error:"Estado inválido"});const current=(await pool.query("SELECT * FROM reservations WHERE id=$1",[req.params.id])).rows[0];if(!current)return res.status(404).json({error:"Solicitud no encontrada"});const start=status==="REAGENDADA"?Number(startHour):current.start_hour,end=start+3;if(status==="REAGENDADA"){const clash=await pool.query("SELECT id FROM reservations WHERE id<>$1 AND warehouse_id=$2 AND reservation_date=$3 AND status NOT IN ('RECHAZADA','CANCELADA') AND $4<end_hour AND $5>start_hour",[current.id,current.warehouse_id,current.reservation_date,start,end]);if(clash.rowCount)return res.status(409).json({error:"El nuevo horario se cruza con otra reserva"})}const row=(await pool.query("UPDATE reservations SET status=$1,operations_note=$2,start_hour=$3,end_hour=$4,resolved_by=$5,updated_at=now() WHERE id=$6 RETURNING *",[status,note||"",start,end,req.user.id,current.id])).rows[0];await pool.query("INSERT INTO reservation_events(reservation_id,user_id,event_type,detail) VALUES($1,$2,$3,$4)",[current.id,req.user.id,status,note||""]);res.json(row)});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Error interno del servidor"})});
app.listen(process.env.PORT||3001,()=>console.log("AT-PAC API operativa"));

