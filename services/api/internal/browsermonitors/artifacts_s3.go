package browsermonitors

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type ArtifactStoreConfig struct {
	Provider   string
	Endpoint   string
	Region     string
	Bucket     string
	Prefix     string
	AccessKey  string
	SecretKey  string
	KMSKeyID   string
	PathStyle  bool
	AutoCreate bool
}

func NewArtifactStore(ctx context.Context, config ArtifactStoreConfig) (ArtifactStore, error) {
	provider := strings.ToLower(strings.TrimSpace(config.Provider))
	if provider == "" || provider == "minio" {
		return NewMinIOArtifactStore(config.Endpoint, config.AccessKey, config.SecretKey, config.Bucket)
	}
	if provider != "s3" {
		return nil, fmt.Errorf("unsupported artifact store provider %q", provider)
	}
	return NewS3ArtifactStore(ctx, config)
}

type S3ArtifactStore struct {
	client     *s3.Client
	presigner  *s3.PresignClient
	bucket     string
	prefix     string
	kmsKeyID   string
	autoCreate bool
}

func NewS3ArtifactStore(ctx context.Context, config ArtifactStoreConfig) (*S3ArtifactStore, error) {
	if strings.TrimSpace(config.Bucket) == "" {
		return nil, errors.New("S3 artifact bucket is required")
	}
	region := strings.TrimSpace(config.Region)
	if region == "" {
		region = "us-east-1"
	}
	loadOptions := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(region)}
	if strings.TrimSpace(config.AccessKey) != "" || strings.TrimSpace(config.SecretKey) != "" {
		if strings.TrimSpace(config.AccessKey) == "" || strings.TrimSpace(config.SecretKey) == "" {
			return nil, errors.New("both S3 access key and secret key are required when static credentials are used")
		}
		loadOptions = append(loadOptions, awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(config.AccessKey, config.SecretKey, ""),
		))
	}
	loaded, err := awsconfig.LoadDefaultConfig(ctx, loadOptions...)
	if err != nil {
		return nil, fmt.Errorf("load AWS configuration: %w", err)
	}
	client := s3.NewFromConfig(loaded, func(options *s3.Options) {
		options.UsePathStyle = config.PathStyle
		if endpoint := strings.TrimSpace(config.Endpoint); endpoint != "" {
			options.BaseEndpoint = aws.String(endpoint)
		}
	})
	return &S3ArtifactStore{
		client: client, presigner: s3.NewPresignClient(client),
		bucket:     strings.TrimSpace(config.Bucket),
		prefix:     strings.Trim(strings.TrimSpace(config.Prefix), "/"),
		kmsKeyID:   strings.TrimSpace(config.KMSKeyID),
		autoCreate: config.AutoCreate,
	}, nil
}

func (s *S3ArtifactStore) Ensure(ctx context.Context) error {
	if _, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)}); err == nil {
		return nil
	} else if !s.autoCreate {
		return fmt.Errorf("access existing S3 artifact bucket: %w", err)
	}
	if _, err := s.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(s.bucket)}); err != nil {
		return fmt.Errorf("create development S3 artifact bucket: %w", err)
	}
	return nil
}

func (s *S3ArtifactStore) Put(ctx context.Context, key, contentType string, contents []byte) error {
	if len(contents) == 0 {
		return errors.New("artifact is empty")
	}
	input := &s3.PutObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(key)),
		Body: bytes.NewReader(contents), ContentType: aws.String(contentType),
	}
	if s.kmsKeyID != "" {
		input.ServerSideEncryption = types.ServerSideEncryptionAwsKms
		input.SSEKMSKeyId = aws.String(s.kmsKeyID)
	}
	_, err := s.client.PutObject(ctx, input)
	return err
}

func (s *S3ArtifactStore) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	output, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(key))})
	if err != nil {
		return nil, err
	}
	return output.Body, nil
}

func (s *S3ArtifactStore) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(key))})
	return err
}

func (s *S3ArtifactStore) PresignPut(ctx context.Context, key string, expiry time.Duration) (string, error) {
	if strings.TrimSpace(key) == "" {
		return "", errors.New("artifact object key is required")
	}
	output, err := s.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(key)),
	}, s3.WithPresignExpires(boundedPresignExpiry(expiry)))
	if err != nil {
		return "", err
	}
	return output.URL, nil
}

func (s *S3ArtifactStore) PresignGet(ctx context.Context, key string, expiry time.Duration) (string, error) {
	if strings.TrimSpace(key) == "" {
		return "", errors.New("artifact object key is required")
	}
	output, err := s.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(key)),
	}, s3.WithPresignExpires(boundedPresignExpiry(expiry)))
	if err != nil {
		return "", err
	}
	return output.URL, nil
}

func (s *S3ArtifactStore) Stat(ctx context.Context, key string) (ArtifactObjectInfo, error) {
	output, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(key))})
	if err != nil {
		return ArtifactObjectInfo{}, err
	}
	lastModified := time.Time{}
	if output.LastModified != nil {
		lastModified = *output.LastModified
	}
	return ArtifactObjectInfo{
		Key: key, Size: aws.ToInt64(output.ContentLength), ContentType: aws.ToString(output.ContentType),
		ETag: strings.Trim(aws.ToString(output.ETag), `"`), LastModified: lastModified,
	}, nil
}

func (s *S3ArtifactStore) List(ctx context.Context, prefix string, olderThan time.Time, limit int) ([]ArtifactObjectInfo, error) {
	if limit < 1 {
		return []ArtifactObjectInfo{}, nil
	}
	items := make([]ArtifactObjectInfo, 0, limit)
	paginator := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket), Prefix: aws.String(s.objectKey(prefix)),
	})
	for paginator.HasMorePages() && len(items) < limit {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, object := range page.Contents {
			lastModified := aws.ToTime(object.LastModified)
			if !olderThan.IsZero() && !lastModified.Before(olderThan) {
				continue
			}
			items = append(items, ArtifactObjectInfo{
				Key: s.displayKey(aws.ToString(object.Key)), Size: aws.ToInt64(object.Size),
				ETag: strings.Trim(aws.ToString(object.ETag), `"`), LastModified: lastModified,
			})
			if len(items) >= limit {
				break
			}
		}
	}
	return items, nil
}

func (s *S3ArtifactStore) objectKey(key string) string {
	key = strings.TrimLeft(strings.TrimSpace(key), "/")
	if s.prefix == "" {
		return key
	}
	if key == "" {
		return s.prefix + "/"
	}
	return s.prefix + "/" + key
}

func (s *S3ArtifactStore) displayKey(key string) string {
	if s.prefix == "" {
		return key
	}
	return strings.TrimPrefix(key, s.prefix+"/")
}
