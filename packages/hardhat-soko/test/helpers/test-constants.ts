import path from "path";

export const TEST_CONSTANTS = {
  LOCALSTACK: {
    ENDPOINT: "http://localhost:4566",
    REGION: "us-east-1",
    ACCESS_KEY_ID: "test",
    SECRET_ACCESS_KEY: "test",
  },
  BUCKET_NAME: "soko-test-bucket",
  PROJECTS: {
    DEFAULT: "default-project",
    MULTI_ARTIFACT: "multi-artifact-project",
    FORCE_TEST: "force-test-project",
  },
  TAGS: {
    V1: "v1.0.0",
    V2: "v2.0.0",
    LATEST: "latest",
  },
  PATHS: {
    TEMP_DIR_PREFIX: "soko-test-",
    FIXTURES: path.resolve(process.cwd(), "test/fixtures"),
    SAMPLE_ARTIFACT: path.resolve(
      process.cwd(),
      "test/fixtures/build-info/sample-artifact.json",
    ),
  },
} as const;
