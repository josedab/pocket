/** Swift type mappings for the native SDK */
export const SWIFT_TYPE_DEFINITIONS = `
// PocketDocument.swift
public struct PocketDocument: Codable, Identifiable {
    public let id: String
    public var rev: String?
    public var deleted: Bool
    public var updatedAt: Date?
    public var fields: [String: AnyCodable]
}

// PocketConfig.swift
public struct PocketConfig {
    public let databasePath: String
    public var encryptionKey: String?
    public var syncUrl: URL?
    public var authToken: String?
    public var enableLogging: Bool = false
    public var maxConcurrentQueries: Int = 4
}

// SyncStatus.swift
public enum SyncStatus: String, Codable {
    case idle
    case syncing
    case error
    case offline
}

// ConflictStrategy.swift
public enum ConflictStrategy: String, Codable {
    case serverWins = "server-wins"
    case clientWins = "client-wins"
    case lastWriteWins = "last-write-wins"
    case manual
}

// PocketQuery.swift
public struct PocketQuery {
    public var filter: FilterNode?
    public var sort: [SortField] = []
    public var limit: Int?
    public var skip: Int?
    public var fields: [String]?

    public struct SortField {
        public let field: String
        public let direction: SortDirection
    }

    public enum SortDirection: String {
        case asc, desc
    }
}

// FilterNode.swift
public indirect enum FilterNode {
    case eq(field: String, value: AnyCodable)
    case neq(field: String, value: AnyCodable)
    case gt(field: String, value: AnyCodable)
    case gte(field: String, value: AnyCodable)
    case lt(field: String, value: AnyCodable)
    case lte(field: String, value: AnyCodable)
    case \`in\`(field: String, values: [AnyCodable])
    case contains(field: String, value: String)
    case and(conditions: [FilterNode])
    case or(conditions: [FilterNode])
    case not(condition: FilterNode)
}

// PocketDatabase.swift
@MainActor
public class PocketDatabase: ObservableObject {
    @Published public var isOpen: Bool = false
    @Published public var syncStatus: SyncStatus = .idle

    public func open(config: PocketConfig) async throws
    public func close() async throws
    public func collection<T: PocketModel>(_ name: String) -> PocketCollection<T>
    public func listCollections() async throws -> [String]
    public func deleteCollection(_ name: String) async throws
    public func startSync(url: URL, authToken: String?, collections: [String]?, conflictStrategy: ConflictStrategy) async throws
    public func stopSync() async throws
    public func exportData() async throws -> Data
    public func importData(_ data: Data) async throws -> ImportResult
}

// PocketCollection.swift
public class PocketCollection<T: PocketModel>: ObservableObject {
    public let name: String

    public func insert(_ document: T) async throws -> T
    public func get(_ id: String) async throws -> T?
    public func update(_ id: String, changes: [String: Any]) async throws -> T
    public func delete(_ id: String) async throws
    public func find(_ query: PocketQuery) async throws -> [T]
    public func count(_ filter: FilterNode?) async throws -> Int
    public func observe(_ query: PocketQuery?) -> AsyncStream<[T]>
    public func observeOne(_ id: String) -> AsyncStream<T?>
}

// PocketModel.swift
public protocol PocketModel: Codable, Identifiable {
    var id: String { get }
    var rev: String? { get }
}

// LiveQuery.swift - SwiftUI property wrapper
@propertyWrapper
public struct LiveQuery<T: PocketModel>: DynamicProperty {
    @StateObject private var observer: QueryObserver<T>
    public var wrappedValue: [T] { observer.results }
    public init(_ query: PocketQuery, in collection: PocketCollection<T>)
}

// ImportResult.swift
public struct ImportResult {
    public let imported: Int
    public let failed: Int
}
` as const;

/** CocoaPods podspec for PocketNative */
export const SWIFT_PODSPEC = `
Pod::Spec.new do |s|
  s.name             = 'PocketNative'
  s.version          = '0.1.0'
  s.summary          = 'Native iOS SDK for Pocket local-first database'
  s.description      = 'PocketNative provides a Swift-native interface to the Pocket local-first database, featuring reactive queries, offline-first sync, and SwiftUI integration.'
  s.homepage         = 'https://pocket-db.dev'
  s.license          = { :type => 'MIT', :file => 'LICENSE' }
  s.author           = { 'Pocket' => 'team@pocket-db.dev' }
  s.source           = { :git => 'https://github.com/pocket-db/pocket-swift.git', :tag => s.version.to_s }
  s.ios.deployment_target = '15.0'
  s.macos.deployment_target = '12.0'
  s.swift_versions   = ['5.9', '5.10']
  s.source_files     = 'Sources/PocketNative/**/*.swift'
  s.frameworks       = 'Foundation', 'Combine'
  s.dependency         'PocketCore', '~> 0.1'
end
` as const;

/** Swift Package Manager Package.swift content */
export const SWIFT_PACKAGE = `
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PocketNative",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
        .watchOS(.v8),
        .tvOS(.v15)
    ],
    products: [
        .library(
            name: "PocketNative",
            targets: ["PocketNative"]
        ),
    ],
    dependencies: [
        // Rust core via UniFFI-generated bindings
    ],
    targets: [
        .target(
            name: "PocketNative",
            dependencies: [],
            path: "Sources/PocketNative"
        ),
        .testTarget(
            name: "PocketNativeTests",
            dependencies: ["PocketNative"],
            path: "Tests/PocketNativeTests"
        ),
    ]
)
` as const;
