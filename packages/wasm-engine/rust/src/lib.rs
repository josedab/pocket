//! Pocket Wasm Query Engine
//!
//! High-performance query engine compiled to WebAssembly for evaluating
//! filters, sorting, and aggregating documents directly in the browser.
//!
//! Build with: `wasm-pack build --target web --out-dir ../wasm`

mod engine;
mod filter;
mod sort;
mod aggregate;

use wasm_bindgen::prelude::*;

/// Initialize the Wasm module (called once on load).
#[wasm_bindgen]
pub fn init() -> Result<(), JsValue> {
    Ok(())
}

/// Execute a query plan against a JSON array of documents.
///
/// # Arguments
/// * `documents_json` - JSON string of document array
/// * `plan_json` - JSON string of the query plan
///
/// # Returns
/// JSON string of QueryResult
#[wasm_bindgen]
pub fn execute_query(documents_json: &str, plan_json: &str) -> Result<String, JsValue> {
    let documents: Vec<serde_json::Value> = serde_json::from_str(documents_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid documents JSON: {}", e)))?;

    let plan: engine::QueryPlan = serde_json::from_str(plan_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid plan JSON: {}", e)))?;

    let start = js_sys::Date::now();
    let result = engine::execute(&documents, &plan);
    let duration = js_sys::Date::now() - start;

    let response = engine::QueryResponse {
        documents: result.documents,
        total_matched: result.total_matched,
        execution_time_ms: duration,
        engine: "wasm".to_string(),
    };

    serde_json::to_string(&response)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Execute an aggregation query against a JSON array of documents.
///
/// # Arguments
/// * `documents_json` - JSON string of document array
/// * `group_by_json` - JSON string of GroupByClause
/// * `filter_json` - Optional JSON string of filter
///
/// # Returns
/// JSON string of AggregateResult
#[wasm_bindgen]
pub fn execute_aggregate(
    documents_json: &str,
    group_by_json: &str,
    filter_json: Option<String>,
) -> Result<String, JsValue> {
    let documents: Vec<serde_json::Value> = serde_json::from_str(documents_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid documents JSON: {}", e)))?;

    let group_by: aggregate::GroupByClause = serde_json::from_str(group_by_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid group_by JSON: {}", e)))?;

    let filter_parsed = match filter_json {
        Some(ref json) => Some(
            serde_json::from_str(json)
                .map_err(|e| JsValue::from_str(&format!("Invalid filter JSON: {}", e)))?,
        ),
        None => None,
    };

    let start = js_sys::Date::now();
    let result = aggregate::execute_aggregate(&documents, &group_by, filter_parsed.as_ref());
    let duration = js_sys::Date::now() - start;

    let response = aggregate::AggregateResponse {
        groups: result,
        execution_time_ms: duration,
        engine: "wasm".to_string(),
    };

    serde_json::to_string(&response)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}
