package api

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type pageMetadata struct {
	Limit      int    `json:"limit"`
	Total      int    `json:"total"`
	NextCursor string `json:"nextCursor,omitempty"`
}

func paginate[T any](r *http.Request, items []T, defaultLimit, maximumLimit int) ([]T, *pageMetadata, error) {
	rawLimit := strings.TrimSpace(r.URL.Query().Get("limit"))
	rawCursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if rawLimit == "" && rawCursor == "" {
		return items, nil, nil
	}
	limit := defaultLimit
	if rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > maximumLimit {
			return nil, nil, fmt.Errorf("limit must be between 1 and %d", maximumLimit)
		}
		limit = parsed
	}
	offset, err := decodeCursor(rawCursor)
	if err != nil || offset > len(items) {
		return nil, nil, errors.New("cursor is invalid or has expired")
	}
	end := min(offset+limit, len(items))
	page := items[offset:end]
	meta := &pageMetadata{Limit: limit, Total: len(items)}
	if end < len(items) {
		meta.NextCursor = encodeCursor(end)
	}
	return page, meta, nil
}

func encodeCursor(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte("offset:" + strconv.Itoa(offset)))
}

func decodeCursor(cursor string) (int, error) {
	if cursor == "" {
		return 0, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, err
	}
	value := strings.TrimPrefix(string(decoded), "offset:")
	if value == string(decoded) {
		return 0, errors.New("invalid cursor")
	}
	offset, err := strconv.Atoi(value)
	if err != nil || offset < 0 {
		return 0, errors.New("invalid cursor")
	}
	return offset, nil
}

func (s *server) paginatedMeta(r *http.Request, page *pageMetadata) responseMeta {
	meta := s.meta(r)
	meta.Page = page
	return meta
}
