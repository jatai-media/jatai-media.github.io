#pragma once
#include <string>
#include <cctype>

namespace jatai::level {

inline std::string upper(const std::string& s) {
    std::string r = s;
    for (char& c : r) c = (char)std::toupper((unsigned char)c);
    return r;
}

}
