# Wire Protocol Definitions

This directory contains Protocol Buffer definitions for the `chatapp` messaging wire protocol.

## Compilation

- **Python**: Generated via `grpcio-tools` or `protobuf`:
  ```bash
  python -m grpc_tools.protoc -I. --python_out=../shared/py/src/proto envelope.proto
  ```
- **TypeScript**: Generated via `ts-proto` or `@bufbuild/protobuf`:
  ```bash
  npx protoc --ts_out=../client/src/proto --proto_path=. envelope.proto
  ```
