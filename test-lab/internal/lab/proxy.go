package lab

import (
	"bufio"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const proxyCredentials = "rhythm:rhythm-proxy"

func (s *Server) proxyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.ProxyRequireAuth && !s.validProxyAuth(r.Header.Get("Proxy-Authorization")) {
			w.Header().Set("Proxy-Authenticate", `Basic realm="Rhythm Test Lab Proxy"`)
			http.Error(w, "proxy authentication required", http.StatusProxyAuthRequired)
			return
		}
		if r.Method == http.MethodConnect {
			s.proxyConnect(w, r)
			return
		}
		s.proxyHTTP(w, r)
	})
}
func (s *Server) validProxyAuth(value string) bool {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, "Basic "))
	return err == nil && constantEqual(string(decoded), proxyCredentials)
}
func (s *Server) proxyHTTP(w http.ResponseWriter, r *http.Request) {
	request := r.Clone(r.Context())
	request.RequestURI = ""
	request.Header.Del("Proxy-Authorization")
	request.Header.Del("Proxy-Connection")
	response, err := http.DefaultTransport.RoundTrip(request)
	if err != nil {
		http.Error(w, "proxy upstream failed", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	for key, values := range response.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.Header().Set("X-Rhythm-Test-Proxy", "used")
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}
func (s *Server) proxyConnect(w http.ResponseWriter, r *http.Request) {
	destination, err := net.DialTimeout("tcp", r.Host, 10*time.Second)
	if err != nil {
		http.Error(w, "proxy tunnel failed", http.StatusBadGateway)
		return
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		destination.Close()
		http.Error(w, "proxy tunnel unavailable", http.StatusInternalServerError)
		return
	}
	client, buffer, err := hijacker.Hijack()
	if err != nil {
		destination.Close()
		return
	}
	_, _ = buffer.WriteString("HTTP/1.1 200 Connection Established\r\nX-Rhythm-Test-Proxy: used\r\n\r\n")
	_ = buffer.Flush()
	go proxyCopy(destination, client, buffer)
	go proxyCopy(client, destination, nil)
}
func proxyCopy(destination net.Conn, source net.Conn, buffer *bufio.ReadWriter) {
	defer destination.Close()
	defer source.Close()
	if buffer != nil {
		_, _ = io.Copy(destination, buffer)
	} else {
		_, _ = io.Copy(destination, source)
	}
}
