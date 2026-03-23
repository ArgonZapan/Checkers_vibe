#include "httplib.h"
#include <iostream>

namespace checkers_api {
    void registerRoutes(httplib::Server& svr);
}

int main() {
    httplib::Server svr;

    // Limit max request body size to 1MB (default is 100MB — DoS risk)
    svr.set_payload_max_length(1024 * 1024);

    checkers_api::registerRoutes(svr);

    std::cout << "Checkers server listening on http://127.0.0.1:8080\n";
    svr.listen("127.0.0.1", 8080);
    return 0;
}
