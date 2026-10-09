"""Conditional delivery for ordinary public assets, shared by main and Lite."""
from pathlib import Path

class StaticAssetCacheMixin:
    """Revalidate static code/assets; leave APIs and release checks uncached."""
    def send_head(self):
        self._static_etag = None
        from urllib.parse import urlparse
        request_path = urlparse(self.path).path
        allowed = {'.js', '.css', '.woff', '.woff2', '.ttf', '.svg', '.png', '.jpg', '.ico'}
        # Mutable static data is revalidated every time, never treated as immutable.
        # API responses and unlisted data retain their existing no-store policy.
        static_data = request_path in {'/data/_index.json.gz', '/scope-dependencies.json'} or (
            request_path.startswith(('/data/structures/', '/data/structures_dimer/')) and request_path.endswith('.pdb')) or (
            request_path.startswith(('/data/assets/proteins/', '/data/assets/proteins_catalogue/', '/data/assets/modifications/')) and request_path.endswith('.json'))
        if static_data or (not request_path.startswith(('/api/', '/data/')) and Path(request_path).suffix.lower() in allowed):
            candidate = Path(self.translate_path(self.path))
            if candidate.is_file():
                # Chromium uses date-only revalidation for HTTP/1.0 responses.
                # HTTP/1.1 enables ETags; close explicitly rather than changing
                # connection framing for the server's API routes.
                self.protocol_version = 'HTTP/1.1'
                self.close_connection = True
                info = candidate.stat()
                self._static_etag = f'W/"{info.st_mtime_ns:x}-{info.st_size:x}"'
                validators = self.headers.get('If-None-Match', '')
                if self._static_etag in [value.strip() for value in validators.split(',')] or validators.strip() == '*':
                    self.send_response(304)
                    self.end_headers()
                    return None
                # Nanosecond validators avoid stale same-second edits. Clients
                # with only a date validator receive the current representation.
                if 'If-Modified-Since' in self.headers:
                    del self.headers['If-Modified-Since']
        return super().send_head()

    def end_headers(self):
        if getattr(self, '_static_etag', None):
            self.send_header('Connection', 'close')
        super().end_headers()

    def send_header(self, keyword, value):
        if keyword.lower() == 'cache-control' and getattr(self, '_static_etag', None) and getattr(self, '_response_status', 0) in (200, 304):
            value = 'private, no-cache'
            super().send_header('ETag', self._static_etag)
        super().send_header(keyword, value)

