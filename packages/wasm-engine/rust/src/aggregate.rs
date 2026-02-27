//! Aggregation logic for the Wasm query engine.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::engine::get_field;
use crate::filter::{evaluate_filter, FilterNode};

#[derive(Debug, Deserialize)]
pub struct GroupByClause {
    pub fields: Vec<String>,
    pub aggregates: Vec<AggregateClause>,
}

#[derive(Debug, Deserialize)]
pub struct AggregateClause {
    pub function: String, // "count" | "sum" | "avg" | "min" | "max"
    pub field: Option<String>,
    pub alias: String,
}

#[derive(Serialize)]
pub struct AggregateResponse {
    pub groups: Vec<Value>,
    pub execution_time_ms: f64,
    pub engine: String,
}

/// Execute an aggregation query.
pub fn execute_aggregate(
    documents: &[Value],
    group_by: &GroupByClause,
    filter: Option<&FilterNode>,
) -> Vec<Value> {
    // 1. Apply filter
    let filtered: Vec<&Value> = match filter {
        Some(f) => documents.iter().filter(|d| evaluate_filter(d, f)).collect(),
        None => documents.iter().collect(),
    };

    // 2. Group documents
    let mut groups: HashMap<String, Vec<&Value>> = HashMap::new();
    for doc in &filtered {
        let key = group_by
            .fields
            .iter()
            .map(|f| {
                get_field(doc, f)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "null".to_string())
            })
            .collect::<Vec<_>>()
            .join("|");
        groups.entry(key).or_default().push(doc);
    }

    // 3. Compute aggregates
    let mut results = Vec::new();
    for (_key, group_docs) in &groups {
        let mut row = serde_json::Map::new();

        // Add group-by field values
        if let Some(first) = group_docs.first() {
            for field in &group_by.fields {
                if let Some(val) = get_field(first, field) {
                    row.insert(field.clone(), val.clone());
                }
            }
        }

        // Compute each aggregate
        for agg in &group_by.aggregates {
            let values: Vec<f64> = match &agg.field {
                Some(f) => group_docs
                    .iter()
                    .filter_map(|d| get_field(d, f))
                    .filter_map(|v| v.as_f64())
                    .collect(),
                None => Vec::new(),
            };

            let result: Value = match agg.function.as_str() {
                "count" => Value::Number(serde_json::Number::from(group_docs.len())),
                "sum" => {
                    let s: f64 = values.iter().sum();
                    serde_json::Number::from_f64(s)
                        .map(Value::Number)
                        .unwrap_or(Value::Null)
                }
                "avg" => {
                    if values.is_empty() {
                        Value::Number(serde_json::Number::from(0))
                    } else {
                        let avg = values.iter().sum::<f64>() / values.len() as f64;
                        serde_json::Number::from_f64(avg)
                            .map(Value::Number)
                            .unwrap_or(Value::Null)
                    }
                }
                "min" => values
                    .iter()
                    .cloned()
                    .reduce(f64::min)
                    .and_then(|v| serde_json::Number::from_f64(v))
                    .map(Value::Number)
                    .unwrap_or(Value::Null),
                "max" => values
                    .iter()
                    .cloned()
                    .reduce(f64::max)
                    .and_then(|v| serde_json::Number::from_f64(v))
                    .map(Value::Number)
                    .unwrap_or(Value::Null),
                _ => Value::Null,
            };

            row.insert(agg.alias.clone(), result);
        }

        results.push(Value::Object(row));
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_group_count() {
        let docs = vec![
            json!({"role": "admin", "score": 90}),
            json!({"role": "user", "score": 80}),
            json!({"role": "admin", "score": 95}),
        ];
        let group_by = GroupByClause {
            fields: vec!["role".to_string()],
            aggregates: vec![AggregateClause {
                function: "count".to_string(),
                field: None,
                alias: "total".to_string(),
            }],
        };

        let result = execute_aggregate(&docs, &group_by, None);
        assert_eq!(result.len(), 2);

        let admin = result.iter().find(|r| r["role"] == "admin").unwrap();
        assert_eq!(admin["total"], 2);
    }

    #[test]
    fn test_sum_avg() {
        let docs = vec![
            json!({"g": "a", "v": 10.0}),
            json!({"g": "a", "v": 20.0}),
        ];
        let group_by = GroupByClause {
            fields: vec!["g".to_string()],
            aggregates: vec![
                AggregateClause {
                    function: "sum".to_string(),
                    field: Some("v".to_string()),
                    alias: "s".to_string(),
                },
                AggregateClause {
                    function: "avg".to_string(),
                    field: Some("v".to_string()),
                    alias: "a".to_string(),
                },
            ],
        };

        let result = execute_aggregate(&docs, &group_by, None);
        assert_eq!(result[0]["s"], 30.0);
        assert_eq!(result[0]["a"], 15.0);
    }
}
