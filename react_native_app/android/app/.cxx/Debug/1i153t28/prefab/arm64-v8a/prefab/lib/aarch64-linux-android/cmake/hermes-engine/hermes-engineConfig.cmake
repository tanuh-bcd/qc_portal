if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "/Users/ashwinrajkumar/.gradle/caches/8.10.2/transforms/d25fc2b2e845e45e1c22e9d8eda7b2cc/transformed/hermes-android-0.79.2-debug/prefab/modules/libhermes/libs/android.arm64-v8a/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "/Users/ashwinrajkumar/.gradle/caches/8.10.2/transforms/d25fc2b2e845e45e1c22e9d8eda7b2cc/transformed/hermes-android-0.79.2-debug/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

