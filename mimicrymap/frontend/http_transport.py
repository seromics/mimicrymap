"""Local HTTP transport shared by both site launchers."""
from http.server import ThreadingHTTPServer


class BrowserHTTPServer(ThreadingHTTPServer):
    # Python 3.13 defaults to five pending connections. Browser asset bursts can
    # exceed that while the accept loop is busy starting request threads.
    request_queue_size = 128
