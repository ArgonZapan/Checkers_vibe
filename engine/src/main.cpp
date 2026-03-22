#include "httplib.h"
#include <iostream>

namespace checkers_api {
    void registerRoutes(httplib::Server& svr);
}

int main() {
    httplib::Server svr;

    checkers_api::registerRoutes(svr);

    std::cout << "Checkers server listening on http://0.0.0.0:8080\n";
    svr.listen("0.0.0.0", 8080);
    return 0;
}
