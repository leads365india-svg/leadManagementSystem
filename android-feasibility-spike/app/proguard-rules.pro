# Leads-365 Phase 20: Proguard & R8 Rules for Release Distribution

# Keep Kotlin Coroutines & Reflection
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Retrofit 2 & OkHttp
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }
-keepattributes Signature
-keepattributes Exceptions
-dontwarn okhttp3.**
-dontwarn okio.**

# Gson Models (Preserve DTO data classes from obfuscation)
-keepclassmembers class com.leadflow.feasibility.network.** { <fields>; }
-keep class com.leadflow.feasibility.network.** { *; }

# Room Database Entities and DAOs
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class * { *; }
-keep @androidx.room.Dao class * { *; }

# WorkManager Workers
-keep class * extends androidx.work.Worker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class * extends androidx.work.CoroutineWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# Android Jetpack Security Crypto
-keep class androidx.security.crypto.** { *; }
