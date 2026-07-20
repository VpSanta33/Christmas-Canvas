package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// ObjectStore 封装 S3 兼容对象存储。底层客户端只负责 S3 签名协议，不代表需要部署某个特定服务。
type ObjectStore struct {
	client *minio.Client
	bucket string
}

type ObjectStoreOptions struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	Region    string
	UseSSL    bool
}

type ObjectInfo struct {
	Size        int64
	ContentType string
}

func NewObjectStore(ctx context.Context, opt ObjectStoreOptions) (*ObjectStore, error) {
	client, err := minio.New(opt.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(opt.AccessKey, opt.SecretKey, ""),
		Secure: opt.UseSSL,
		Region: opt.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("minio.New: %w", err)
	}
	exists, err := client.BucketExists(ctx, opt.Bucket)
	if err != nil {
		return nil, fmt.Errorf("bucket exists check: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, opt.Bucket, minio.MakeBucketOptions{Region: opt.Region}); err != nil {
			return nil, fmt.Errorf("make bucket: %w", err)
		}
	}
	return &ObjectStore{client: client, bucket: opt.Bucket}, nil
}

func (s *ObjectStore) Put(ctx context.Context, objectKey string, data []byte, contentType string) error {
	_, err := s.PutReader(ctx, objectKey, bytes.NewReader(data), int64(len(data)), contentType)
	return err
}

// PutReader 把输入流直接写入对象存储。size=-1 时由 MinIO SDK 使用分片上传，
// 避免大文件先完整落到应用服务器磁盘。
func (s *ObjectStore) PutReader(ctx context.Context, objectKey string, reader io.Reader, size int64, contentType string) (int64, error) {
	info, err := s.client.PutObject(ctx, s.bucket, objectKey, reader, size,
		minio.PutObjectOptions{ContentType: contentType})
	return info.Size, err
}

func (s *ObjectStore) Open(ctx context.Context, objectKey string) (io.ReadCloser, ObjectInfo, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	info, err := obj.Stat()
	if err != nil {
		obj.Close()
		return nil, ObjectInfo{}, err
	}
	return obj, ObjectInfo{Size: info.Size, ContentType: info.ContentType}, nil
}

func (s *ObjectStore) Get(ctx context.Context, objectKey string) ([]byte, string, error) {
	obj, info, err := s.Open(ctx, objectKey)
	if err != nil {
		return nil, "", err
	}
	defer obj.Close()
	data, err := io.ReadAll(obj)
	if err != nil {
		return nil, "", err
	}
	return data, info.ContentType, nil
}

func (s *ObjectStore) Delete(ctx context.Context, objectKey string) error {
	return s.client.RemoveObject(ctx, s.bucket, objectKey, minio.RemoveObjectOptions{})
}
