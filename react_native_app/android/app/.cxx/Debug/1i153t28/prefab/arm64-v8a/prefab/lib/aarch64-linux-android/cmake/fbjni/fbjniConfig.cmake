if(NOT TARGET fbjni::fbjni)
add_library(fbjni::fbjni SHARED IMPORTED)
set_target_properties(fbjni::fbjni PROPERTIES
    IMPORTED_LOCATION "/Users/ashwinrajkumar/.gradle/caches/8.10.2/transforms/375ac29d4edf96574b54798463bba56a/transformed/fbjni-0.7.0/prefab/modules/fbjni/libs/android.arm64-v8a/libfbjni.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/ashwinrajkumar/.gradle/caches/8.10.2/transforms/375ac29d4edf96574b54798463bba56a/transformed/fbjni-0.7.0/prefab/modules/fbjni/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

