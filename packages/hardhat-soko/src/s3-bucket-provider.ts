import { Stream } from "stream";
import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { NodeJsClient } from "@smithy/types";
import { styleText } from "node:util";
import { LOG_COLORS } from "./utils/colors";
import { SokoArtifact } from "./utils/artifacts-schemas/soko-v0";
import fs from "fs/promises";

export interface StorageProvider {
  listTags(project: string): Promise<string[]>;
  listIds(project: string): Promise<string[]>;
  hasArtifactByTag(project: string, tag: string): Promise<boolean>;
  hasArtifactById(project: string, id: string): Promise<boolean>;
  uploadArtifact(
    project: string,
    artifact: SokoArtifact,
    tag: string | undefined,
    originalContentPaths: {
      buildInfoPath: string;
      additionalArtifactsPaths: string[];
    },
  ): Promise<void>;
  downloadArtifactById(project: string, id: string): Promise<Stream>;
  downloadArtifactByTag(project: string, tag: string): Promise<Stream>;
}

type S3BucketProviderConfig = {
  bucketName: string;
  bucketRegion: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  role?: {
    roleArn: string;
    externalId?: string;
    sessionName?: string;
    durationSeconds?: number;
  };
  debug?: boolean;
  rootPath?: string;
};

type RoleCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export class S3BucketProvider implements StorageProvider {
  private readonly config: S3BucketProviderConfig;
  private client: NodeJsClient<S3Client> | undefined;
  private readonly rootPath: string;

  constructor(config: S3BucketProviderConfig) {
    this.config = config;
    this.rootPath = config.rootPath || "projects";
  }

  private async getClient(): Promise<NodeJsClient<S3Client>> {
    if (this.client) {
      return this.client;
    }

    if (!this.config.role) {
      this.client = new S3Client({
        region: this.config.bucketRegion,
        endpoint: this.config.endpoint,
        forcePathStyle: this.config.forcePathStyle,
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        },
      });
      return this.client;
    }

    const roleCredentials = await this.getRoleCredentials();
    this.client = new S3Client({
      region: this.config.bucketRegion,
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: roleCredentials.accessKeyId,
        secretAccessKey: roleCredentials.secretAccessKey,
        sessionToken: roleCredentials.sessionToken,
      },
    });
    return this.client;
  }

  private async getRoleCredentials(): Promise<RoleCredentials> {
    const role = this.config.role;
    if (!role) {
      throw new Error("Role configuration is missing");
    }

    const stsClient = new STSClient({
      region: this.config.bucketRegion,
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });

    const sessionName = role.sessionName || "soko-hardhat-session";

    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: role.roleArn,
      RoleSessionName: sessionName,
      ExternalId: role.externalId,
      DurationSeconds: role.durationSeconds,
    });

    let response;
    try {
      response = await stsClient.send(assumeRoleCommand);
    } catch (error) {
      throw new Error(
        `Failed to assume role "${role.roleArn}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const credentials = response.Credentials;
    if (
      !credentials ||
      !credentials.AccessKeyId ||
      !credentials.SecretAccessKey ||
      !credentials.SessionToken
    ) {
      throw new Error(
        `Failed to assume role "${role.roleArn}": missing credentials`,
      );
    }

    if (this.config.debug) {
      console.error(
        styleText(
          LOG_COLORS.log,
          `Assumed role ${role.roleArn} with session ${sessionName} (access key ${credentials.AccessKeyId}, expires ${credentials.Expiration})`,
        ),
      );
    }

    return {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
    };
  }

  public async listIds(project: string): Promise<string[]> {
    const client = await this.getClient();
    const listCommand = new ListObjectsV2Command({
      Bucket: this.config.bucketName,
      Prefix: `${this.rootPath}/${project}/ids/`,
    });
    const listResult = await client.send(listCommand);
    const contents = listResult.Contents;
    if (!contents) {
      return [];
    }
    const ids = [];
    for (const content of contents) {
      const key = content.Key;
      if (!key) continue;
      // Consider only .json files under the "ids" prefix, we ignore any other subfolders or files (e.g. original content files)
      const relativeKey = key.replace(`${this.rootPath}/${project}/ids/`, "");
      if (relativeKey.endsWith(".json") && !relativeKey.includes("/")) {
        const id = relativeKey.replace(".json", "");
        ids.push(id);
      }
    }
    return ids;
  }

  public async listTags(project: string): Promise<string[]> {
    const client = await this.getClient();
    const listCommand = new ListObjectsV2Command({
      Bucket: this.config.bucketName,
      Prefix: `${this.rootPath}/${project}/tags/`,
    });
    const listResult = await client.send(listCommand);
    const contents = listResult.Contents;
    if (!contents) {
      return [];
    }
    const tags = [];
    for (const content of contents) {
      const key = content.Key;
      if (!key) continue;
      const tag = key
        .replace(`${this.rootPath}/${project}/tags/`, "")
        .replace(".json", "");
      tags.push(tag);
    }
    return tags;
  }

  public async hasArtifactByTag(
    project: string,
    tag: string,
  ): Promise<boolean> {
    const client = await this.getClient();
    const headCommand = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/tags/${tag}.json`,
    });
    const headResult = await client.send(headCommand).catch((err) => {
      if (err instanceof NoSuchKey) {
        return null;
      }
      throw err;
    });
    return Boolean(headResult);
  }

  public async hasArtifactById(project: string, id: string): Promise<boolean> {
    const client = await this.getClient();
    const headCommand = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/ids/${id}.json`,
    });
    const headResult = await client.send(headCommand).catch((err) => {
      if (err instanceof NoSuchKey) {
        return null;
      }
      throw err;
    });
    return Boolean(headResult);
  }

  public async uploadArtifact(
    project: string,
    artifact: SokoArtifact,
    tag: string | undefined,
    originalContentPaths: {
      buildInfoPath: string;
      additionalArtifactsPaths: string[];
    },
  ): Promise<void> {
    const client = await this.getClient();
    const idKey = `${this.rootPath}/${project}/ids/${artifact.id}.json`;

    const putIdCommand = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: idKey,
      Body: JSON.stringify(artifact),
    });
    await client.send(putIdCommand);

    if (tag) {
      const copyCommand = new CopyObjectCommand({
        Bucket: this.config.bucketName,
        Key: `${this.rootPath}/${project}/tags/${tag}.json`,
        CopySource: `${this.config.bucketName}/${idKey}`,
      });
      await client.send(copyCommand);
    }

    // Upload original content files as well, using the artifact ID as reference
    // These files are stored under `${this.rootPath}/${project}/ids/${artifact.id}/original-content/` prefix, so they don't interfere with the main artifact JSON file and can be easily retrieved when downloading the artifact
    // We start with the build info file
    const buildInfoContent = await fs.readFile(
      originalContentPaths.buildInfoPath,
    );
    let sanitizedBuildInfoPath = originalContentPaths.buildInfoPath;
    // We remove any leading `/` or `./` from the path to avoid creating unnecessary folders in the storage and to ensure the key is valid
    if (sanitizedBuildInfoPath.startsWith("/")) {
      sanitizedBuildInfoPath = sanitizedBuildInfoPath.substring(1);
    }
    if (sanitizedBuildInfoPath.startsWith("./")) {
      sanitizedBuildInfoPath = sanitizedBuildInfoPath.substring(2);
    }
    const putBuildInfoCommand = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/ids/${artifact.id}/original-content/${sanitizedBuildInfoPath}`,
      Body: buildInfoContent,
    });
    await client.send(putBuildInfoCommand);
    // Then we upload the additional artifact files (e.g. metadata files for forge)
    // The key is `${this.rootPath}/${project}/ids/${artifact.id}/original-content/${sanitizedPath}`
    for (const additionalArtifactPath of originalContentPaths.additionalArtifactsPaths) {
      const additionalArtifactContent = await fs.readFile(
        additionalArtifactPath,
      );
      let sanitizedPath = additionalArtifactPath;
      // We remove any leading `/` or `./` from the path to avoid creating unnecessary folders in the storage and to ensure the key is valid
      if (sanitizedPath.startsWith("/")) {
        sanitizedPath = sanitizedPath.substring(1);
      }
      if (sanitizedPath.startsWith("./")) {
        sanitizedPath = sanitizedPath.substring(2);
      }
      const putAdditionalArtifactCommand = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: `${this.rootPath}/${project}/ids/${artifact.id}/original-content/${sanitizedPath}`,
        Body: additionalArtifactContent,
      });
      await client.send(putAdditionalArtifactCommand);
    }
  }

  public async downloadArtifactById(
    project: string,
    id: string,
  ): Promise<Stream> {
    const client = await this.getClient();
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/ids/${id}.json`,
    });
    const getObjectResult = await client.send(getObjectCommand);
    if (!getObjectResult.Body) {
      throw new Error("Error fetching the artifact");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getObjectResult.Body.transformToWebStream() as any;
  }

  public async downloadArtifactByTag(
    project: string,
    tag: string,
  ): Promise<Stream> {
    const client = await this.getClient();
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `${this.rootPath}/${project}/tags/${tag}.json`,
    });
    const getObjectResult = await client.send(getObjectCommand);
    if (!getObjectResult.Body) {
      throw new Error("Error fetching the artifact");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getObjectResult.Body.transformToWebStream() as any;
  }
}
