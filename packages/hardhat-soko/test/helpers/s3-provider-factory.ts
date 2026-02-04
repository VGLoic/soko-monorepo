import { S3BucketProvider } from "@/s3-bucket-provider";
import { TEST_CONSTANTS } from "./test-constants";

export function createTestS3Provider(opts?: {
  debug?: boolean;
}): S3BucketProvider {
  return new S3BucketProvider({
    bucketName: TEST_CONSTANTS.BUCKET_NAME,
    bucketRegion: TEST_CONSTANTS.LOCALSTACK.REGION,
    accessKeyId: TEST_CONSTANTS.LOCALSTACK.ACCESS_KEY_ID,
    secretAccessKey: TEST_CONSTANTS.LOCALSTACK.SECRET_ACCESS_KEY,
    endpoint: TEST_CONSTANTS.LOCALSTACK.ENDPOINT,
    forcePathStyle: true,
    debug: opts?.debug ?? false,
    rootPath: "projects",
  });
}
