/** Kotlin type definitions for the native Android SDK */
export const KOTLIN_TYPE_DEFINITIONS = `
// PocketDocument.kt
data class PocketDocument(
    val id: String,
    var rev: String? = null,
    var deleted: Boolean = false,
    var updatedAt: Long? = null,
    val fields: MutableMap<String, Any?> = mutableMapOf()
)

// PocketConfig.kt
data class PocketConfig(
    val databasePath: String,
    val encryptionKey: String? = null,
    val syncUrl: String? = null,
    val authToken: String? = null,
    val enableLogging: Boolean = false,
    val maxConcurrentQueries: Int = 4
)

// SyncStatus.kt
enum class SyncStatus {
    IDLE, SYNCING, ERROR, OFFLINE
}

// ConflictStrategy.kt
enum class ConflictStrategy {
    SERVER_WINS, CLIENT_WINS, LAST_WRITE_WINS, MANUAL
}

// PocketQuery.kt
data class PocketQuery(
    val filter: FilterNode? = null,
    val sort: List<SortField> = emptyList(),
    val limit: Int? = null,
    val skip: Int? = null,
    val fields: List<String>? = null
)

data class SortField(
    val field: String,
    val direction: SortDirection
)

enum class SortDirection { ASC, DESC }

// FilterNode.kt
sealed class FilterNode {
    data class Eq(val field: String, val value: Any?) : FilterNode()
    data class Neq(val field: String, val value: Any?) : FilterNode()
    data class Gt(val field: String, val value: Any?) : FilterNode()
    data class Gte(val field: String, val value: Any?) : FilterNode()
    data class Lt(val field: String, val value: Any?) : FilterNode()
    data class Lte(val field: String, val value: Any?) : FilterNode()
    data class In(val field: String, val values: List<Any?>) : FilterNode()
    data class Contains(val field: String, val value: String) : FilterNode()
    data class And(val conditions: List<FilterNode>) : FilterNode()
    data class Or(val conditions: List<FilterNode>) : FilterNode()
    data class Not(val condition: FilterNode) : FilterNode()
}

// PocketDatabase.kt
class PocketDatabase private constructor(context: Context) {
    val isOpen: StateFlow<Boolean>
    val syncStatus: StateFlow<SyncStatus>

    suspend fun open(config: PocketConfig)
    suspend fun close()
    fun <T : PocketModel> collection(name: String): PocketCollection<T>
    suspend fun listCollections(): List<String>
    suspend fun deleteCollection(name: String)
    suspend fun startSync(
        url: String,
        authToken: String? = null,
        collections: List<String>? = null,
        conflictStrategy: ConflictStrategy = ConflictStrategy.LAST_WRITE_WINS
    )
    suspend fun stopSync()
    suspend fun exportData(): ByteArray
    suspend fun importData(data: ByteArray): ImportResult

    companion object {
        fun create(context: Context): PocketDatabase
    }
}

// PocketCollection.kt
class PocketCollection<T : PocketModel>(private val db: PocketDatabase, val name: String) {
    suspend fun insert(document: T): T
    suspend fun get(id: String): T?
    suspend fun update(id: String, changes: Map<String, Any?>): T
    suspend fun delete(id: String)
    fun find(query: PocketQuery): Flow<List<T>>
    fun observeOne(id: String): Flow<T?>
    suspend fun count(filter: FilterNode? = null): Int
}

// PocketModel.kt
interface PocketModel {
    val id: String
    val rev: String?
}

// ImportResult.kt
data class ImportResult(
    val imported: Int,
    val failed: Int
)

// SyncEvent.kt
sealed class SyncEvent {
    data class PushStarted(val timestamp: Long) : SyncEvent()
    data class PushCompleted(val timestamp: Long, val count: Int) : SyncEvent()
    data class PullStarted(val timestamp: Long) : SyncEvent()
    data class PullCompleted(val timestamp: Long, val count: Int) : SyncEvent()
    data class Conflict(val timestamp: Long, val documentId: String) : SyncEvent()
    data class Error(val timestamp: Long, val message: String) : SyncEvent()
}

// Compose integration
@Composable
fun <T : PocketModel> rememberLiveQuery(
    collection: PocketCollection<T>,
    query: PocketQuery = PocketQuery()
): State<List<T>> {
    val flow = remember(collection, query) { collection.find(query) }
    return flow.collectAsState(initial = emptyList())
}
` as const;

/** Gradle build configuration for the Android SDK */
export const KOTLIN_GRADLE = `
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("maven-publish")
}

android {
    namespace = "dev.pocketdb.native"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.compose.runtime:runtime:1.6.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.0")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
}

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "dev.pocketdb"
            artifactId = "pocket-native"
            version = "0.1.0"

            afterEvaluate {
                from(components["release"])
            }
        }
    }
}
` as const;

/** Maven Central POM for the Android SDK */
export const KOTLIN_MAVEN_POM = `
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>dev.pocketdb</groupId>
    <artifactId>pocket-native</artifactId>
    <version>0.1.0</version>
    <packaging>aar</packaging>

    <name>Pocket Native Android SDK</name>
    <description>Native Android SDK for Pocket local-first database with Kotlin coroutines and Jetpack Compose support</description>
    <url>https://pocket-db.dev</url>

    <licenses>
        <license>
            <name>MIT License</name>
            <url>https://opensource.org/licenses/MIT</url>
        </license>
    </licenses>

    <developers>
        <developer>
            <name>Pocket Team</name>
            <email>team@pocket-db.dev</email>
            <organization>Pocket</organization>
            <organizationUrl>https://pocket-db.dev</organizationUrl>
        </developer>
    </developers>

    <scm>
        <connection>scm:git:git://github.com/pocket-db/pocket-kotlin.git</connection>
        <developerConnection>scm:git:ssh://github.com/pocket-db/pocket-kotlin.git</developerConnection>
        <url>https://github.com/pocket-db/pocket-kotlin</url>
    </scm>

    <dependencies>
        <dependency>
            <groupId>org.jetbrains.kotlinx</groupId>
            <artifactId>kotlinx-coroutines-core</artifactId>
            <version>1.8.0</version>
        </dependency>
        <dependency>
            <groupId>org.jetbrains.kotlinx</groupId>
            <artifactId>kotlinx-serialization-json</artifactId>
            <version>1.6.2</version>
        </dependency>
    </dependencies>
</project>
` as const;
