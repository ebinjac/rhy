package browsermonitors

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type ArtifactStore interface {
	Ensure(context.Context) error
	Put(context.Context, string, string, []byte) error
	Get(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
	PresignPut(context.Context, string, time.Duration) (string, error)
	PresignGet(context.Context, string, time.Duration) (string, error)
	Stat(context.Context, string) (ArtifactObjectInfo, error)
	List(context.Context, string, time.Time, int) ([]ArtifactObjectInfo, error)
}

type ArtifactObjectInfo struct {
	Key          string
	Size         int64
	ContentType  string
	ETag         string
	LastModified time.Time
}

type MinIOArtifactStore struct {
	client *minio.Client
	bucket string
}

func NewMinIOArtifactStore(rawURL, accessKey, secretKey, bucket string) (*MinIOArtifactStore, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return nil, errors.New("artifact store URL must include a host")
	}
	client, err := minio.New(parsed.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(strings.TrimSpace(accessKey), strings.TrimSpace(secretKey), ""),
		Secure: parsed.Scheme == "https",
	})
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(bucket) == "" {
		bucket = "rhythm-browser-artifacts"
	}
	return &MinIOArtifactStore{client: client, bucket: bucket}, nil
}

func (s *MinIOArtifactStore) Ensure(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{}); err != nil {
		return fmt.Errorf("create browser artifact bucket: %w", err)
	}
	return nil
}

func (s *MinIOArtifactStore) Put(ctx context.Context, key, contentType string, contents []byte) error {
	if len(contents) == 0 {
		return errors.New("artifact is empty")
	}
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(contents), int64(len(contents)), minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

func (s *MinIOArtifactStore) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	object, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err := object.Stat(); err != nil {
		_ = object.Close()
		return nil, err
	}
	return object, nil
}

func (s *MinIOArtifactStore) Delete(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

func (s *MinIOArtifactStore) PresignPut(ctx context.Context, key string, expiry time.Duration) (string, error) {
	if strings.TrimSpace(key) == "" {
		return "", errors.New("artifact object key is required")
	}
	signed, err := s.client.PresignedPutObject(ctx, s.bucket, key, boundedPresignExpiry(expiry))
	if err != nil {
		return "", err
	}
	return signed.String(), nil
}

func (s *MinIOArtifactStore) PresignGet(ctx context.Context, key string, expiry time.Duration) (string, error) {
	if strings.TrimSpace(key) == "" {
		return "", errors.New("artifact object key is required")
	}
	signed, err := s.client.PresignedGetObject(ctx, s.bucket, key, boundedPresignExpiry(expiry), nil)
	if err != nil {
		return "", err
	}
	return signed.String(), nil
}

func (s *MinIOArtifactStore) Stat(ctx context.Context, key string) (ArtifactObjectInfo, error) {
	info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return ArtifactObjectInfo{}, err
	}
	return ArtifactObjectInfo{
		Key:          key,
		Size:         info.Size,
		ContentType:  info.ContentType,
		ETag:         strings.Trim(info.ETag, `"`),
		LastModified: info.LastModified,
	}, nil
}

func (s *MinIOArtifactStore) List(ctx context.Context, prefix string, olderThan time.Time, limit int) ([]ArtifactObjectInfo, error) {
	if limit < 1 {
		return []ArtifactObjectInfo{}, nil
	}
	items := make([]ArtifactObjectInfo, 0, limit)
	for object := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    strings.TrimSpace(prefix),
		Recursive: true,
	}) {
		if object.Err != nil {
			return nil, object.Err
		}
		if !olderThan.IsZero() && !object.LastModified.Before(olderThan) {
			continue
		}
		items = append(items, ArtifactObjectInfo{
			Key:          object.Key,
			Size:         object.Size,
			ETag:         strings.Trim(object.ETag, `"`),
			LastModified: object.LastModified,
		})
		if len(items) >= limit {
			break
		}
	}
	return items, nil
}

func boundedPresignExpiry(expiry time.Duration) time.Duration {
	if expiry < time.Minute {
		return time.Minute
	}
	if expiry > 24*time.Hour {
		return 24 * time.Hour
	}
	return expiry
}
