package api

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
)

// CompressResponse applies bounded, streaming gzip compression to JSON and
// textual API responses. Event streams remain uncompressed so progress can be
// flushed immediately through ingress proxies.
func CompressResponse(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !acceptsGzip(r.Header.Get("Accept-Encoding")) ||
			strings.HasSuffix(r.URL.Path, "/events") {
			next.ServeHTTP(w, r)
			return
		}
		writer := &gzipResponseWriter{ResponseWriter: w}
		defer writer.Close()
		next.ServeHTTP(writer, r)
	})
}

type gzipResponseWriter struct {
	http.ResponseWriter
	compressor *gzip.Writer
	decided    bool
	compress   bool
	status     int
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	if w.decided {
		return
	}
	w.status = status
	w.decide()
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(value []byte) (int, error) {
	if !w.decided {
		w.status = http.StatusOK
		w.decide()
		w.ResponseWriter.WriteHeader(w.status)
	}
	if w.compress {
		return w.compressor.Write(value)
	}
	return w.ResponseWriter.Write(value)
}

func (w *gzipResponseWriter) Flush() {
	if !w.decided {
		w.status = http.StatusOK
		w.decide()
		w.ResponseWriter.WriteHeader(w.status)
	}
	if w.compressor != nil {
		_ = w.compressor.Flush()
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *gzipResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *gzipResponseWriter) Close() {
	if w.compressor != nil {
		_ = w.compressor.Close()
	}
}

func (w *gzipResponseWriter) decide() {
	w.decided = true
	contentType := strings.ToLower(w.Header().Get("Content-Type"))
	w.compress = w.status != http.StatusNoContent &&
		w.status != http.StatusNotModified &&
		(strings.Contains(contentType, "json") ||
			strings.HasPrefix(contentType, "text/") ||
			strings.Contains(contentType, "javascript") ||
			strings.Contains(contentType, "xml") ||
			strings.Contains(contentType, "svg"))
	if !w.compress {
		return
	}
	w.Header().Del("Content-Length")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Set("Vary", appendHeaderValue(w.Header().Get("Vary"), "Accept-Encoding"))
	w.compressor = gzip.NewWriter(w.ResponseWriter)
}

func acceptsGzip(value string) bool {
	for _, part := range strings.Split(strings.ToLower(value), ",") {
		token := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		if token == "gzip" || token == "*" {
			return true
		}
	}
	return false
}

func appendHeaderValue(current, value string) string {
	for _, existing := range strings.Split(current, ",") {
		if strings.EqualFold(strings.TrimSpace(existing), value) {
			return current
		}
	}
	if strings.TrimSpace(current) == "" {
		return value
	}
	return current + ", " + value
}

var _ http.Flusher = (*gzipResponseWriter)(nil)
var _ interface{ Unwrap() http.ResponseWriter } = (*gzipResponseWriter)(nil)
var _ io.Writer = (*gzipResponseWriter)(nil)
