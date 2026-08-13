use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;

const TEXT_LIMIT: usize = 4000;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PartView {
    pub kind: String,
    pub text: Option<String>,
    pub truncated: bool,
    pub tool: Option<String>,
    pub title: Option<String>,
    pub status: Option<String>,
    pub duration_ms: Option<i64>,
    pub files: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageView {
    pub id: String,
    pub role: String,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub cost: f64,
    pub total_tokens: i64,
    pub error: Option<String>,
    pub time_created: i64,
    pub parts: Vec<PartView>,
}

pub fn session_detail(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<MessageView>, String> {
    let mut messages: Vec<MessageView> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, \
                 COALESCE(json_extract(data,'$.role'),''), \
                 json_extract(data,'$.agent'), \
                 COALESCE(json_extract(data,'$.modelID'),json_extract(data,'$.model.modelID')), \
                 COALESCE(json_extract(data,'$.cost'),0), \
                 COALESCE(json_extract(data,'$.tokens.input'),0) + COALESCE(json_extract(data,'$.tokens.output'),0) \
                   + COALESCE(json_extract(data,'$.tokens.reasoning'),0) + COALESCE(json_extract(data,'$.tokens.cache.read'),0) \
                   + COALESCE(json_extract(data,'$.tokens.cache.write'),0), \
                 json_extract(data,'$.error.name'), \
                 time_created \
                 FROM message WHERE session_id = ?1 ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([session_id], |row| {
                Ok(MessageView {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    agent: row.get(2)?,
                    model: row.get(3)?,
                    cost: row.get(4)?,
                    total_tokens: row.get(5)?,
                    error: row.get(6)?,
                    time_created: row.get(7)?,
                    parts: Vec::new(),
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };

    let index: HashMap<String, usize> = messages
        .iter()
        .enumerate()
        .map(|(i, m)| (m.id.clone(), i))
        .collect();

    let mut stmt = conn
        .prepare(&format!(
            "SELECT message_id, \
             COALESCE(json_extract(data,'$.type'),''), \
             substr(COALESCE(json_extract(data,'$.text'),''),1,{limit}), \
             length(COALESCE(json_extract(data,'$.text'),'')), \
             json_extract(data,'$.tool'), \
             json_extract(data,'$.state.title'), \
             json_extract(data,'$.state.status'), \
             json_extract(data,'$.state.time.start'), \
             json_extract(data,'$.state.time.end'), \
             json_array_length(COALESCE(json_extract(data,'$.files'),'[]')) \
             FROM part WHERE session_id = ?1 ORDER BY id",
            limit = TEXT_LIMIT + 1
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<i64>>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (message_id, kind, text, text_len, tool, title, status, start, end, files) =
            row.map_err(|e| e.to_string())?;
        let Some(&message_index) = index.get(&message_id) else {
            continue;
        };
        let part = match kind.as_str() {
            "text" | "reasoning" => {
                let truncated = text_len as usize > TEXT_LIMIT;
                let mut content = text;
                if truncated {
                    content.truncate(
                        content
                            .char_indices()
                            .take_while(|(i, _)| *i < TEXT_LIMIT)
                            .last()
                            .map(|(i, c)| i + c.len_utf8())
                            .unwrap_or(0),
                    );
                }
                PartView {
                    kind,
                    text: Some(content),
                    truncated,
                    tool: None,
                    title: None,
                    status: None,
                    duration_ms: None,
                    files: None,
                }
            }
            "tool" => PartView {
                kind,
                text: None,
                truncated: false,
                tool,
                title,
                status,
                duration_ms: match (start, end) {
                    (Some(s), Some(e)) if e >= s => Some(e - s),
                    _ => None,
                },
                files: None,
            },
            "patch" => PartView {
                kind,
                text: None,
                truncated: false,
                tool: None,
                title: None,
                status: None,
                duration_ms: None,
                files,
            },
            _ => continue,
        };
        messages[message_index].parts.push(part);
    }

    messages.retain(|m| !m.parts.is_empty() || m.role == "assistant" || m.role == "user");
    Ok(messages)
}
