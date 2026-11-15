use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use hmac::{Hmac, Mac};
use rusqlite::{params, types::ValueRef, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use sha2::Sha256;
use std::{
    env,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::net::TcpListener;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;
#[derive(Clone)]
struct AppState {
    database: PathBuf,
    session_secret: String,
    cron_secret: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::dotenv();
    let database =
        PathBuf::from(env::var("DATABASE_PATH").unwrap_or_else(|_| "./elderly_care.db".into()));
    let session_secret = match env::var("SESSION_SECRET") {
        Ok(secret) if !secret.trim().is_empty() => secret,
        _ if env::var("NODE_ENV").as_deref() == Ok("production") => {
            return Err("SESSION_SECRET must be configured in production".into())
        }
        _ => "careconnect-local-development-secret-not-for-production".into(),
    };
    let cron_secret = env::var("CRON_SECRET").unwrap_or_default();
    let state = AppState {
        database,
        session_secret,
        cron_secret,
    };
    let conn = connect(&state)?;
    init_db(&conn)?;
    drop(conn);
    let app = Router::new()
        .route("/api/{*path}", any(dispatch))
        .with_state(state);
    let port = env::var("RUST_BACKEND_PORT").unwrap_or_else(|_| "4000".into());
    let host = env::var("RUST_BACKEND_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let listener = TcpListener::bind(format!("{host}:{port}")).await?;
    println!("CareConnect Rust API listening on http://{host}:{port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

fn connect(state: &AppState) -> rusqlite::Result<Connection> {
    let path = state.database.clone();
    let connection = Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
    )?;
    Ok(connection)
}

fn init_db(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(r#"
      CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY,name TEXT NOT NULL,dob TEXT,blood_group TEXT,passcode TEXT NOT NULL,email TEXT,phone TEXT,address TEXT,emergency_contact_name TEXT,emergency_contact_phone TEXT,emergency_contact_relation TEXT,allergies TEXT,medical_conditions TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS authorized_users(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'family',created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS medications(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL,name TEXT NOT NULL,dosage TEXT NOT NULL,dosage_unit TEXT DEFAULT 'mg',frequency TEXT NOT NULL,times TEXT NOT NULL,with_food INTEGER DEFAULT 0,start_date TEXT NOT NULL,end_date TEXT,notes TEXT,color TEXT DEFAULT '#14b8a6',active INTEGER DEFAULT 1,created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS dose_logs(id TEXT PRIMARY KEY,medication_id TEXT NOT NULL,patient_id TEXT NOT NULL,scheduled_time DATETIME NOT NULL,taken_at DATETIME,status TEXT DEFAULT 'pending',notes TEXT,reminder_sent INTEGER DEFAULT 0,missed_reminder_sent INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL,doctor_name TEXT NOT NULL,specialty TEXT,appointment_datetime DATETIME NOT NULL,location TEXT,notes TEXT,status TEXT DEFAULT 'scheduled',reminder_24h_sent INTEGER DEFAULT 0,reminder_1h_sent INTEGER DEFAULT 0,created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS vitals(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL,type TEXT NOT NULL,value REAL NOT NULL,unit TEXT NOT NULL,notes TEXT,recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS journal_entries(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL,mood INTEGER NOT NULL,energy_level INTEGER,symptoms TEXT,notes TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS caretaker_notes(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL,author_name TEXT NOT NULL,content TEXT NOT NULL,is_important INTEGER DEFAULT 0,created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    "#)
    ?;
    let has_missed_flag: Option<i64> = db
        .query_row(
            "SELECT 1 FROM pragma_table_info('dose_logs') WHERE name='missed_reminder_sent'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if has_missed_flag.is_none() {
        db.execute(
            "ALTER TABLE dose_logs ADD COLUMN missed_reminder_sent INTEGER DEFAULT 0",
            [],
        )?;
        db.execute(
            "UPDATE dose_logs SET missed_reminder_sent=reminder_sent WHERE status='missed'",
            [],
        )?;
    }
    db.execute("DELETE FROM dose_logs WHERE rowid NOT IN (SELECT MIN(rowid) FROM dose_logs GROUP BY medication_id,scheduled_time)",[])?;
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_dose_medication_schedule ON dose_logs(medication_id,scheduled_time)",[])?;
    db.execute_batch("CREATE INDEX IF NOT EXISTS idx_medications_patient_active ON medications(patient_id,active); CREATE INDEX IF NOT EXISTS idx_doses_patient_schedule ON dose_logs(patient_id,scheduled_time); CREATE INDEX IF NOT EXISTS idx_appointments_patient_time ON appointments(patient_id,appointment_datetime); CREATE INDEX IF NOT EXISTS idx_vitals_patient_recorded ON vitals(patient_id,recorded_at);")?;
    Ok(())
}

fn response(status: StatusCode, value: Value) -> Response {
    (status, Json(value)).into_response()
}
fn ok(value: Value) -> Response {
    response(StatusCode::OK, value)
}
fn fail(status: StatusCode, message: &str) -> Response {
    response(status, json!({"error":message}))
}
fn db_error(error: impl std::fmt::Display) -> Response {
    eprintln!("[CareConnect Rust API] {error}");
    fail(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Database operation failed",
    )
}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}
fn query_value(uri: &Uri, key: &str) -> String {
    uri.query()
        .unwrap_or("")
        .split('&')
        .filter_map(|p| p.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.to_string())
        .unwrap_or_default()
}
fn nullable_text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    let value = text(value, key).trim();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
fn patient_id() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let bytes = *Uuid::new_v4().as_bytes();
    bytes[..8]
        .iter()
        .map(|byte| ALPHABET[(byte & 31) as usize] as char)
        .collect()
}
fn valid_date(value: &str) -> bool {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}
fn valid_time(value: &str) -> bool {
    NaiveTime::parse_from_str(value, "%H:%M").is_ok()
}
fn normalized_datetime(value: &str) -> Option<String> {
    if let Ok(datetime) = DateTime::parse_from_rfc3339(value) {
        return Some(datetime.with_timezone(&Utc).to_rfc3339());
    }
    let naive = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").ok()?;
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|datetime| datetime.with_timezone(&Utc).to_rfc3339())
}
fn session_id(headers: &HeaderMap, secret: &str) -> Option<String> {
    let raw = headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|c| c.trim().strip_prefix("careconnect_session="))?;
    let (payload, signature) = raw.split_once('.')?;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());
    mac.verify_slice(&URL_SAFE_NO_PAD.decode(signature).ok()?)
        .ok()?;
    let claims: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    if claims["exp"].as_u64()? <= now() {
        return None;
    }
    claims["sub"].as_str().map(str::to_owned)
}
fn sign_session(patient_id: &str, secret: &str) -> String {
    let payload = URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&json!({"sub":patient_id,"exp":now()+604800})).unwrap());
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(payload.as_bytes());
    format!(
        "{}.{}",
        payload,
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    )
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn login_cookie(token: &str) -> String {
    format!(
        "careconnect_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800{}",
        if env::var("NODE_ENV").as_deref() == Ok("production") {
            "; Secure"
        } else {
            ""
        }
    )
}
fn rows(db: &Connection, sql: &str, patient: &str) -> rusqlite::Result<Vec<Value>> {
    let mut statement = db.prepare(sql)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mapped = statement.query_map([patient], |row| row_value(row, &names))?;
    mapped.collect()
}
fn rows_filtered(
    db: &Connection,
    sql: &str,
    patient: &str,
    filter: Option<&str>,
    limit: i64,
) -> rusqlite::Result<Vec<Value>> {
    let mut statement = db.prepare(sql)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect();
    if let Some(filter) = filter {
        let mapped = statement.query_map(params![patient, filter, limit], |row| {
            row_value(row, &names)
        })?;
        mapped.collect()
    } else {
        let mapped = statement.query_map(params![patient, limit], |row| row_value(row, &names))?;
        mapped.collect()
    }
}
fn row_value(row: &rusqlite::Row<'_>, names: &[String]) -> rusqlite::Result<Value> {
    let mut object = Map::new();
    for (index, name) in names.iter().enumerate() {
        let value = match row.get_ref(index)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(v) => json!(v),
            ValueRef::Real(v) => json!(v),
            ValueRef::Text(v) => json!(String::from_utf8_lossy(v).to_string()),
            ValueRef::Blob(v) => json!(URL_SAFE_NO_PAD.encode(v)),
        };
        object.insert(name.clone(), value);
    }
    Ok(Value::Object(object))
}
fn create_dose_schedule(
    db: &Connection,
    medication: &str,
    patient: &str,
    start: &str,
    end: Option<&str>,
    frequency: &str,
    times: &Value,
) -> rusqlite::Result<()> {
    if frequency == "As needed" {
        return Ok(());
    }
    let start =
        NaiveDate::parse_from_str(start, "%Y-%m-%d").unwrap_or_else(|_| Utc::now().date_naive());
    let end = end.and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
    let today = Local::now().date_naive();
    let first = if start > today { start } else { today };
    let times = times.as_array().cloned().unwrap_or_default();
    for offset in 0..30 {
        let day = first + Duration::days(offset);
        if end.is_some_and(|e| day > e) {
            break;
        }
        if frequency == "Weekly" && (day - start).num_days() % 7 != 0 {
            continue;
        }
        for time in &times {
            let Some(value) = time.as_str() else { continue };
            let Ok(t) = NaiveTime::parse_from_str(value, "%H:%M") else {
                continue;
            };
            let Some(stamp) = Local
                .from_local_datetime(&day.and_time(t))
                .earliest()
                .map(|datetime| datetime.with_timezone(&Utc).to_rfc3339())
            else {
                continue;
            };
            db.execute("INSERT OR IGNORE INTO dose_logs(id,medication_id,patient_id,scheduled_time,status) VALUES(?1,?2,?3,?4,'pending')",params![Uuid::new_v4().to_string(),medication,patient,stamp])?;
        }
    }
    Ok(())
}
fn ensure_dose_schedule(db: &Connection, patient: &str) -> rusqlite::Result<()> {
    let medications = rows(db, "SELECT id,start_date,end_date,frequency,times FROM medications WHERE patient_id=?1 AND active=1", patient)?;
    for medication in medications {
        let Some(id) = medication.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(start) = medication.get("start_date").and_then(Value::as_str) else {
            continue;
        };
        let Some(frequency) = medication.get("frequency").and_then(Value::as_str) else {
            continue;
        };
        let times = medication
            .get("times")
            .and_then(Value::as_str)
            .and_then(|value| serde_json::from_str::<Value>(value).ok())
            .unwrap_or_else(|| json!([]));
        let end = medication.get("end_date").and_then(Value::as_str);
        create_dose_schedule(db, id, patient, start, end, frequency, &times)?;
    }
    Ok(())
}

async fn dispatch(State(state): State<AppState>, request: axum::extract::Request) -> Response {
    let (parts, body) = request.into_parts();
    let body = match axum::body::to_bytes(body, 1_048_576).await {
        Ok(b) => b,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Request body too large"),
    };
    let data: Value = serde_json::from_slice(&body).unwrap_or_else(|_| json!({}));
    let path = parts.uri.path().trim_start_matches("/api/");
    let method = parts.method.as_str();
    let patient = session_id(&parts.headers, &state.session_secret);
    if path == "health" && method == "GET" {
        return match connect(&state).and_then(|db| {
            init_db(&db)?;
            db.query_row("SELECT 1", [], |r| r.get::<_, i64>(0))
        }) {
            Ok(_) => ok(
                json!({"application":"careconnect","status":"ok","database":"connected","backend":"rust"}),
            ),
            Err(e) => db_error(e),
        };
    }
    if path == "patients/auth" && method == "POST" {
        let id = text(&data, "patientId").to_uppercase();
        let pass = text(&data, "passcode");
        if id.is_empty() || pass.is_empty() {
            return fail(StatusCode::BAD_REQUEST, "ID and passcode required");
        }
        let result = connect(&state).and_then(|db| {
            db.query_row("SELECT passcode FROM patients WHERE id=?1", [&id], |r| {
                r.get::<_, String>(0)
            })
        });
        let stored = match result {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return fail(StatusCode::UNAUTHORIZED, "Invalid patient ID or passcode")
            }
            Err(e) => return db_error(e),
        };
        if !verify(pass, &stored).unwrap_or(false) {
            return fail(StatusCode::UNAUTHORIZED, "Invalid patient ID or passcode");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let mut profile = match rows(&db, "SELECT * FROM patients WHERE id=?1", &id) {
            Ok(mut result) => match result.pop() {
                Some(profile) => profile,
                None => return fail(StatusCode::UNAUTHORIZED, "Invalid patient ID or passcode"),
            },
            Err(e) => return db_error(e),
        };
        if let Some(fields) = profile.as_object_mut() {
            fields.remove("passcode");
        }
        let mut res = ok(json!({"success":true,"patient":profile}));
        if let Ok(v) =
            header::HeaderValue::from_str(&login_cookie(&sign_session(&id, &state.session_secret)))
        {
            res.headers_mut().insert(header::SET_COOKIE, v);
        }
        return res;
    }
    if path == "patients/logout" && method == "POST" {
        let mut r = ok(json!({"success":true}));
        r.headers_mut().insert(
            header::SET_COOKIE,
            header::HeaderValue::from_static(
                "careconnect_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
            ),
        );
        return r;
    }
    if path == "patients" && method == "POST" {
        let name = text(&data, "name").trim();
        let pass = text(&data, "passcode");
        if name.is_empty() || pass.len() < 4 || pass.len() > 128 {
            return fail(
                StatusCode::BAD_REQUEST,
                "Enter a name and a passcode between 4 and 128 characters",
            );
        }
        let id = patient_id();
        let encoded = match hash(pass, DEFAULT_COST) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let result=db.execute("INSERT INTO patients(id,name,dob,blood_group,passcode,email,phone,address,emergency_contact_name,emergency_contact_phone,emergency_contact_relation,allergies,medical_conditions) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![id,name,nullable_text(&data,"dob"),nullable_text(&data,"blood_group"),encoded,nullable_text(&data,"email"),nullable_text(&data,"phone"),nullable_text(&data,"address"),nullable_text(&data,"emergency_contact_name"),nullable_text(&data,"emergency_contact_phone"),nullable_text(&data,"emergency_contact_relation"),nullable_text(&data,"allergies"),nullable_text(&data,"medical_conditions")]);
        return match result {
            Ok(_) => response(
                StatusCode::CREATED,
                json!({"id":id,"name":name,"message":"Profile created"}),
            ),
            Err(e) => db_error(e),
        };
    }
    let patient_id = match patient {
        Some(id) => id,
        None => return fail(StatusCode::UNAUTHORIZED, "Sign in required"),
    };
    if path == "medications" && method == "POST" {
        if text(&data, "patient_id") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        };
        let name = text(&data, "name").trim();
        let frequency = text(&data, "frequency");
        let start = text(&data, "start_date");
        let times = data.get("times").cloned().unwrap_or(json!([]));
        let dosage = data
            .get("dosage")
            .map(Value::to_string)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        let valid_frequencies = [
            "Once daily",
            "Twice daily",
            "Three times daily",
            "Four times daily",
            "Weekly",
            "As needed",
        ];
        let parsed_dosage = dosage.parse::<f64>().unwrap_or(f64::NAN);
        let schedule_times = times
            .as_array()
            .and_then(|items| items.iter().map(Value::as_str).collect::<Option<Vec<_>>>());
        let end_date = nullable_text(&data, "end_date");
        if name.is_empty()
            || name.len() > 120
            || !parsed_dosage.is_finite()
            || parsed_dosage <= 0.0
            || !valid_frequencies.contains(&frequency)
            || !valid_date(start)
            || end_date.is_some_and(|date| !valid_date(date) || date < start)
            || schedule_times.is_none_or(|items| {
                items.iter().any(|time| !valid_time(time))
                    || (frequency != "As needed" && items.is_empty())
            })
        {
            return fail(
                StatusCode::BAD_REQUEST,
                "Missing or invalid medication fields",
            );
        }
        let id = Uuid::new_v4().to_string();
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let saved=db.execute("INSERT INTO medications(id,patient_id,name,dosage,dosage_unit,frequency,times,with_food,start_date,end_date,notes,color) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",params![id,patient_id,name,dosage,if text(&data,"dosage_unit").is_empty(){"mg"}else{text(&data,"dosage_unit")},frequency,times.to_string(),data["with_food"].as_bool().unwrap_or(false) as i64,start,end_date,nullable_text(&data,"notes"),if text(&data,"color").starts_with('#'){text(&data,"color")}else{"#14b8a6"}]);
        if let Err(e) = saved {
            return db_error(e);
        };
        if let Err(e) = create_dose_schedule(
            &db,
            &id,
            &patient_id,
            start,
            data["end_date"].as_str(),
            frequency,
            &times,
        ) {
            return db_error(e);
        };
        return response(
            StatusCode::CREATED,
            json!({"id":id,"message":"Medication added"}),
        );
    }
    if path == "medications" && method == "PUT" {
        let id = text(&data, "id");
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let owner = db.query_row(
            "SELECT patient_id FROM medications WHERE id=?1",
            [id],
            |r| r.get::<_, String>(0),
        );
        if owner.as_deref() != Ok(patient_id.as_str()) {
            return fail(StatusCode::NOT_FOUND, "Medication not found");
        }
        let active = data["active"]
            .as_bool()
            .or_else(|| data["active"].as_i64().map(|v| v != 0))
            .unwrap_or(true);
        let times = data.get("times").cloned().unwrap_or(json!([]));
        let name = text(&data, "name").trim();
        let dosage = data["dosage"].to_string().trim_matches('"').to_string();
        let frequency = text(&data, "frequency");
        let start = text(&data, "start_date");
        let end_date = nullable_text(&data, "end_date");
        let valid_frequencies = [
            "Once daily",
            "Twice daily",
            "Three times daily",
            "Four times daily",
            "Weekly",
            "As needed",
        ];
        let times_valid = times
            .as_array()
            .and_then(|items| items.iter().map(Value::as_str).collect::<Option<Vec<_>>>())
            .is_some_and(|items| {
                items.iter().all(|time| valid_time(time))
                    && (frequency == "As needed" || !items.is_empty())
            });
        if name.is_empty()
            || name.len() > 120
            || dosage
                .parse::<f64>()
                .map_or(true, |value| !value.is_finite() || value <= 0.0)
            || !valid_frequencies.contains(&frequency)
            || !valid_date(start)
            || end_date.is_some_and(|date| !valid_date(date) || date < start)
            || !times_valid
        {
            return fail(
                StatusCode::BAD_REQUEST,
                "Missing or invalid medication fields",
            );
        }
        let result=db.execute("UPDATE medications SET name=?1,dosage=?2,dosage_unit=?3,frequency=?4,times=?5,with_food=?6,start_date=?7,end_date=?8,notes=?9,color=?10,active=?11 WHERE id=?12 AND patient_id=?13",params![name,dosage,if text(&data,"dosage_unit").is_empty(){"mg"}else{text(&data,"dosage_unit")},frequency,times.to_string(),data["with_food"].as_bool().unwrap_or(false) as i64,start,end_date,nullable_text(&data,"notes"),if text(&data,"color").starts_with('#'){text(&data,"color")}else{"#14b8a6"},active as i64,id,patient_id]);
        if let Err(e) = result {
            return db_error(e);
        }
        let _=db.execute("DELETE FROM dose_logs WHERE medication_id=?1 AND patient_id=?2 AND status='pending' AND julianday(scheduled_time)>=julianday('now')",params![id,patient_id]);
        if active {
            let _ = create_dose_schedule(
                &db,
                id,
                &patient_id,
                text(&data, "start_date"),
                data["end_date"].as_str(),
                text(&data, "frequency"),
                &times,
            );
        }
        return ok(json!({"message":"Updated"}));
    }
    if path == "medications" && method == "DELETE" {
        let id = query_value(&parts.uri, "id");
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match db.execute(
            "UPDATE medications SET active=0 WHERE id=?1 AND patient_id=?2",
            params![id, patient_id],
        ) {
            Ok(_) => ok(json!({"message":"Deactivated"})),
            Err(e) => db_error(e),
        };
    }
    if path == "appointments" && method == "POST" {
        if text(&data, "patient_id") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let doctor = text(&data, "doctor_name").trim();
        let appointment_time = match normalized_datetime(text(&data, "appointment_datetime")) {
            Some(value) => value,
            None => {
                return fail(
                    StatusCode::BAD_REQUEST,
                    "Enter a valid appointment date and time",
                )
            }
        };
        if doctor.is_empty() || doctor.len() > 120 {
            return fail(StatusCode::BAD_REQUEST, "Doctor name is required");
        }
        let id = Uuid::new_v4().to_string();
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match db.execute("INSERT INTO appointments(id,patient_id,doctor_name,specialty,appointment_datetime,location,notes) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,patient_id,doctor,nullable_text(&data,"specialty"),appointment_time,nullable_text(&data,"location"),nullable_text(&data,"notes")]){Ok(_)=>response(StatusCode::CREATED,json!({"id":id,"message":"Appointment scheduled"})),Err(e)=>db_error(e)};
    }
    if path == "appointments" && method == "PUT" {
        let id = text(&data, "id");
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let doctor = text(&data, "doctor_name").trim();
        let appointment_time = match normalized_datetime(text(&data, "appointment_datetime")) {
            Some(value) => value,
            None => {
                return fail(
                    StatusCode::BAD_REQUEST,
                    "Enter a valid appointment date and time",
                )
            }
        };
        let status = if text(&data, "status").is_empty() {
            "scheduled"
        } else {
            text(&data, "status")
        };
        if id.is_empty()
            || doctor.is_empty()
            || !["scheduled", "completed", "cancelled"].contains(&status)
        {
            return fail(
                StatusCode::BAD_REQUEST,
                "Missing or invalid appointment fields",
            );
        }
        return match db.execute("UPDATE appointments SET doctor_name=?1,specialty=?2,appointment_datetime=?3,location=?4,notes=?5,status=?6 WHERE id=?7 AND patient_id=?8",params![doctor,nullable_text(&data,"specialty"),appointment_time,nullable_text(&data,"location"),nullable_text(&data,"notes"),status,id,patient_id]){Ok(0)=>fail(StatusCode::NOT_FOUND,"Appointment not found"),Ok(_)=>ok(json!({"message":"Updated"})),Err(e)=>db_error(e)};
    }
    if path == "appointments" && method == "DELETE" {
        let id = query_value(&parts.uri, "id");
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match db.execute(
            "UPDATE appointments SET status='cancelled' WHERE id=?1 AND patient_id=?2",
            params![id, patient_id],
        ) {
            Ok(0) => fail(StatusCode::NOT_FOUND, "Appointment not found"),
            Ok(_) => ok(json!({"message":"Cancelled"})),
            Err(e) => db_error(e),
        };
    }
    if path == "vitals" && method == "POST" {
        if text(&data, "patient_id") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let vital_type = text(&data, "type");
        let unit = text(&data, "unit");
        let value = data["value"].as_f64().unwrap_or(f64::NAN);
        let valid_types = [
            "blood_pressure_systolic",
            "blood_pressure_diastolic",
            "blood_sugar",
            "weight",
            "temperature",
            "pulse",
            "oxygen_saturation",
        ];
        if !valid_types.contains(&vital_type)
            || !value.is_finite()
            || value < 0.0
            || unit.is_empty()
        {
            return fail(StatusCode::BAD_REQUEST, "Missing or invalid vital fields");
        }
        let id = Uuid::new_v4().to_string();
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match db.execute(
            "INSERT INTO vitals(id,patient_id,type,value,unit,notes) VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                id,
                patient_id,
                vital_type,
                value,
                unit,
                nullable_text(&data, "notes")
            ],
        ) {
            Ok(_) => response(
                StatusCode::CREATED,
                json!({"id":id,"message":"Vital recorded"}),
            ),
            Err(e) => db_error(e),
        };
    }
    if path == "journal" && method == "POST" {
        if text(&data, "patient_id") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let mood = data["mood"].as_i64().unwrap_or(0);
        if !(1..=5).contains(&mood) {
            return fail(StatusCode::BAD_REQUEST, "Mood must be between 1 and 5");
        }
        let energy = data["energy_level"].as_i64();
        if energy.is_some_and(|value| !(1..=5).contains(&value)) {
            return fail(
                StatusCode::BAD_REQUEST,
                "Energy level must be between 1 and 5",
            );
        }
        let id = Uuid::new_v4().to_string();
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match db.execute("INSERT INTO journal_entries(id,patient_id,mood,energy_level,symptoms,notes) VALUES(?1,?2,?3,?4,?5,?6)",params![id,patient_id,mood,energy,nullable_text(&data,"symptoms"),nullable_text(&data,"notes")]){Ok(_)=>response(StatusCode::CREATED,json!({"id":id,"message":"Entry saved"})),Err(e)=>db_error(e)};
    }
    if path == "caretaker-notes" && method == "POST" {
        if text(&data, "patient_id") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let author = text(&data, "author_name").trim();
        let content = text(&data, "content").trim();
        if author.is_empty() || author.len() > 100 || content.is_empty() || content.len() > 5000 {
            return fail(
                StatusCode::BAD_REQUEST,
                "Enter a name and a note of up to 5000 characters",
            );
        }
        let id = Uuid::new_v4().to_string();
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match db.execute("INSERT INTO caretaker_notes(id,patient_id,author_name,content,is_important) VALUES(?1,?2,?3,?4,?5)",params![id,patient_id,author,content,data["is_important"].as_bool().unwrap_or(false) as i64]){Ok(_)=>response(StatusCode::CREATED,json!({"id":id,"message":"Note added"})),Err(e)=>db_error(e)};
    }
    if path == "care-team" && method == "POST" {
        let name = text(&data, "name").trim();
        let email = text(&data, "email").trim().to_lowercase();
        let role = if text(&data, "role").is_empty() {
            "family"
        } else {
            text(&data, "role")
        };
        if name.is_empty()
            || name.len() > 100
            || !email.contains('@')
            || !email.rsplit('@').next().unwrap_or("").contains('.')
            || email.len() > 254
            || !["family", "caretaker", "admin"].contains(&role)
        {
            return fail(
                StatusCode::BAD_REQUEST,
                "Enter a name, valid email, and role",
            );
        }
        let id = Uuid::new_v4().to_string();
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let duplicate = db.query_row("SELECT EXISTS(SELECT 1 FROM authorized_users WHERE patient_id=?1 AND lower(email)=?2)", params![patient_id,email], |row| row.get::<_, i64>(0)).unwrap_or(0);
        if duplicate != 0 {
            return fail(
                StatusCode::CONFLICT,
                "This email is already on the care team",
            );
        }
        return match db.execute(
            "INSERT INTO authorized_users(id,patient_id,name,email,role) VALUES(?1,?2,?3,?4,?5)",
            params![id, patient_id, name, email, role],
        ) {
            Ok(_) => response(
                StatusCode::CREATED,
                json!({"id":id,"message":"Care team member added"}),
            ),
            Err(e) => db_error(e),
        };
    }
    if path == "care-team" && method == "DELETE" {
        let id = query_value(&parts.uri, "id");
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match db.execute(
            "DELETE FROM authorized_users WHERE id=?1 AND patient_id=?2",
            params![id, patient_id],
        ) {
            Ok(_) => ok(json!({"message":"Care team member removed"})),
            Err(e) => db_error(e),
        };
    }
    if path == "doses" && method == "POST" {
        let id = text(&data, "doseId");
        let status = text(&data, "status");
        if id.is_empty() || !["taken", "missed", "pending"].contains(&status) {
            return fail(StatusCode::BAD_REQUEST, "Valid doseId and status required");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match db.execute(
            "UPDATE dose_logs SET status=?1,taken_at=?2,notes=?3 WHERE id=?4 AND patient_id=?5",
            params![
                status,
                if status == "taken" {
                    Some(Utc::now().to_rfc3339())
                } else {
                    None
                },
                data["notes"].as_str(),
                id,
                patient_id
            ],
        ) {
            Ok(0) => fail(StatusCode::NOT_FOUND, "Dose not found"),
            Ok(_) => ok(json!({"message":"Updated"})),
            Err(e) => db_error(e),
        };
    }
    if path == "patients" && method == "PUT" {
        let id = text(&data, "id");
        if id.is_empty() {
            return fail(StatusCode::BAD_REQUEST, "ID required");
        }
        if id != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let name = text(&data, "name").trim();
        if name.is_empty() || name.len() > 120 {
            return fail(StatusCode::BAD_REQUEST, "Enter a valid name");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match db.execute("UPDATE patients SET name=?1,dob=?2,blood_group=?3,email=?4,phone=?5,address=?6,emergency_contact_name=?7,emergency_contact_phone=?8,emergency_contact_relation=?9,allergies=?10,medical_conditions=?11,updated_at=CURRENT_TIMESTAMP WHERE id=?12", params![name,nullable_text(&data,"dob"),nullable_text(&data,"blood_group"),nullable_text(&data,"email"),nullable_text(&data,"phone"),nullable_text(&data,"address"),nullable_text(&data,"emergency_contact_name"),nullable_text(&data,"emergency_contact_phone"),nullable_text(&data,"emergency_contact_relation"),nullable_text(&data,"allergies"),nullable_text(&data,"medical_conditions"),patient_id]) {
            Ok(0) => fail(StatusCode::NOT_FOUND, "Patient not found"),
            Ok(_) => ok(json!({"message":"Updated"})),
            Err(e) => db_error(e),
        };
    }
    if path == "patients" && method == "GET" {
        if query_value(&parts.uri, "id") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match rows(&db, "SELECT * FROM patients WHERE id=?1", &patient_id) {
            Ok(mut result) => match result.pop() {
                Some(mut profile) => {
                    if let Some(fields) = profile.as_object_mut() {
                        fields.remove("passcode");
                    }
                    ok(profile)
                }
                None => fail(StatusCode::NOT_FOUND, "Patient not found"),
            },
            Err(e) => db_error(e),
        };
    }
    if path == "medications" && method == "GET" {
        if query_value(&parts.uri, "patientId") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let active = query_value(&parts.uri, "active") == "true";
        let sql = if active {
            "SELECT * FROM medications WHERE patient_id=?1 AND active=1 ORDER BY created_at DESC"
        } else {
            "SELECT * FROM medications WHERE patient_id=?1 ORDER BY created_at DESC"
        };
        return match rows(&db, sql, &patient_id) {
            Ok(v) => ok(json!(v)),
            Err(e) => db_error(e),
        };
    }
    if path == "appointments" && method == "GET" {
        if query_value(&parts.uri, "patientId") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let sql = if query_value(&parts.uri, "upcoming") == "true" {
            "SELECT * FROM appointments WHERE patient_id=?1 AND julianday(appointment_datetime)>=julianday('now') AND status='scheduled' ORDER BY appointment_datetime"
        } else {
            "SELECT * FROM appointments WHERE patient_id=?1 ORDER BY appointment_datetime"
        };
        return match rows(&db, sql, &patient_id) {
            Ok(v) => ok(json!(v)),
            Err(e) => db_error(e),
        };
    }
    if path == "vitals" && method == "GET" {
        if query_value(&parts.uri, "patientId") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        let limit = query_value(&parts.uri, "limit")
            .parse::<i64>()
            .unwrap_or(50)
            .clamp(1, 200);
        let vital_type = query_value(&parts.uri, "type");
        let result = if vital_type.is_empty() {
            rows_filtered(
                &db,
                "SELECT * FROM vitals WHERE patient_id=?1 ORDER BY recorded_at DESC LIMIT ?2",
                &patient_id,
                None,
                limit,
            )
        } else {
            rows_filtered(&db, "SELECT * FROM vitals WHERE patient_id=?1 AND type=?2 ORDER BY recorded_at DESC LIMIT ?3", &patient_id, Some(&vital_type), limit)
        };
        return match result {
            Ok(v) => ok(json!(v)),
            Err(e) => db_error(e),
        };
    }
    if path == "journal" && method == "GET" {
        if query_value(&parts.uri, "patientId") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match rows(
            &db,
            "SELECT * FROM journal_entries WHERE patient_id=?1 ORDER BY created_at DESC LIMIT 100",
            &patient_id,
        ) {
            Ok(v) => ok(json!(v)),
            Err(e) => db_error(e),
        };
    }
    if path == "caretaker-notes" && method == "GET" {
        if query_value(&parts.uri, "patientId") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match rows(
            &db,
            "SELECT * FROM caretaker_notes WHERE patient_id=?1 ORDER BY created_at DESC LIMIT 50",
            &patient_id,
        ) {
            Ok(v) => ok(json!(v)),
            Err(e) => db_error(e),
        };
    }
    if path == "care-team" && method == "GET" {
        if query_value(&parts.uri, "patientId") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        return match rows(&db,"SELECT id,name,email,role,created_at FROM authorized_users WHERE patient_id=?1 ORDER BY created_at",&patient_id){Ok(v)=>ok(json!(v)),Err(e)=>db_error(e)};
    }
    if path == "doses" && method == "GET" {
        if query_value(&parts.uri, "patientId") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        if let Err(e) = ensure_dose_schedule(&db, &patient_id) {
            return db_error(e);
        }
        let date = query_value(&parts.uri, "date");
        let medication_id = query_value(&parts.uri, "medicationId");
        let result = if !date.is_empty() {
            if !valid_date(&date) {
                return fail(StatusCode::BAD_REQUEST, "Invalid date");
            }
            rows_filtered(&db, "SELECT dl.*,m.name AS medication_name,m.dosage,m.dosage_unit,m.color,m.with_food,m.times FROM dose_logs dl JOIN medications m ON m.id=dl.medication_id WHERE dl.patient_id=?1 AND m.active=1 AND date(dl.scheduled_time,'localtime')=?2 ORDER BY dl.scheduled_time ASC LIMIT ?3", &patient_id, Some(&date), 500)
        } else if !medication_id.is_empty() {
            rows_filtered(&db, "SELECT dl.*,m.name AS medication_name,m.dosage,m.dosage_unit,m.color,m.with_food,m.times FROM dose_logs dl JOIN medications m ON m.id=dl.medication_id WHERE dl.patient_id=?1 AND dl.medication_id=?2 ORDER BY dl.scheduled_time DESC LIMIT ?3", &patient_id, Some(&medication_id), 100)
        } else {
            rows(&db, "SELECT dl.*,m.name AS medication_name,m.dosage,m.dosage_unit,m.color,m.with_food,m.times FROM dose_logs dl JOIN medications m ON m.id=dl.medication_id WHERE dl.patient_id=?1 AND m.active=1 ORDER BY dl.scheduled_time DESC LIMIT 100", &patient_id)
        };
        return match result {
            Ok(v) => ok(json!(v)),
            Err(e) => db_error(e),
        };
    }
    if path == "stats" && method == "GET" {
        if query_value(&parts.uri, "patientId") != patient_id {
            return fail(StatusCode::FORBIDDEN, "Forbidden");
        }
        let db = match connect(&state) {
            Ok(v) => v,
            Err(e) => return db_error(e),
        };
        if let Err(e) = ensure_dose_schedule(&db, &patient_id) {
            return db_error(e);
        }
        let days = query_value(&parts.uri, "days")
            .parse::<i64>()
            .unwrap_or(30)
            .clamp(1, 365);
        let taken:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND status='taken' AND julianday(scheduled_time)>=julianday('now',printf('-%d days',?2)) AND julianday(scheduled_time)<=julianday('now')",params![patient_id,days],|r|r.get(0)).unwrap_or(0);
        let missed:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND status='missed' AND julianday(scheduled_time)>=julianday('now',printf('-%d days',?2)) AND julianday(scheduled_time)<=julianday('now')",params![patient_id,days],|r|r.get(0)).unwrap_or(0);
        let total:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND julianday(scheduled_time)>=julianday('now',printf('-%d days',?2)) AND julianday(scheduled_time)<=julianday('now')",params![patient_id,days],|r|r.get(0)).unwrap_or(0);
        let meds: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM medications WHERE patient_id=?1 AND active=1",
                [&patient_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let appts:i64=db.query_row("SELECT COUNT(*) FROM appointments WHERE patient_id=?1 AND status='scheduled' AND julianday(appointment_datetime)>=julianday('now')",[&patient_id],|r|r.get(0)).unwrap_or(0);
        let mut daily = Vec::new();
        for offset in (0..7).rev() {
            let day = Local::now().date_naive() - Duration::days(offset);
            let key = day.format("%Y-%m-%d").to_string();
            let day_total:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND date(scheduled_time,'localtime')=?2",params![patient_id,key],|r|r.get(0)).unwrap_or(0);
            let day_taken:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND status='taken' AND date(scheduled_time,'localtime')=?2",params![patient_id,key],|r|r.get(0)).unwrap_or(0);
            daily.push(json!({"date":day.format("%a").to_string(),"total":day_total,"taken":day_taken,"rate":if day_total==0{0}else{day_taken*100/day_total}}));
        }
        return ok(
            json!({"adherenceRate":if total==0{0}else{taken*100/total},"totalDoses":total,"takenDoses":taken,"missedDoses":missed,"activeMedications":meds,"upcomingAppointments":appts,"dailyStats":daily}),
        );
    }
    if path == "reminders/send" && method == "POST" {
        if !state.cron_secret.is_empty()
            && parts
                .headers
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                != Some(&format!("Bearer {}", state.cron_secret))
        {
            return fail(StatusCode::UNAUTHORIZED, "Unauthorized");
        }
        return ok(
            json!({"success":true,"processed":{"upcomingDoses":0,"missedDoses":0,"appts24h":0,"appts1h":0}}),
        );
    }
    fail(StatusCode::NOT_FOUND, "API endpoint not found")
}
