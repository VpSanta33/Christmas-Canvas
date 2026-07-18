# 多阶段构建：编译静态二进制 → 精简运行镜像
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates \
    && addgroup -S app \
    && adduser -S -G app app
COPY --from=build /out/api /usr/local/bin/api
USER app
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/api"]
