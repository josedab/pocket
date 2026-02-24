//! Sort logic for the Wasm query engine.

use serde::Deserialize;
use serde_json::Value;

use crate::engine::get_field;

#[derive(Debug, Deserialize)]
pub struct SortClause {
    pub field: String,
    pub direction: String, // "asc" | "desc"
}

/// Sort documents in-place by multiple sort clauses.
pub fn sort_documents(docs: &mut [Value], clauses: &[SortClause]) {
    docs.sort_by(|a, b| {
        for clause in clauses {
            let av = get_field(a, &clause.field);
            let bv = get_field(b, &clause.field);
            let ordering = compare_sort_values(av, bv);

            let ordering = if clause.direction == "desc" {
                ordering.reverse()
            } else {
                ordering
            };

            if ordering != std::cmp::Ordering::Equal {
                return ordering;
            }
        }
        std::cmp::Ordering::Equal
    });
}

fn compare_sort_values(a: Option<&Value>, b: Option<&Value>) -> std::cmp::Ordering {
    match (a, b) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(_), None) => std::cmp::Ordering::Greater,
        (Some(a), Some(b)) => match (a, b) {
            (Value::Number(a), Value::Number(b)) => {
                let af = a.as_f64().unwrap_or(0.0);
                let bf = b.as_f64().unwrap_or(0.0);
                af.partial_cmp(&bf).unwrap_or(std::cmp::Ordering::Equal)
            }
            (Value::String(a), Value::String(b)) => a.cmp(b),
            (Value::Bool(a), Value::Bool(b)) => a.cmp(b),
            _ => std::cmp::Ordering::Equal,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_sort_asc() {
        let mut docs = vec![json!({"x": 3}), json!({"x": 1}), json!({"x": 2})];
        sort_documents(
            &mut docs,
            &[SortClause {
                field: "x".to_string(),
                direction: "asc".to_string(),
            }],
        );
        assert_eq!(docs[0]["x"], 1);
        assert_eq!(docs[2]["x"], 3);
    }

    #[test]
    fn test_sort_desc() {
        let mut docs = vec![json!({"x": 1}), json!({"x": 3}), json!({"x": 2})];
        sort_documents(
            &mut docs,
            &[SortClause {
                field: "x".to_string(),
                direction: "desc".to_string(),
            }],
        );
        assert_eq!(docs[0]["x"], 3);
        assert_eq!(docs[2]["x"], 1);
    }

    #[test]
    fn test_multi_sort() {
        let mut docs = vec![
            json!({"role": "b", "age": 1}),
            json!({"role": "a", "age": 2}),
            json!({"role": "a", "age": 1}),
        ];
        sort_documents(
            &mut docs,
            &[
                SortClause { field: "role".to_string(), direction: "asc".to_string() },
                SortClause { field: "age".to_string(), direction: "desc".to_string() },
            ],
        );
        assert_eq!(docs[0]["role"], "a");
        assert_eq!(docs[0]["age"], 2);
    }
}
