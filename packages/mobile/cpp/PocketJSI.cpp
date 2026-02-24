/**
 * PocketJSI — C++ implementation of the React Native TurboModule.
 *
 * Bridges JavaScript calls to SQLite via React Native's JSI for
 * synchronous reads and asynchronous writes.
 */

#include "PocketJSI.h"
#include <sqlite3.h>
#include <sys/stat.h>

namespace pocket {

// ─── SQLiteHandle ────────────────────────────────────────────────

SQLiteHandle::SQLiteHandle(const std::string& path) : path_(path) {
    int rc = sqlite3_open(path.c_str(), &db_);
    if (rc != SQLITE_OK) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
    // Enable WAL mode for better concurrent performance
    if (db_) {
        sqlite3_exec(db_, "PRAGMA journal_mode=WAL;", nullptr, nullptr, nullptr);
        sqlite3_exec(db_, "PRAGMA synchronous=NORMAL;", nullptr, nullptr, nullptr);
    }
}

SQLiteHandle::~SQLiteHandle() {
    if (db_) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
}

int64_t SQLiteHandle::getFileSize() const {
    struct stat st;
    if (stat(path_.c_str(), &st) == 0) {
        return st.st_size;
    }
    return 0;
}

// ─── PocketJSIModule ─────────────────────────────────────────────

PocketJSIModule::PocketJSIModule(
    facebook::jsi::Runtime& runtime,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker
) : runtime_(runtime), callInvoker_(std::move(callInvoker)) {}

PocketJSIModule::~PocketJSIModule() {
    std::lock_guard<std::mutex> lock(mutex_);
    databases_.clear();
}

void PocketJSIModule::install() {
    installOpenDatabase();
    installCloseDatabase();
    installExecuteSqlSync();
    installExecuteSqlAsync();
    installTransactions();
    installUtilities();
}

// ─── Database Lifecycle ──────────────────────────────────────────

bool PocketJSIModule::openDatabase(const std::string& name, const std::string& path) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (databases_.count(name)) return true;

    auto handle = std::make_shared<SQLiteHandle>(path.empty() ? name + ".db" : path);
    if (!handle->isOpen()) return false;

    databases_[name] = handle;
    return true;
}

void PocketJSIModule::closeDatabase(const std::string& name) {
    std::lock_guard<std::mutex> lock(mutex_);
    databases_.erase(name);
}

bool PocketJSIModule::databaseExists(const std::string& name) {
    std::lock_guard<std::mutex> lock(mutex_);
    return databases_.count(name) > 0;
}

bool PocketJSIModule::deleteDatabase(const std::string& name) {
    closeDatabase(name);
    return std::remove((name + ".db").c_str()) == 0;
}

int64_t PocketJSIModule::getDatabaseSize(const std::string& name) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = databases_.find(name);
    if (it == databases_.end()) return 0;
    return it->second->getFileSize();
}

SQLiteHandle* PocketJSIModule::getHandle(const std::string& name) {
    auto it = databases_.find(name);
    if (it == databases_.end()) return nullptr;
    return it->second.get();
}

// ─── Query Execution ─────────────────────────────────────────────

std::vector<QueryRow> PocketJSIModule::executeSqlSync(
    const std::string& dbName,
    const std::string& sql,
    const std::vector<facebook::jsi::Value>& params
) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto* handle = getHandle(dbName);
    if (!handle) return {};

    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(handle->get(), sql.c_str(), -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return {};

    bindParams(stmt, params);

    std::vector<QueryRow> rows;
    int colCount = sqlite3_column_count(stmt);

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        QueryRow row;
        for (int i = 0; i < colCount; i++) {
            const char* colName = sqlite3_column_name(stmt, i);
            const char* colValue = (const char*)sqlite3_column_text(stmt, i);
            row.columns[colName ? colName : ""] = colValue ? colValue : "";
        }
        rows.push_back(std::move(row));
    }

    sqlite3_finalize(stmt);
    return rows;
}

int PocketJSIModule::executeSqlWrite(
    const std::string& dbName,
    const std::string& sql,
    const std::vector<facebook::jsi::Value>& params
) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto* handle = getHandle(dbName);
    if (!handle) return 0;

    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(handle->get(), sql.c_str(), -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return 0;

    bindParams(stmt, params);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    return sqlite3_changes(handle->get());
}

void PocketJSIModule::bindParams(
    sqlite3_stmt* stmt,
    const std::vector<facebook::jsi::Value>& params
) {
    for (size_t i = 0; i < params.size(); i++) {
        const auto& param = params[i];
        int idx = static_cast<int>(i) + 1;

        if (param.isNull() || param.isUndefined()) {
            sqlite3_bind_null(stmt, idx);
        } else if (param.isNumber()) {
            sqlite3_bind_double(stmt, idx, param.asNumber());
        } else if (param.isString()) {
            auto str = param.asString(runtime_).utf8(runtime_);
            sqlite3_bind_text(stmt, idx, str.c_str(), -1, SQLITE_TRANSIENT);
        } else if (param.isBool()) {
            sqlite3_bind_int(stmt, idx, param.getBool() ? 1 : 0);
        }
    }
}

// ─── Transactions ────────────────────────────────────────────────

void PocketJSIModule::beginTransaction(const std::string& dbName) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto* handle = getHandle(dbName);
    if (handle) sqlite3_exec(handle->get(), "BEGIN TRANSACTION;", nullptr, nullptr, nullptr);
}

void PocketJSIModule::commitTransaction(const std::string& dbName) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto* handle = getHandle(dbName);
    if (handle) sqlite3_exec(handle->get(), "COMMIT;", nullptr, nullptr, nullptr);
}

void PocketJSIModule::rollbackTransaction(const std::string& dbName) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto* handle = getHandle(dbName);
    if (handle) sqlite3_exec(handle->get(), "ROLLBACK;", nullptr, nullptr, nullptr);
}

// ─── JSI Function Installers ─────────────────────────────────────

void PocketJSIModule::installOpenDatabase() {
    auto fn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_openDatabase"),
        2,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t count) -> facebook::jsi::Value {
            auto name = args[0].asString(rt).utf8(rt);
            auto path = count > 1 && args[1].isString() ? args[1].asString(rt).utf8(rt) : "";
            return facebook::jsi::Value(openDatabase(name, path));
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_openDatabase", std::move(fn));
}

void PocketJSIModule::installCloseDatabase() {
    auto fn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_closeDatabase"),
        1,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t) -> facebook::jsi::Value {
            closeDatabase(args[0].asString(rt).utf8(rt));
            return facebook::jsi::Value::undefined();
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_closeDatabase", std::move(fn));
}

void PocketJSIModule::installExecuteSqlSync() {
    auto fn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_executeSqlSync"),
        3,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t) -> facebook::jsi::Value {
            auto dbName = args[0].asString(rt).utf8(rt);
            auto sql = args[1].asString(rt).utf8(rt);
            // For simplicity, params handled as empty vector in this reference impl
            auto rows = executeSqlSync(dbName, sql, {});
            auto result = facebook::jsi::Array(rt, rows.size());
            for (size_t i = 0; i < rows.size(); i++) {
                result.setValueAtIndex(rt, i, rowToJSI(rows[i]));
            }
            return result;
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_executeSqlSync", std::move(fn));
}

void PocketJSIModule::installExecuteSqlAsync() {
    // Async execution delegates to the call invoker thread
    auto fn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_executeSqlAsync"),
        3,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t) -> facebook::jsi::Value {
            auto dbName = args[0].asString(rt).utf8(rt);
            auto sql = args[1].asString(rt).utf8(rt);

            int rowsAffected = executeSqlWrite(dbName, sql, {});
            auto result = facebook::jsi::Object(rt);
            result.setProperty(rt, "rowsAffected", facebook::jsi::Value(rowsAffected));
            return result;
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_executeSqlAsync", std::move(fn));
}

void PocketJSIModule::installTransactions() {
    auto beginFn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_beginTransaction"),
        1,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t) -> facebook::jsi::Value {
            beginTransaction(args[0].asString(rt).utf8(rt));
            return facebook::jsi::Value::undefined();
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_beginTransaction", std::move(beginFn));

    auto commitFn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_commitTransaction"),
        1,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t) -> facebook::jsi::Value {
            commitTransaction(args[0].asString(rt).utf8(rt));
            return facebook::jsi::Value::undefined();
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_commitTransaction", std::move(commitFn));

    auto rollbackFn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_rollbackTransaction"),
        1,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t) -> facebook::jsi::Value {
            rollbackTransaction(args[0].asString(rt).utf8(rt));
            return facebook::jsi::Value::undefined();
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_rollbackTransaction", std::move(rollbackFn));
}

void PocketJSIModule::installUtilities() {
    auto existsFn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_databaseExists"),
        1,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t) -> facebook::jsi::Value {
            return facebook::jsi::Value(databaseExists(args[0].asString(rt).utf8(rt)));
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_databaseExists", std::move(existsFn));

    auto deleteFn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_deleteDatabase"),
        1,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t) -> facebook::jsi::Value {
            return facebook::jsi::Value(deleteDatabase(args[0].asString(rt).utf8(rt)));
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_deleteDatabase", std::move(deleteFn));

    auto sizeFn = facebook::jsi::Function::createFromHostFunction(
        runtime_,
        facebook::jsi::PropNameID::forAscii(runtime_, "__pocketJSI_getDatabaseSize"),
        1,
        [this](facebook::jsi::Runtime& rt, const facebook::jsi::Value&,
               const facebook::jsi::Value* args, size_t) -> facebook::jsi::Value {
            return facebook::jsi::Value(static_cast<double>(getDatabaseSize(args[0].asString(rt).utf8(rt))));
        }
    );
    runtime_.global().setProperty(runtime_, "__pocketJSI_getDatabaseSize", std::move(sizeFn));
}

facebook::jsi::Value PocketJSIModule::rowToJSI(const QueryRow& row) {
    auto obj = facebook::jsi::Object(runtime_);
    for (const auto& [key, value] : row.columns) {
        obj.setProperty(
            runtime_,
            facebook::jsi::PropNameID::forUtf8(runtime_, key),
            facebook::jsi::String::createFromUtf8(runtime_, value)
        );
    }
    return obj;
}

// ─── Factory ─────────────────────────────────────────────────────

std::shared_ptr<PocketJSIModule> createPocketJSIModule(
    facebook::jsi::Runtime& runtime,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker
) {
    return std::make_shared<PocketJSIModule>(runtime, std::move(callInvoker));
}

} // namespace pocket
