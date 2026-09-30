// biblioteca time do Jatai: implementacao C++ das funcoes extern de time.jat
// (compilada com: jatai -lib library/time)
#pragma once

#include <chrono>
#include <cstdio>
#include <thread>

namespace jatai::time {

// segundos no relogio monotonico (steady_clock): nao volta no tempo e tem
// resolucao de nanossegundos; o valor absoluto nao importa, so diferencas
inline double now() {
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

// Pausa com precisao: dorme ate perto do prazo e espera o resto ativamente.
// O sleep do sistema pode acordar um "tick" antes ou depois (~15.6 ms no Windows),
// entao ele nunca e usado para a parte final da espera.
inline void sleep(double segundos) {
    using clock = std::chrono::steady_clock;
    std::fflush(stdout); // a saida pendente aparece antes da pausa
    if (segundos <= 0) return;
#ifdef _WIN32
    const std::chrono::duration<double> margem(0.020);
#else
    const std::chrono::duration<double> margem(0.002);
#endif
    const auto fim = clock::now() + std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>(segundos));
    for (auto agora = clock::now(); fim - agora > margem; agora = clock::now())
        std::this_thread::sleep_for(fim - agora - margem);
    while (clock::now() < fim) std::this_thread::yield();
}

}  // namespace jatai::time
