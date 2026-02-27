//! Filter evaluation for the Wasm query engine.

use serde::Deserialize;
use serde_json::Value;

use crate::engine::get_field;

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum FilterNode {
    Group(FilterGroup),
    Condition(FilterCondition),
}

#[derive(Debug, Deserialize)]
pub struct FilterGroup {
    pub logic: String, // "and" | "or"
    pub conditions: Vec<FilterNode>,
}

#[derive(Debug, Deserialize)]
pub struct FilterCondition {
    pub field: String,
    pub operator: String,
    pub value: Value,
}

/// Evaluate a filter node against a document.
pub fn evaluate_filter(doc: &Value, filter: &FilterNode) -> bool {
    match filter {
        FilterNode::Group(group) => {
            if group.logic == "and" {
                group.conditions.iter().all(|c| evaluate_filter(doc, c))
            } else {
                group.conditions.iter().any(|c| evaluate_filter(doc, c))
            }
        }
        FilterNode::Condition(cond) => evaluate_condition(doc, cond),
    }
}

fn evaluate_condition(doc: &Value, cond: &FilterCondition) -> bool {
    let field_value = get_field(doc, &cond.field);

    match cond.operator.as_str() {
        "eq" => field_value == Some(&cond.value),
        "ne" => field_value != Some(&cond.value),
        "gt" => compare_values(field_value, &cond.value) == Some(std::cmp::Ordering::Greater),
        "gte" => matches!(
            compare_values(field_value, &cond.value),
            Some(std::cmp::Ordering::Greater | std::cmp::Ordering::Equal)
        ),
        "lt" => compare_values(field_value, &cond.value) == Some(std::cmp::Ordering::Less),
        "lte" => matches!(
            compare_values(field_value, &cond.value),
            Some(std::cmp::Ordering::Less | std::cmp::Ordering::Equal)
        ),
        "in" => {
            if let (Some(fv), Value::Array(arr)) = (field_value, &cond.value) {
                arr.contains(fv)
            } else {
                false
            }
        }
        "nin" => {
            if let (Some(fv), Value::Array(arr)) = (field_value, &cond.value) {
                !arr.contains(fv)
            } else {
                true
            }
        }
        "contains" => {
            if let (Some(Value::String(fv)), Value::String(target)) = (field_value, &cond.value) {
                fv.contains(target.as_str())
            } else {
                false
            }
        }
        "startsWith" => {
            if let (Some(Value::String(fv)), Value::String(target)) = (field_value, &cond.value) {
                fv.starts_with(target.as_str())
            } else {
                false
            }
        }
        "endsWith" => {
            if let (Some(Value::String(fv)), Value::String(target)) = (field_value, &cond.value) {
                fv.ends_with(target.as_str())
            } else {
                false
            }
        }
        "exists" => {
            let exists = field_value.is_some();
            if cond.value == Value::Bool(true) { exists } else { !exists }
        }
        _ => false,
    }
}

fn compare_values(a: Option<&Value>, b: &Value) -> Option<std::cmp::Ordering> {
    let a = a?;
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            let af = a.as_f64()?;
            let bf = b.as_f64()?;
            af.partial_cmp(&bf)
        }
        (Value::String(a), Value::String(b)) => Some(a.cmp(b)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_eq() {
        let doc = json!({"name": "Alice"});
        let cond = FilterCondition {
            field: "name".to_string(),
            operator: "eq".to_string(),
            value: json!("Alice"),
        };
        assert!(evaluate_condition(&doc, &cond));
    }

    #[test]
    fn test_gt() {
        let doc = json!({"age": 30});
        let cond = FilterCondition {
            field: "age".to_string(),
            operator: "gt".to_string(),
            value: json!(25),
        };
        assert!(evaluate_condition(&doc, &cond));
    }

    #[test]
    fn test_contains() {
        let doc = json!({"name": "Charlie"});
        let cond = FilterCondition {
            field: "name".to_string(),
            operator: "contains".to_string(),
            value: json!("harl"),
        };
        assert!(evaluate_condition(&doc, &cond));
    }

    #[test]
    fn test_and_group() {
        let doc = json!({"age": 30, "role": "admin"});
        let filter = FilterNode::Group(FilterGroup {
            logic: "and".to_string(),
            conditions: vec![
                FilterNode::Condition(FilterCondition {
                    field: "age".to_string(),
                    operator: "gte".to_string(),
                    value: json!(25),
                }),
                FilterNode::Condition(FilterCondition {
                    field: "role".to_string(),
                    operator: "eq".to_string(),
                    value: json!("admin"),
                }),
            ],
        });
        assert!(evaluate_filter(&doc, &filter));
    }
}
