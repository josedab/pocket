/**
 * PocketJSI — C++ header for the React Native TurboModule.
 *
 * This header defines the native interface that bridges JavaScript
 * and C++ SQLite via React Native's JSI (JavaScript Interface).
 *
 * Build with:
 *   - iOS: Add to Xcode project, link against sqlite3
 *   - Android: Add to CMakeLists.txt, link against sqlite3
 */

#pragma once

#include <jsi/jsi.h>
#include <string>
#include <unordered_map>
#include <memory>
#include <mutex>

struct sqlite3;
struct sqlite3_stmt;

namespace pocket {

/**
 * SQLite database handle with thread-safe access.
 */
class SQLiteHandle {
public:
    explicit SQLiteHandle(const std::string& path);
    ~SQLiteHandle();

    SQLiteHandle(const SQLiteHandle&) = delete;
    SQLiteHandle& operator=(const SQLiteHandle&) = delete;

    sqlite3* get() const { return db_; }
    bool isOpen() const { return db_ != nullptr; }
    int64_t getFileSize() const;

private:
    sqlite3* db_ = nullptr;
    std::string path_;
};

/**
 * Query result row as key-value pairs.
 */
struct QueryRow {
    std::unordered_map<std::string, std::string> columns;
};

/**
 * PocketJSI TurboModule — installs native functions on the JS runtime.
 *
 * Usage from React Native:
 * ```cpp
 * auto module = std::make_shared<PocketJSIModule>(rt, callInvoker);
 * module->install();
 * ```
 *
 * This exposes the following functions to JavaScript:
 * - __pocketJSI_openDatabase(name, path?) -> boolean
 * - __pocketJSI_closeDatabase(name) -> void
 * - __pocketJSI_executeSqlSync(dbName, sql, params[]) -> Object[]
 * - __pocketJSI_executeSqlAsync(dbName, sql, params[]) -> Promise<Object>
 * - __pocketJSI_beginTransaction(name) -> void
 * - __pocketJSI_commitTransaction(name) -> void
 * - __pocketJSI_rollbackTransaction(name) -> void
 * - __pocketJSI_databaseExists(name) -> boolean
 * - __pocketJSI_deleteDatabase(name) -> boolean
 * - __pocketJSI_getDatabaseSize(name) -> number
 */
class PocketJSIModule {
public:
    PocketJSIModule(
        facebook::jsi::Runtime& runtime,
        std::shared_ptr<facebook::react::CallInvoker> callInvoker
    );

    ~PocketJSIModule();

    /**
     * Install all JSI host functions on the runtime.
     * Call this once during module initialization.
     */
    void install();

private:
    facebook::jsi::Runtime& runtime_;
    std::shared_ptr<facebook::react::CallInvoker> callInvoker_;
    std::unordered_map<std::string, std::shared_ptr<SQLiteHandle>> databases_;
    std::mutex mutex_;

    // Database lifecycle
    bool openDatabase(const std::string& name, const std::string& path);
    void closeDatabase(const std::string& name);
    bool databaseExists(const std::string& name);
    bool deleteDatabase(const std::string& name);
    int64_t getDatabaseSize(const std::string& name);

    // Query execution
    std::vector<QueryRow> executeSqlSync(
        const std::string& dbName,
        const std::string& sql,
        const std::vector<facebook::jsi::Value>& params
    );

    int executeSqlWrite(
        const std::string& dbName,
        const std::string& sql,
        const std::vector<facebook::jsi::Value>& params
    );

    // Transactions
    void beginTransaction(const std::string& dbName);
    void commitTransaction(const std::string& dbName);
    void rollbackTransaction(const std::string& dbName);

    // Helpers
    SQLiteHandle* getHandle(const std::string& name);
    void bindParams(
        sqlite3_stmt* stmt,
        const std::vector<facebook::jsi::Value>& params
    );
    facebook::jsi::Value rowToJSI(
        const QueryRow& row
    );

    // JSI function installers
    void installOpenDatabase();
    void installCloseDatabase();
    void installExecuteSqlSync();
    void installExecuteSqlAsync();
    void installTransactions();
    void installUtilities();
};

/**
 * Factory function for React Native module registration.
 *
 * Called from your AppDelegate (iOS) or MainApplication (Android):
 * ```cpp
 * #include "PocketJSI.h"
 *
 * // In your module installer:
 * auto module = pocket::createPocketJSIModule(rt, callInvoker);
 * module->install();
 * ```
 */
std::shared_ptr<PocketJSIModule> createPocketJSIModule(
    facebook::jsi::Runtime& runtime,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker
);

} // namespace pocket
