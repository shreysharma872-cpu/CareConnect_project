use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{
    DateTime, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat, TimeZone, Utc,
};
use hmac::{Hmac, Mac};
use postgres::{
    types::{FromSqlOwned, ToSql},
    NoTls, Row as PgRow,
};
use postgres_native_tls::MakeTlsConnector;
use serde_json::{json, Map, Value};
use sha2::Sha256;
use std::cell::RefCell;
use std::{
    env,
    path::Path,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::net::TcpListener;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;
macro_rules! params {
    ($($value:expr),* $(,)?) => { &[$(&$value as &(dyn ToSql + Sync)),*] };
}
#[derive(Clone)]
struct AppState {
    database_url: String,
    session_secret: String,
    cron_secret: String,
    cors_allowed_origins: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir.parent().unwrap_or(manifest_dir);
    let env_file = project_root.join(".env.local");
    if env_file.exists() {
        if let Err(error) = dotenvy::from_path(&env_file) {
            eprintln!("Could not load {}: {error}", env_file.display());
        }
    }
    let _ = dotenvy::dotenv();
    let database_url = env::var("DATABASE_URL").map_err(|_| {
        "DATABASE_URL is missing. Set it in the project-root .env.local or service environment."
    })?;
    let session_secret = match env::var("SESSION_SECRET") {
        Ok(secret) if !secret.trim().is_empty() => secret,
        _ if env::var("NODE_ENV").as_deref() == Ok("production") => {
            return Err("SESSION_SECRET must be configured in production".into())
        }
        _ => "careconnect-local-development-secret-not-for-production".into(),
    };
    let cron_secret = env::var("CRON_SECRET").unwrap_or_default();
    let cors_allowed_origins = env::var("CORS_ALLOWED_ORIGINS").unwrap_or_default();
    let state = AppState {
        database_url,
        session_secret,
        cron_secret,
        cors_allowed_origins,
    };
    let database_state = state.clone();
    tokio::task::spawn_blocking(move || {
        let conn = connect(&database_state)?;
        init_db(&conn)
    })
    .await??;
    let app = Router::new()
        .route("/api/{*path}", any(dispatch))
        .with_state(state);
    let port = env::var("PORT")
        .or_else(|_| env::var("RUST_BACKEND_PORT"))
        .unwrap_or_else(|_| "4000".into());
    let host = env::var("RUST_BACKEND_HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let listener = TcpListener::bind(format!("{host}:{port}")).await?;
    println!("CareConnect Rust API listening on http://{host}:{port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[derive(Debug)]
enum DbError {
    Postgres(postgres::Error),
    QueryReturnedNoRows,
    Other(String),
}
impl std::fmt::Display for DbError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Postgres(error) => write!(formatter, "{error}"),
            Self::QueryReturnedNoRows => write!(formatter, "Query returned no rows"),
            Self::Other(error) => write!(formatter, "{error}"),
        }
    }
}
impl std::error::Error for DbError {}
impl From<postgres::Error> for DbError {
    fn from(error: postgres::Error) -> Self {
        Self::Postgres(error)
    }
}

struct Connection {
    client: RefCell<postgres::Client>,
}
struct Row<'a>(&'a PgRow);
trait ColumnIndex {
    fn as_usize(self) -> usize;
}
impl ColumnIndex for usize {
    fn as_usize(self) -> usize {
        self
    }
}
impl ColumnIndex for i32 {
    fn as_usize(self) -> usize {
        self as usize
    }
}
impl Row<'_> {
    fn get<I, T>(&self, index: I) -> Result<T, DbError>
    where
        I: ColumnIndex,
        T: FromSqlOwned,
    {
        self.0.try_get(index.as_usize()).map_err(DbError::Postgres)
    }
}
impl Connection {
    fn execute(&self, sql: &str, values: &[&(dyn ToSql + Sync)]) -> Result<u64, DbError> {
        self.client
            .borrow_mut()
            .execute(&postgres_sql(sql), values)
            .map_err(DbError::Postgres)
    }
    fn execute_batch(&self, sql: &str) -> Result<(), DbError> {
        self.client
            .borrow_mut()
            .batch_execute(sql)
            .map_err(DbError::Postgres)
    }
    fn query_row<T>(
        &self,
        sql: &str,
        values: &[&(dyn ToSql + Sync)],
        map: impl FnOnce(&Row<'_>) -> Result<T, DbError>,
    ) -> Result<T, DbError> {
        let row = self
            .client
            .borrow_mut()
            .query_opt(&postgres_sql(sql), values)?
            .ok_or(DbError::QueryReturnedNoRows)?;
        map(&Row(&row))
    }
    fn query_map<T>(
        &self,
        sql: &str,
        values: &[&(dyn ToSql + Sync)],
        mut map: impl FnMut(&Row<'_>) -> Result<T, DbError>,
    ) -> Result<Vec<T>, DbError> {
        let rows = self.client.borrow_mut().query(&postgres_sql(sql), values)?;
        rows.iter().map(|row| map(&Row(row))).collect()
    }
}
fn postgres_sql(sql: &str) -> String {
    let bytes = sql.as_bytes();
    let mut output = String::with_capacity(sql.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'?' && index + 1 < bytes.len() && bytes[index + 1].is_ascii_digit() {
            output.push('$');
            index += 1;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                output.push(bytes[index] as char);
                index += 1;
            }
        } else {
            output.push(bytes[index] as char);
            index += 1;
        }
    }
    output
}
fn connect(state: &AppState) -> Result<Connection, DbError> {
    let client = if state.database_url.contains("sslmode=require") {
        let connector =
            native_tls::TlsConnector::new().map_err(|error| DbError::Other(error.to_string()))?;
        postgres::Client::connect(&state.database_url, MakeTlsConnector::new(connector))?
    } else {
        postgres::Client::connect(&state.database_url, NoTls)?
    };
    Ok(Connection {
        client: RefCell::new(client),
    })
}

fn init_db(db: &Connection) -> Result<(), DbError> {
    let schema = r#"
      CREATE TABLE IF NOT EXISTS patients(id TEXT PRIMARY KEY,name TEXT NOT NULL,dob TEXT,blood_group TEXT,passcode TEXT NOT NULL,email TEXT,phone TEXT,address TEXT,emergency_contact_name TEXT,emergency_contact_phone TEXT,emergency_contact_relation TEXT,allergies TEXT,medical_conditions TEXT,created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      CREATE TABLE IF NOT EXISTS authorized_users(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,name TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'family',created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      CREATE TABLE IF NOT EXISTS medications(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,name TEXT NOT NULL,dosage TEXT NOT NULL,dosage_unit TEXT DEFAULT 'mg',frequency TEXT NOT NULL,times TEXT NOT NULL,with_food BIGINT DEFAULT 0,start_date TEXT NOT NULL,end_date TEXT,notes TEXT,color TEXT DEFAULT '#14b8a6',active BIGINT DEFAULT 1,created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      CREATE TABLE IF NOT EXISTS dose_logs(id TEXT PRIMARY KEY,medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,scheduled_time TEXT NOT NULL,taken_at TEXT,status TEXT DEFAULT 'pending',notes TEXT,reminder_sent BIGINT DEFAULT 0,missed_reminder_sent BIGINT DEFAULT 0);
      CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,doctor_name TEXT NOT NULL,specialty TEXT,appointment_datetime TEXT NOT NULL,location TEXT,notes TEXT,status TEXT DEFAULT 'scheduled',reminder_24h_sent BIGINT DEFAULT 0,reminder_1h_sent BIGINT DEFAULT 0,created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      CREATE TABLE IF NOT EXISTS vitals(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,type TEXT NOT NULL,value DOUBLE PRECISION NOT NULL,unit TEXT NOT NULL,notes TEXT,recorded_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      CREATE TABLE IF NOT EXISTS journal_entries(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,mood BIGINT NOT NULL,energy_level BIGINT,symptoms TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      CREATE TABLE IF NOT EXISTS caretaker_notes(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,author_name TEXT NOT NULL,content TEXT NOT NULL,is_important BIGINT DEFAULT 0,created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
      ALTER TABLE dose_logs ADD COLUMN IF NOT EXISTS missed_reminder_sent BIGINT DEFAULT 0;
      DELETE FROM dose_logs a USING dose_logs b WHERE a.medication_id=b.medication_id AND a.scheduled_time=b.scheduled_time AND a.ctid>b.ctid;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dose_medication_schedule ON dose_logs(medication_id,scheduled_time);
      CREATE INDEX IF NOT EXISTS idx_medications_patient_active ON medications(patient_id,active);
      CREATE INDEX IF NOT EXISTS idx_doses_patient_schedule ON dose_logs(patient_id,scheduled_time);
      CREATE INDEX IF NOT EXISTS idx_appointments_patient_time ON appointments(patient_id,appointment_datetime);
      CREATE INDEX IF NOT EXISTS idx_vitals_patient_recorded ON vitals(patient_id,recorded_at);
    "#;
    db.execute_batch(schema)
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
fn apply_cors(response: &mut Response, origin: Option<&str>, allowed_origins: &str) {
    let Some(origin) = origin else { return };
    if !allowed_origins
        .split(',')
        .map(str::trim)
        .any(|allowed| allowed == origin)
    {
        return;
    }
    let headers = response.headers_mut();
    if let Ok(value) = header::HeaderValue::from_str(origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
            header::HeaderValue::from_static("true"),
        );
        headers.insert(header::VARY, header::HeaderValue::from_static("Origin"));
    }
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
fn dummy_passcode_hash() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| {
        hash("CareConnect-dummy-passcode", DEFAULT_COST).expect("dummy bcrypt hash")
    })
}
fn normalized_datetime(value: &str) -> Option<String> {
    if let Ok(datetime) = DateTime::parse_from_rfc3339(value) {
        return Some(
            datetime
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true),
        );
    }
    let naive = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").ok()?;
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|datetime| {
            datetime
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true)
        })
}
fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn utc_days_ago(days: i64) -> String {
    (Utc::now() - Duration::days(days)).to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn local_midnight_utc(date: NaiveDate) -> Option<String> {
    Local
        .from_local_datetime(&date.and_time(NaiveTime::MIN))
        .earliest()
        .map(|value| {
            value
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true)
        })
}
fn local_day_bounds(date: NaiveDate) -> Option<(String, String)> {
    Some((
        local_midnight_utc(date)?,
        local_midnight_utc(date + Duration::days(1))?,
    ))
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
    let production = env::var("NODE_ENV").as_deref() == Ok("production");
    format!(
        "careconnect_session={token}; Path=/; HttpOnly; SameSite={}; Max-Age=604800{}",
        if production { "None" } else { "Lax" },
        if production { "; Secure" } else { "" }
    )
}
fn logout_cookie() -> String {
    let production = env::var("NODE_ENV").as_deref() == Ok("production");
    format!(
        "careconnect_session=; Path=/; HttpOnly; SameSite={}; Max-Age=0{}",
        if production { "None" } else { "Lax" },
        if production { "; Secure" } else { "" }
    )
}
fn rows(db: &Connection, sql: &str, patient: &str) -> Result<Vec<Value>, DbError> {
    db.query_map(sql, params![patient], row_value)
}
fn rows_filtered(
    db: &Connection,
    sql: &str,
    patient: &str,
    filter: Option<&str>,
    limit: i64,
) -> Result<Vec<Value>, DbError> {
    if let Some(filter) = filter {
        db.query_map(sql, params![patient, filter, limit], row_value)
    } else {
        db.query_map(sql, params![patient, limit], row_value)
    }
}
fn rows_between(
    db: &Connection,
    sql: &str,
    patient: &str,
    start: &str,
    end: &str,
) -> Result<Vec<Value>, DbError> {
    db.query_map(sql, params![patient, start, end], row_value)
}
fn row_value(row: &Row<'_>) -> Result<Value, DbError> {
    let mut object = Map::new();
    for (index, column) in row.0.columns().iter().enumerate() {
        let value = match column.type_().name() {
            "int2" => json!(row.get::<_, i16>(index)?),
            "int4" => json!(row.get::<_, i32>(index)?),
            "int8" => json!(row.get::<_, i64>(index)?),
            "float4" => json!(row.get::<_, f32>(index)?),
            "float8" => json!(row.get::<_, f64>(index)?),
            "bool" => json!(row.get::<_, bool>(index)?),
            "bytea" => json!(URL_SAFE_NO_PAD.encode(row.get::<_, Vec<u8>>(index)?)),
            _ => match row.get::<_, Option<String>>(index)? {
                Some(value) => json!(value),
                None => Value::Null,
            },
        };
        object.insert(column.name().to_string(), value);
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
) -> Result<(), DbError> {
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
            let Some(stamp) =
                Local
                    .from_local_datetime(&day.and_time(t))
                    .earliest()
                    .map(|datetime| {
                        datetime
                            .with_timezone(&Utc)
                            .to_rfc3339_opts(SecondsFormat::Millis, true)
                    })
            else {
                continue;
            };
            db.execute("INSERT INTO dose_logs(id,medication_id,patient_id,scheduled_time,status) VALUES(?1,?2,?3,?4,'pending') ON CONFLICT (medication_id,scheduled_time) DO NOTHING",params![Uuid::new_v4().to_string(),medication,patient,stamp])?;
        }
    }
    Ok(())
}
fn ensure_dose_schedule(db: &Connection, patient: &str) -> Result<(), DbError> {
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
    let origin = parts
        .headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    if parts.method == axum::http::Method::OPTIONS {
        let mut response = StatusCode::NO_CONTENT.into_response();
        apply_cors(
            &mut response,
            origin.as_deref(),
            &state.cors_allowed_origins,
        );
        if response
            .headers()
            .contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN)
        {
            let headers = response.headers_mut();
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                header::HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"),
            );
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                header::HeaderValue::from_static("content-type, authorization"),
            );
            headers.insert(
                header::ACCESS_CONTROL_MAX_AGE,
                header::HeaderValue::from_static("600"),
            );
        }
        return response;
    }
    let allowed_origins = state.cors_allowed_origins.clone();
    let body = match axum::body::to_bytes(body, 1_048_576).await {
        Ok(b) => b,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Request body too large"),
    };
    let mut response =
        match tokio::task::spawn_blocking(move || dispatch_sync(state, parts, body.to_vec())).await
        {
            Ok(response) => response,
            Err(error) => {
                eprintln!("[CareConnect Rust API] Request worker failed: {error}");
                fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Request processing failed",
                )
            }
        };
    apply_cors(&mut response, origin.as_deref(), &allowed_origins);
    response
}

fn dispatch_sync(state: AppState, parts: axum::http::request::Parts, body: Vec<u8>) -> Response {
    let data: Value = serde_json::from_slice(&body).unwrap_or_else(|_| json!({}));
    let path = parts.uri.path().trim_start_matches("/api/");
    let method = parts.method.as_str();
    let patient = session_id(&parts.headers, &state.session_secret);
    if path == "health" && method == "GET" {
        return match connect(&state).and_then(|db| {
            init_db(&db)?;
            db.query_row("SELECT 1::BIGINT", &[], |r| r.get::<_, i64>(0))
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
            db.query_row(
                "SELECT passcode FROM patients WHERE id=?1",
                params![id],
                |r| r.get::<_, String>(0),
            )
        });
        let stored = match result {
            Ok(v) => v,
            Err(DbError::QueryReturnedNoRows) => {
                let _ = verify(pass, dummy_passcode_hash());
                return fail(StatusCode::UNAUTHORIZED, "Invalid patient ID or passcode");
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
        if let Ok(cookie) = header::HeaderValue::from_str(&logout_cookie()) {
            r.headers_mut().insert(header::SET_COOKIE, cookie);
        }
        return r;
    }
    if path == "patients" && method == "POST" {
        let name = text(&data, "name").trim();
        let pass = text(&data, "passcode");
        if name.is_empty() || pass.len() < 8 || pass.len() > 72 {
            return fail(
                StatusCode::BAD_REQUEST,
                "Enter a name and a passcode between 8 and 72 bytes",
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
            params![id],
            |r| r.get::<_, String>(0),
        );
        if owner.as_ref().map(|value| value.as_str()).ok() != Some(patient_id.as_str()) {
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
        let _=db.execute("DELETE FROM dose_logs WHERE medication_id=?1 AND patient_id=?2 AND status='pending' AND scheduled_time>=?3",params![id,patient_id,utc_now()]);
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
        let duplicate = db
            .query_row(
                "SELECT COUNT(*) FROM authorized_users WHERE patient_id=?1 AND lower(email)=?2",
                params![patient_id, email],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0);
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
        return match db.execute("UPDATE patients SET name=?1,dob=?2,blood_group=?3,email=?4,phone=?5,address=?6,emergency_contact_name=?7,emergency_contact_phone=?8,emergency_contact_relation=?9,allergies=?10,medical_conditions=?11,updated_at=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') WHERE id=?12", params![name,nullable_text(&data,"dob"),nullable_text(&data,"blood_group"),nullable_text(&data,"email"),nullable_text(&data,"phone"),nullable_text(&data,"address"),nullable_text(&data,"emergency_contact_name"),nullable_text(&data,"emergency_contact_phone"),nullable_text(&data,"emergency_contact_relation"),nullable_text(&data,"allergies"),nullable_text(&data,"medical_conditions"),patient_id]) {
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
        if query_value(&parts.uri, "upcoming") == "true" {
            return match db.query_map("SELECT * FROM appointments WHERE patient_id=?1 AND appointment_datetime>=?2 AND status='scheduled' ORDER BY appointment_datetime", params![patient_id,utc_now()], row_value) { Ok(v)=>ok(json!(v)), Err(e)=>db_error(e) };
        } else {
            return match rows(
                &db,
                "SELECT * FROM appointments WHERE patient_id=?1 ORDER BY appointment_datetime",
                &patient_id,
            ) {
                Ok(v) => ok(json!(v)),
                Err(e) => db_error(e),
            };
        }
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
            let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").unwrap();
            let Some((start, end)) = local_day_bounds(date) else {
                return fail(StatusCode::BAD_REQUEST, "Invalid date");
            };
            rows_between(&db, "SELECT dl.*,m.name AS medication_name,m.dosage,m.dosage_unit,m.color,m.with_food,m.times FROM dose_logs dl JOIN medications m ON m.id=dl.medication_id WHERE dl.patient_id=?1 AND m.active=1 AND dl.scheduled_time>=?2 AND dl.scheduled_time<?3 ORDER BY dl.scheduled_time ASC", &patient_id, &start,&end)
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
        let cutoff = utc_days_ago(days);
        let current_time = utc_now();
        let taken:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND status='taken' AND scheduled_time>=?2 AND scheduled_time<=?3",params![patient_id,cutoff,current_time],|r|r.get(0)).unwrap_or(0);
        let missed:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND status='missed' AND scheduled_time>=?2 AND scheduled_time<=?3",params![patient_id,cutoff,current_time],|r|r.get(0)).unwrap_or(0);
        let total:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND scheduled_time>=?2 AND scheduled_time<=?3",params![patient_id,cutoff,current_time],|r|r.get(0)).unwrap_or(0);
        let meds: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM medications WHERE patient_id=?1 AND active=1",
                params![patient_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let appts:i64=db.query_row("SELECT COUNT(*) FROM appointments WHERE patient_id=?1 AND status='scheduled' AND appointment_datetime>=?2",params![patient_id,utc_now()],|r|r.get(0)).unwrap_or(0);
        let mut daily = Vec::new();
        for offset in (0..7).rev() {
            let day = Local::now().date_naive() - Duration::days(offset);
            let Some((start, end)) = local_day_bounds(day) else {
                continue;
            };
            let day_total:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND scheduled_time>=?2 AND scheduled_time<?3",params![patient_id,start,end],|r|r.get(0)).unwrap_or(0);
            let day_taken:i64=db.query_row("SELECT COUNT(*) FROM dose_logs WHERE patient_id=?1 AND status='taken' AND scheduled_time>=?2 AND scheduled_time<?3",params![patient_id,start,end],|r|r.get(0)).unwrap_or(0);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn headers_with_cookie(cookie: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, cookie.parse().unwrap());
        headers
    }

    fn signed_cookie(subject: &str, expires: u64, secret: &str) -> String {
        let payload = URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&json!({"sub":subject,"exp":expires})).unwrap());
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(payload.as_bytes());
        format!(
            "{payload}.{}",
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
        )
    }

    #[test]
    fn validates_iso_dates() {
        assert!(valid_date("2026-11-15"));
        assert!(!valid_date("2026-02-30"));
    }

    #[test]
    fn validates_24_hour_times() {
        assert!(valid_time("23:59"));
        assert!(!valid_time("24:00"));
    }

    #[test]
    fn postgres_sql_rewrites_numbered_parameters() {
        assert_eq!(
            postgres_sql("SELECT * WHERE id=?1 AND name=?12"),
            "SELECT * WHERE id=$1 AND name=$12"
        );
    }

    #[test]
    fn accepts_valid_signed_session() {
        let secret = "unit-test-secret";
        let cookie = sign_session("PATIENT42", secret);
        assert_eq!(
            session_id(
                &headers_with_cookie(&format!("careconnect_session={cookie}")),
                secret
            )
            .as_deref(),
            Some("PATIENT42")
        );
    }

    #[test]
    fn rejects_tampered_session() {
        let secret = "unit-test-secret";
        let cookie = signed_cookie("PATIENT42", now() + 60, secret);
        let tampered = format!("{}x", cookie);
        assert_eq!(
            session_id(
                &headers_with_cookie(&format!("careconnect_session={tampered}")),
                secret
            ),
            None
        );
    }

    #[test]
    fn rejects_expired_session() {
        let secret = "unit-test-secret";
        let cookie = signed_cookie("PATIENT42", now().saturating_sub(1), secret);
        assert_eq!(
            session_id(
                &headers_with_cookie(&format!("careconnect_session={cookie}")),
                secret
            ),
            None
        );
    }

    #[test]
    fn rejects_session_signed_with_another_secret() {
        let cookie = signed_cookie("PATIENT42", now() + 60, "first-secret");
        assert_eq!(
            session_id(
                &headers_with_cookie(&format!("careconnect_session={cookie}")),
                "second-secret"
            ),
            None
        );
    }

    #[test]
    fn patient_ids_use_the_eight_character_safe_alphabet() {
        let id = patient_id();
        assert_eq!(id.len(), 8);
        assert!(id
            .chars()
            .all(|ch| "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(ch)));
    }
}
