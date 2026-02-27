//! Core query engine types and execution logic.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::filter::{evaluate_filter, FilterNode};
use crate::sort::{sort_documents, SortClause};

#[derive(Debug, Deserialize)]
pub struct QueryPlan {
    pub filter: Option<FilterNode>,
    pub sort: Option<Vec<SortClause>>,
    pub skip: Option<usize>,
    pub limit: Option<usize>,
    pub projection: Option<Projection>,
}

#[derive(Debug, Deserialize)]
pub struct Projection {
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
}

pub struct ExecuteResult {
    pub documents: Vec<Value>,
    pub total_matched: usize,
}

#[derive(Serialize)]
pub struct QueryResponse {
    pub documents: Vec<Value>,
    pub total_matched: usize,
    pub execution_time_ms: f64,
    pub engine: String,
}

/// Resolve a dotted field path from a JSON value.
pub fn get_field<'a>(doc: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = doc;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

/// Execute a query plan against a set of documents.
pub fn execute(documents: &[Value], plan: &QueryPlan) -> ExecuteResult {
    // 1. Filter
    let mut results: Vec<Value> = match &plan.filter {
        Some(filter) => documents
            .iter()
            .filter(|doc| evaluate_filter(doc, filter))
            .cloned()
            .collect(),
        None => documents.to_vec(),
    };

    let total_matched = results.len();

    // 2. Sort
    if let Some(sort_clauses) = &plan.sort {
        sort_documents(&mut results, sort_clauses);
    }

    // 3. Skip
    if let Some(skip) = plan.skip {
        if skip < results.len() {
            results = results[skip..].to_vec();
        } else {
            results.clear();
        }
    }

    // 4. Limit
    if let Some(limit) = plan.limit {
        results.truncate(limit);
    }

    // 5. Projection
    if let Some(projection) = &plan.projection {
        results = results
            .into_iter()
            .map(|doc| apply_projection(doc, projection))
            .collect();
    }

    ExecuteResult {
        documents: results,
        total_matched,
    }
}

fn apply_projection(doc: Value, projection: &Projection) -> Value {
    if let Value::Object(map) = &doc {
        if let Some(include) = &projection.include {
            let mut result = serde_json::Map::new();
            for field in include {
                if let Some(val) = map.get(field) {
                    result.insert(field.clone(), val.clone());
                }
            }
            return Value::Object(result);
        }
        if let Some(exclude) = &projection.exclude {
            let mut result = map.clone();
            for field in exclude {
                result.remove(field);
            }
            return Value::Object(result);
        }
    }
    doc
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_get_field() {
        let doc = json!({"a": {"b": 42}});
        assert_eq!(get_field(&doc, "a.b"), Some(&json!(42)));
    }

    #[test]
    fn test_execute_no_filter() {
        let docs = vec![json!({"x": 1}), json!({"x": 2})];
        let plan = QueryPlan {
            filter: None,
            sort: None,
            skip: None,
            limit: Some(1),
            projection: None,
        };
        let result = execute(&docs, &plan);
        assert_eq!(result.total_matched, 2);
        assert_eq!(result.documents.len(), 1);
    }
}
